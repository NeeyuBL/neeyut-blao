# -*- coding: utf-8 -*-
"""ocr-engine — doc chu chay tren video, xuat .srt

Giao thuc: JSON-lines ra stdout (giong whisper-engine):
  {"type":"info","frames":183,"fps":2}
  {"type":"progress","percent":42,"text":"<chu vua doc duoc>"}
  {"type":"done","output":"...","count":48}
  {"type":"error","message":"..."}

Chay:
  engine --input <video> --output <file.srt> [--y0 N --y1 N] [--fps 2] [--ffmpeg PATH]

Nhung dieu DA DO BANG SO LIEU (dung tu y "toi uu" lai):
 1. OCR CA KHUNG roi LOC khung chu theo vung. KHONG cat anh theo vung:
    dai qua det -> bo do chu phong theo canh nho -> vua cham vua vo vun
    ('Wi11', 's1mple'). Ca khung: 1067ms/cau tron. Cat dai: 1387ms/12 manh.
 2. SO PIXEL THO khong dung duoc: toc + nen chuyen dong SAU chu lam no bao dong
    gia lien tuc (chu dung yen ma lech tho len toi 41). Loc MASK TRANG thi tach
    bach gap 20 lan: dung yen 0-1.7 vs doi that 38-58.
 3. Mask trang van hut cho phu de nam tren nen SANG -> cat nham. KHONG di tinh
    chinh nguong (moi video moi khac, siet qua thi NUOT CAU am tham). Lay CHINH
    CHU lam su that: trung chu doan truoc -> noi dai. Bo so khung chi con la
    thu toi uu toc do, khong quyet dinh dung/sai.
"""
import argparse
import json
import os
import subprocess
import sys
import tempfile

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def emit(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


# Do that (GENZ.mp4, video Trung): do doi chu bang `mean(absdiff(mask))` bi DIEN
# TICH VUNG lam loang — user khoanh vung rong thi dong chu chi chiem phan nho,
# chu doi bi nen pha loang xuong duoi nguong -> 14 cau bi gop con 2, NUOT AM
# THAM 85%. Do lech JACCARD cua pixel chu (chi xet cho CO chu) BAT BIEN voi do
# rong vung: vung rong 20 doan · vung sat 19 doan (~14 cau that). 2 -> 15 cau.
NG_DOI = 0.45     # lech Jaccard giua 2 khung > nguong nay -> CHU DOI (mo doan moi)
NG_TRUNG = 0.15   # 2 khung lech Jaccard < nguong nay -> CUNG 1 cau, dung lai OCR cu


def mask_trang(vung, cv2):
    hsv = cv2.cvtColor(vung, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (0, 0, 200), (180, 40, 255))


def jaccard(a, b, np):
    """Do lech 2 mask chu = 1 - (giao / hop) tren pixel trang. Bang 0 khi ca 2
    khung deu khong co chu. KHONG chia deu ca dai nen khong phu thuoc do rong vung."""
    A = a > 0
    B = b > 0
    hop = int(np.count_nonzero(A | B))
    if hop == 0:
        return 0.0
    return 1.0 - int(np.count_nonzero(A & B)) / hop


def hhmmss(giay):
    h, m = int(giay // 3600), int(giay % 3600 // 60)
    s, ms = int(giay % 60), int(round((giay - int(giay)) * 1000))
    return "%02d:%02d:%02d,%03d" % (h, m, s, ms)


def rut_khung(ffmpeg, video, thu_muc, fps):
    p = subprocess.run(
        [ffmpeg, "-y", "-i", video, "-vf", "fps=%d" % fps, "-q:v", "2",
         os.path.join(thu_muc, "f%06d.jpg")],
        capture_output=True,
    )
    if p.returncode != 0:
        raise RuntimeError("ffmpeg: %s" % p.stderr.decode("utf-8", "replace")[-300:])
    return sorted(os.path.join(thu_muc, f) for f in os.listdir(thu_muc) if f.endswith(".jpg"))


def phan_doan(files, y0, y1, x0, x1, cv2, np):
    """1 luot: doc mask tung khung, cat doan khi chu doi (Jaccard > NG_DOI).
    Tra ve: danh sach doan (a, b) + `rung[i]` = do lech Jaccard khung i so voi
    khung truoc (dung sau de chon khung dung yen nhat)."""
    doan, prev, bat_dau = [], None, 0
    rung = [0.0] * len(files)
    for i, p in enumerate(files):
        im = cv2.imread(p)
        if im is None:
            continue
        m = mask_trang(im[y0:y1, x0:x1], cv2)
        if prev is not None:
            d = jaccard(m, prev, np)
            rung[i] = d
            if d > NG_DOI and i > bat_dau:
                doan.append((bat_dau, i - 1))
                bat_dau = i
        prev = m
    doan.append((bat_dau, len(files) - 1))
    return doan, rung


def khung_on_dinh(rung, a, b):
    """Khung IT RUNG nhat trong doan -> chu da dung han, tranh khung dang doi
    hieu ung (mo dan / truot) — thu da do ra chu RAC ma diem OCR van cao (0.8+),
    loc theo diem khong cuu duoc, phai chon theo do on dinh cua khung."""
    best, best_d = a, 1e18
    for i in range(a, b + 1):
        d = rung[i]
        if i + 1 < len(rung):
            d += rung[i + 1]
        if d < best_d:
            best_d, best = d, i
    return best


def gpu_that_su_chay():
    """Thu THAT xem DirectML co an khong."""
    try:
        import onnxruntime as ort
        if "DmlExecutionProvider" not in ort.get_available_providers():
            return False
        import rapidocr_onnxruntime, os as _os, glob as _glob
        md = _glob.glob(_os.path.join(_os.path.dirname(rapidocr_onnxruntime.__file__), "models", "*det*.onnx"))
        if not md:
            return False
        s = ort.InferenceSession(md[0], providers=["DmlExecutionProvider", "CPUExecutionProvider"])
        return "DmlExecutionProvider" in s.get_providers()
    except Exception:
        return False


def tao_ocr():
    """Tao RapidOCR uu tien DirectML (GPU), tu tut CPU neu khong duoc."""
    from rapidocr_onnxruntime import RapidOCR
    if gpu_that_su_chay():
        try:
            o = RapidOCR(det_use_dml=True, cls_use_dml=True, rec_use_dml=True)
            emit({"type": "status", "message": "Dùng tăng tốc GPU…"})
            return o
        except Exception:
            pass
    return RapidOCR()


def run(args):
    import cv2
    import numpy as np

    ocr = tao_ocr()
    with tempfile.TemporaryDirectory() as td:
        emit({"type": "status", "message": "Đang tách khung hình…"})
        files = rut_khung(args.ffmpeg, args.input, td, args.fps)
        if not files:
            raise RuntimeError("Không tách được khung hình nào")

        im0 = cv2.imread(files[0])
        H, W = im0.shape[0], im0.shape[1]
        y0 = args.y0 if args.y0 >= 0 else int(H * 0.75)
        y1 = args.y1 if args.y1 > 0 else H
        x0 = args.x0 if args.x0 >= 0 else 0
        x1 = args.x1 if args.x1 > 0 else W
        emit({"type": "info", "frames": len(files), "fps": args.fps, "height": H})

        emit({"type": "status", "message": "Đang tìm chỗ chữ đổi…"})
        doan, rung = phan_doan(files, y0, y1, x0, x1, cv2, np)

        subs = []
        mask_cu, text_cu = None, None
        band_top, band_bot = None, None
        for k, (a, b) in enumerate(doan):
            i = khung_on_dinh(rung, a, b)
            m = mask_trang(cv2.imread(files[i])[y0:y1, x0:x1], cv2)
            if mask_cu is not None and jaccard(m, mask_cu, np) < NG_TRUNG:
                text = text_cu
            else:
                res, _ = ocr(files[i])
                chu = []
                for box, t, score in (res or []):
                    cx = sum(pt[0] for pt in box) / 4
                    cy = sum(pt[1] for pt in box) / 4
                    if y0 <= cy <= y1 and x0 <= cx <= x1 and score > 0.5:
                        chu.append((min(pt[0] for pt in box), t))
                        ys = [pt[1] for pt in box]
                        band_top = min(ys) if band_top is None else min(band_top, min(ys))
                        band_bot = max(ys) if band_bot is None else max(band_bot, max(ys))
                text = " ".join(t for _, t in sorted(chu)) if chu else ""
                mask_cu, text_cu = m, text
            emit({
                "type": "progress",
                "percent": int((k + 1) / len(doan) * 100),
                "text": text,
            })
            if not text:
                continue
            if subs and subs[-1][2] == text and abs(subs[-1][1] - a / args.fps) < 1e-6:
                subs[-1] = (subs[-1][0], (b + 1) / args.fps, text)
            else:
                subs.append((a / args.fps, (b + 1) / args.fps, text))

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        for i, (a, b, t) in enumerate(subs, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (i, hhmmss(a), hhmmss(b), t))
    emit({
        "type": "done",
        "output": args.output,
        "count": len(subs),
        "band_top": int(band_top) if band_top is not None else None,
        "band_bot": int(band_bot) if band_bot is not None else None,
    })
    return 0


def main():
    p = argparse.ArgumentParser(description="ocr-engine")
    p.add_argument("--input", required=True, help="file video")
    p.add_argument("--output", required=True, help="file .srt xuat ra")
    p.add_argument("--y0", type=int, default=-1, help="mep TREN vung chu (px, -1 = tu chon)")
    p.add_argument("--y1", type=int, default=-1, help="mep DUOI vung chu (px)")
    p.add_argument("--x0", type=int, default=-1, help="mep TRAI vung chu (px, -1 = tu chon)")
    p.add_argument("--x1", type=int, default=-1, help="mep PHAI vung chu (px)")
    p.add_argument("--fps", type=int, default=2, help="so khung/giay lay ra")
    p.add_argument("--ffmpeg", default="ffmpeg", help="duong dan ffmpeg")
    args = p.parse_args()
    try:
        return run(args)
    except Exception as e:
        emit({"type": "error", "message": str(e)[:300]})
        return 1


if __name__ == "__main__":
    sys.exit(main())
