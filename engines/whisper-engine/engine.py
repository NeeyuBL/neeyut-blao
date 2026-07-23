#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
whisper-engine — CLI phien am audio/video -> .srt / .txt / .vtt bang faster-whisper.

Giao tiep voi app T-blao qua STDOUT dang JSON-lines (moi dong 1 JSON):
  {"type":"status",  "message": "..."}                  # thong bao chung
  {"type":"info",    "language": "vi", "duration": 123} # sau khi nhan dien
  {"type":"progress","seconds": 12.3, "duration": 123}  # tien do (theo giay audio)
  {"type":"done",    "outputs": ["a.srt", ...]}         # xong
  {"type":"error",   "message": "..."}                  # loi

Muc dich: engine CPU nen (int8). Ban GPU se doi --device cuda + tai them CUDA libs.
"""
import argparse
import json
import os
import sys

for _name in ("stdout", "stderr"):
    try:
        getattr(sys, _name).reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


def emit(obj):
    """In 1 dong JSON ra stdout roi flush ngay (de app doc realtime)."""
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def fmt_ts(seconds, sep=","):
    """Doi giay -> HH:MM:SS,mmm (SRT dung ',', VTT dung '.')."""
    if seconds is None or seconds < 0:
        seconds = 0
    ms = int(round(seconds * 1000))
    h, ms = divmod(ms, 3600000)
    m, ms = divmod(ms, 60000)
    s, ms = divmod(ms, 1000)
    return "%02d:%02d:%02d%s%03d" % (h, m, s, sep, ms)


def line_of(seg):
    """Dong chu cua 1 doan — them nhan nguoi noi neu co diarization."""
    text = seg["text"].strip()
    spk = seg.get("speaker")
    return "[%s] %s" % (spk, text) if spk else text


def write_srt(segments, path):
    with open(path, "w", encoding="utf-8") as f:
        for i, seg in enumerate(segments, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (
                i, fmt_ts(seg["start"]), fmt_ts(seg["end"]), line_of(seg)))


def write_vtt(segments, path):
    with open(path, "w", encoding="utf-8") as f:
        f.write("WEBVTT\n\n")
        for seg in segments:
            f.write("%s --> %s\n%s\n\n" % (
                fmt_ts(seg["start"], "."), fmt_ts(seg["end"], "."), line_of(seg)))


def write_txt(segments, path):
    with open(path, "w", encoding="utf-8") as f:
        for seg in segments:
            f.write(line_of(seg) + "\n")


def resource_dir():
    """Thu muc chua tai nguyen kem theo (model diarization) — ho tro ca ban freeze."""
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS", os.path.dirname(sys.executable))
    return os.path.dirname(os.path.abspath(__file__))


DIA_THRESHOLD = 0.8
MIN_SEG_SEC = 0.5


def _fill_missing_speakers(segments):
    last = None
    for s in segments:
        if s.get("speaker"):
            last = s["speaker"]
        elif last:
            s["speaker"] = last
    first = next((s["speaker"] for s in segments if s.get("speaker")), None)
    if first:
        for s in segments:
            if not s.get("speaker"):
                s["speaker"] = first


def diarize_segments(segments, input_path, num_speakers=0):
    import sherpa_onnx
    from faster_whisper.audio import decode_audio

    emb_model = os.path.join(resource_dir(), "dia-models", "embedding.onnx")
    if not os.path.isfile(emb_model):
        emit({"type": "status", "message": "Thieu model nhan dien nguoi noi — bo qua."})
        return 0

    ext = sherpa_onnx.SpeakerEmbeddingExtractor(
        sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=emb_model)
    )
    sr = 16000
    samples = decode_audio(input_path, sampling_rate=sr)

    embs, idxs = [], []
    for i, seg in enumerate(segments):
        chunk = samples[int(seg["start"] * sr): int(seg["end"] * sr)]
        if len(chunk) < int(MIN_SEG_SEC * sr):
            continue
        st = ext.create_stream()
        st.accept_waveform(sample_rate=sr, waveform=chunk)
        st.input_finished()
        embs.append(ext.compute(st))
        idxs.append(i)

    if not embs:
        return 0

    cl = sherpa_onnx.FastClustering(
        sherpa_onnx.FastClusteringConfig(
            num_clusters=int(num_speakers) if num_speakers and num_speakers > 0 else -1,
            threshold=DIA_THRESHOLD,
        )
    )
    labels = cl(embs)
    for i, lab in zip(idxs, labels):
        segments[i]["speaker"] = "SPEAKER_%02d" % lab
    _fill_missing_speakers(segments)
    return len({segments[i]["speaker"] for i in idxs})


def _find_one(folder, suffix, must_have=None):
    if not os.path.isdir(folder):
        return None
    for f in sorted(os.listdir(folder)):
        if f.endswith(suffix) and (must_have is None or must_have in f):
            return os.path.join(folder, f)
    return None


def _load_live_asr(live_dir, threads):
    import sherpa_onnx
    asr = os.path.join(live_dir, "asr")
    enc = _find_one(asr, ".onnx", "encoder")
    dec = _find_one(asr, ".onnx", "decoder")
    join = _find_one(asr, ".onnx", "joiner")
    tokens = os.path.join(asr, "tokens.txt")
    if not all(p and os.path.isfile(p) for p in (enc, dec, join, tokens)):
        raise RuntimeError("Thieu model ASR streaming trong %s" % asr)
    return sherpa_onnx.OnlineRecognizer.from_transducer(
        tokens=tokens, encoder=enc, decoder=dec, joiner=join,
        num_threads=max(1, threads or 2), sample_rate=16000, feature_dim=80,
        decoding_method="greedy_search", provider="cpu",
        enable_endpoint_detection=True,
        rule1_min_trailing_silence=1.2,
        rule2_min_trailing_silence=0.6,
        rule3_min_utterance_length=10,
    )


class _Segmenter:
    MAX_WORDS = 60

    def __init__(self, live_dir):
        import sherpa_onnx
        d = os.path.join(live_dir, "punct")
        self.p = sherpa_onnx.OnlinePunctuation(
            sherpa_onnx.OnlinePunctuationConfig(
                model_config=sherpa_onnx.OnlinePunctuationModelConfig(
                    cnn_bilstm=os.path.join(d, "model.int8.onnx"),
                    bpe_vocab=os.path.join(d, "bpe.vocab"),
                    num_threads=1,
                    provider="cpu",
                )
            )
        )
        self.words = []

    def feed(self, raw, force=False):
        w = raw.lower().split()
        if not w:
            return []
        self.words.extend(w)
        return self._cut(force=force or len(self.words) >= self.MAX_WORDS)

    def flush(self):
        return self._cut(force=True)

    def _cut(self, force):
        if not self.words:
            return []
        punct = self.p.add_punctuation_with_case(" ".join(self.words))
        pw = punct.split()
        if len(pw) != len(self.words):
            self.words = []
            return [_end(punct)]
        out, start = [], 0
        for i, x in enumerate(pw):
            if x.endswith((".", "?", "!")):
                out.append(" ".join(pw[start:i + 1]))
                start = i + 1
        self.words = self.words[start:]
        if force and self.words:
            out.append(_end(self.p.add_punctuation_with_case(" ".join(self.words))))
            self.words = []
        return out


def _find_pair_dir(pair, *roots):
    for r in roots:
        if r:
            d = os.path.join(r, "mt-" + pair)
            if os.path.isdir(d):
                return d
    raise RuntimeError("Chua cai goi chua bo dich %s" % pair)


class _SatSegmenter:
    MAX_WORDS = 60
    THRESHOLD = 0.4

    def __init__(self, sat_dir):
        from wtpsplit_lite import SaT
        self.sat = SaT(
            os.path.join(sat_dir, "sat"),
            tokenizer_name_or_path=os.path.join(sat_dir, "tok"),
        )
        self.words = []

    def feed(self, raw, force=False):
        w = raw.split()
        if not w:
            return []
        self.words.extend(w)
        return self._cut(force=force or len(self.words) >= self.MAX_WORDS)

    def flush(self):
        return self._cut(force=True)

    def _cut(self, force):
        if not self.words:
            return []
        parts = [p.strip() for p in self.sat.split(" ".join(self.words), threshold=self.THRESHOLD)]
        parts = [p for p in parts if p]
        if not parts:
            return []
        if force:
            self.words = []
            return parts
        self.words = parts[-1].split()
        return parts[:-1]


def _end(t):
    t = t.strip()
    if not t or t[-1] in ".?!":
        return t
    return t.rstrip(",;:") + "."


class _Translator:
    def __init__(self, pair_dir, spm_fallback=None):
        import ctranslate2
        import sentencepiece as spm
        self.tr = ctranslate2.Translator(pair_dir, device="cpu")

        def _spm(name):
            p = os.path.join(pair_dir, name)
            return p if os.path.isfile(p) else os.path.join(spm_fallback or pair_dir, name)

        self.sp_s = spm.SentencePieceProcessor(model_file=_spm("source.spm"))
        self.sp_t = spm.SentencePieceProcessor(model_file=_spm("target.spm"))

    MAX_TOKENS = 400

    def __call__(self, text):
        t = text.strip()
        if not t:
            return ""
        if t == t.upper() or t == t.lower():
            t = t.capitalize()
        t = _end(t)
        src = self.sp_s.encode(t, out_type=str)
        if len(src) > self.MAX_TOKENS:
            src = src[: self.MAX_TOKENS]
        src = src + ["</s>"]
        out = self.tr.translate_batch([src], max_batch_size=1)[0].hypotheses[0]
        return self.sp_t.decode([x for x in out if x != "</s>"])


def run_live(args):
    import numpy as np

    live_dir = args.live_dir or os.path.join(resource_dir(), "live-models")
    try:
        rec = _load_live_asr(live_dir, args.threads)
    except Exception as e:
        emit({"type": "error", "message": "Khong nap duoc model nghe: %s" % e})
        return 1

    lang = args.lang or "en"
    is_en = lang == "en"

    pair = None
    if args.translate:
        pair = "%s-%s" % (lang, args.translate)
        if pair not in ("en-vi", "vi-en"):
            emit({"type": "status", "message": "Chua co bo dich %s — da bo qua dich." % pair})
            pair = None

    translate = None
    if pair:
        try:
            translate = _Translator(_find_pair_dir(pair, live_dir, args.sat_dir), live_dir)
        except Exception as e:
            emit({"type": "status", "message": "Khong nap duoc model dich: %s" % str(e)[:120]})

    seg = None
    try:
        if is_en:
            seg = _Segmenter(live_dir)
        elif translate:
            seg = _SatSegmenter(args.sat_dir or os.path.join(live_dir, "sat-pack"))
    except Exception as e:
        emit({"type": "status", "message": "Khong nap duoc model cat cau: %s" % str(e)[:120]})

    hold = translate is not None

    def send(text):
        if not text.strip():
            return
        vi = None
        if translate:
            try:
                vi = translate(text)
            except Exception as e:
                emit({"type": "status", "message": "Loi dich: %s" % str(e)[:100]})
        emit({"type": "final", "text": text, "vi": vi})

    stream = rec.create_stream()
    emit({"type": "ready", "translate": translate is not None})

    CHUNK = 3200 * 4
    last = ""
    buf = b""
    while True:
        data = sys.stdin.buffer.read(CHUNK)
        if not data:
            break
        buf += data
        n = (len(buf) // 4) * 4
        if n == 0:
            continue
        samples = np.frombuffer(buf[:n], dtype=np.float32)
        buf = buf[n:]

        stream.accept_waveform(16000, samples)
        while rec.is_ready(stream):
            rec.decode_stream(stream)
        text = rec.get_result(stream)

        if rec.is_endpoint(stream):
            if text.strip():
                for s in (seg.feed(text, force=not hold) if seg else [text]):
                    send(s)
            elif seg:
                for s in seg.flush():
                    send(s)
            rec.reset(stream)
            last = ""
        elif text != last:
            emit({"type": "partial", "text": text})
            last = text

    try:
        stream.input_finished()
        while rec.is_ready(stream):
            rec.decode_stream(stream)
        text = rec.get_result(stream)
        if seg:
            for s in (seg.feed(text) if text.strip() else []) + seg.flush():
                send(s)
        elif text.strip():
            send(text)
    except Exception:
        pass

    emit({"type": "status", "message": "Da dung nghe."})
    return 0


def main():
    p = argparse.ArgumentParser(description="whisper-engine")
    p.add_argument("--input", help="file audio/video dau vao (che do file)")
    p.add_argument("--output-dir", help="thu muc luu ket qua (che do file)")
    p.add_argument("--basename", default=None, help="ten file xuat (khong duoi)")
    p.add_argument("--model", default="small", help="tiny|base|small|medium|large-v3")
    p.add_argument("--model-dir", default=None, help="noi cache model (userData)")
    p.add_argument("--language", default="auto", help="auto | ma ngon ngu (vi, en...)")
    p.add_argument("--task", default="transcribe", choices=["transcribe", "translate"])
    p.add_argument("--formats", default="srt", help="danh sach: srt,txt,vtt")
    p.add_argument("--device", default="auto", help="auto|cpu|cuda")
    p.add_argument("--compute-type", default=None, help="int8|float16|auto|...")
    p.add_argument("--threads", type=int, default=0, help="so luong CPU thread (0=auto)")
    p.add_argument("--cuda-dir", default=None, help="thu muc chua cuBLAS/cuDNN (goi tang toc GPU)")
    p.add_argument("--diarize", action="store_true", help="nhan dien ai noi luc nao")
    p.add_argument("--speakers", type=int, default=0, help="so nguoi noi (0 = tu doan)")
    p.add_argument("--live", action="store_true", help="che do nghe truc tiep tu stdin")
    p.add_argument("--live-dir", default=None, help="thu muc goi Thong dich")
    p.add_argument("--translate", default=None, help="dich sang tieng nao (vi|en)")
    p.add_argument("--lang", default="en", help="tieng cua nguoi noi")
    p.add_argument("--sat-dir", default=None, help="thu muc goi SaT")
    args = p.parse_args()

    if args.live:
        return run_live(args)

    if not args.input or not args.output_dir:
        emit({"type": "error", "message": "Thieu --input hoac --output-dir"})
        return 1

    device = args.device
    if device == "auto":
        device = "cpu"

    if device == "cuda" and args.cuda_dir and os.path.isdir(args.cuda_dir):
        cdir = os.path.abspath(args.cuda_dir)
        os.environ["PATH"] = cdir + os.pathsep + os.environ.get("PATH", "")
        if hasattr(os, "add_dll_directory"):
            try:
                os.add_dll_directory(cdir)
            except Exception:
                pass

    try:
        from faster_whisper import WhisperModel
    except Exception as e:
        emit({"type": "error", "message": "Khong nap duoc faster_whisper: %s" % e})
        return 1

    if args.compute_type:
        compute_type = args.compute_type
    elif device == "cuda":
        compute_type = "auto"
    else:
        compute_type = "int8"

    try:
        emit({"type": "status", "message": "Dang nap model %s (%s)..." % (args.model, device)})
        model = WhisperModel(
            args.model,
            device=device,
            compute_type=compute_type,
            download_root=args.model_dir,
            cpu_threads=max(0, args.threads),
        )
    except Exception as e:
        emit({"type": "error", "message": "Loi nap model: %s" % e})
        return 1

    lang = None if args.language in ("auto", "") else args.language
    try:
        segments, info = model.transcribe(
            args.input,
            language=lang,
            task=args.task,
            vad_filter=True,
            word_timestamps=True,
        )
    except Exception as e:
        emit({"type": "error", "message": "Loi phien am: %s" % e})
        return 1

    duration = float(getattr(info, "duration", 0) or 0)
    emit({
        "type": "info",
        "language": getattr(info, "language", None),
        "language_probability": getattr(info, "language_probability", None),
        "duration": duration,
    })

    collected = []
    try:
        for seg in segments:
            item = {"start": seg.start, "end": seg.end, "text": seg.text}
            collected.append(item)
            emit({"type": "progress", "seconds": float(seg.end or 0),
                  "duration": duration, "text": seg.text.strip()})
    except Exception as e:
        emit({"type": "error", "message": "Loi trong khi phien am: %s" % e})
        return 1

    speakers_found = 0
    if args.diarize and collected:
        try:
            emit({"type": "status", "message": "Dang nhan dien nguoi noi..."})
            speakers_found = diarize_segments(collected, args.input, args.speakers)
            if speakers_found:
                emit({"type": "status", "message": "Nhan dien xong: %d nguoi noi" % speakers_found})
        except Exception as e:
            emit({"type": "status", "message": "Bo qua nhan dien nguoi noi (loi: %s)" % str(e)[:120]})

    base = args.basename or os.path.splitext(os.path.basename(args.input))[0]
    os.makedirs(args.output_dir, exist_ok=True)
    fmts = [x.strip().lower() for x in args.formats.split(",") if x.strip()]
    outputs = []
    if "srt" in fmts:
        pth = os.path.join(args.output_dir, base + ".srt")
        write_srt(collected, pth); outputs.append(pth)
    if "vtt" in fmts:
        pth = os.path.join(args.output_dir, base + ".vtt")
        write_vtt(collected, pth); outputs.append(pth)
    if "txt" in fmts:
        pth = os.path.join(args.output_dir, base + ".txt")
        write_txt(collected, pth); outputs.append(pth)

    emit({"type": "done", "outputs": outputs, "segments": len(collected),
          "speakers": speakers_found})
    return 0


if __name__ == "__main__":
    sys.exit(main())
