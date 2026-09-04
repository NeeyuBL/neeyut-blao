# -*- coding: utf-8 -*-
"""ocr-engine — doc chu chay tren video, xuat .srt

Giao thuc: JSON-lines ra stdout (giong whisper-engine):
  {"type":"info","frames":183,"fps":6}
  {"type":"progress","percent":42,"text":"<chu vua doc duoc>"}
  {"type":"done","output":"...","count":48}
  {"type":"error","message":"..."}

Chay:
  engine --input <video> --output <file.srt> [--y0 N --y1 N] [--fps 6] [--ffmpeg PATH]

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
from dataclasses import dataclass, field
from difflib import SequenceMatcher
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata


PROVIDER_NAMES = {
    "cuda": "CUDAExecutionProvider",
    "directml": "DmlExecutionProvider",
    "cpu": "CPUExecutionProvider",
}


class ProviderError(RuntimeError):
    pass

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
NG_DOI = 0.32
TEXT_SIMILARITY = 0.82
TEXT_MERGE_GAP = 0.55
MIN_CUE_DURATION = 0.25
RESET_REMOVED_RATIO = 0.42
RESET_ADDED_RATIO = 0.16
HARD_RESET_REMOVED_RATIO = 0.72
MAX_EPISODE_SAMPLES = 3
DEFAULT_SCAN_FPS = 6
DETECTION_BOX_THRESHOLD = 0.35
DETECTION_MIN_SCORE = 0.25
DETECTION_MISS_SECONDS = 0.34
DETECTION_MAX_EPISODE_SECONDS = 3.0


@dataclass
class OcrCandidate:
    start: float
    end: float
    text: str
    confidence: float
    bbox: tuple | None
    frame_index: int


@dataclass
class SubtitleEpisode:
    candidates: list = field(default_factory=list)


@dataclass
class FinalCue:
    start: float
    end: float
    text: str
    bbox: tuple | None
    candidates: list = field(default_factory=list)


@dataclass
class TextObservation:
    frame_index: int
    confidence: float
    bbox: tuple
    boxes: list = field(default_factory=list)


@dataclass
class DetectionEpisode:
    start_frame: int
    end_frame: int
    observations: list = field(default_factory=list)


def mask_trang(vung, cv2):
    hsv = cv2.cvtColor(vung, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (0, 0, 200), (180, 40, 255))


def mask_chu(vung, cv2, np):
    """Mask subtitle khong khoa vao mau trang.

    Lay pixel sang, pixel mau noi va canh nam sat cac pixel do. Thanh phan qua
    lon (tuong troi sang) va hat qua nho bi loai de chuyen dong nen it anh huong
    hon. Doi mau karaoke van giu gan nhu cung hinh dang ky tu.
    """
    hsv = cv2.cvtColor(vung, cv2.COLOR_BGR2HSV)
    gray = cv2.cvtColor(vung, cv2.COLOR_BGR2GRAY)
    bright = cv2.inRange(hsv, (0, 0, 175), (180, 95, 255))
    colorful = cv2.inRange(hsv, (0, 70, 95), (180, 255, 255))
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
    edges = cv2.Canny(gray, 60, 160)
    dark = cv2.inRange(gray, 0, 85)
    sources = (cv2.bitwise_or(bright, colorful), dark)
    cleaned = np.zeros_like(gray)
    region_area = max(1, gray.shape[0] * gray.shape[1])
    max_area = max(300, int(region_area * 0.08))
    max_h = max(12, int(gray.shape[0] * 0.50))
    for foreground in sources:
        support = cv2.dilate(foreground, kernel, iterations=1)
        combined = cv2.bitwise_or(foreground, cv2.bitwise_and(edges, support))
        combined = cv2.morphologyEx(combined, cv2.MORPH_CLOSE, kernel)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(combined, 8)
        for label in range(1, count):
            x, y, w, h, area = stats[label]
            if 3 <= area <= max_area and 2 <= h <= max_h and w <= gray.shape[1] * 0.95:
                cleaned[labels == label] = 255
    return cleaned


def jaccard(a, b, np):
    """Do lech 2 mask chu = 1 - (giao / hop) tren pixel trang. Bang 0 khi ca 2
    khung deu khong co chu. KHONG chia deu ca dai nen khong phu thuoc do rong vung."""
    A = a > 0
    B = b > 0
    hop = int(np.count_nonzero(A | B))
    if hop == 0:
        return 0.0
    return 1.0 - int(np.count_nonzero(A & B)) / hop


def directional_mask_change(previous, current, cv2, np):
    """Tra ve (added, removed) va bo qua rung vien 1 pixel.

    Jaccard doi xung khong phan biet animation them chu voi mot cau moi thay
    cau cu. Subtitle reveal chu yeu co `added` cao, `removed` thap; thay cau
    that co luong pixel cu bi xoa (`removed`) lon.
    """
    if previous.shape != current.shape:
        current = cv2.resize(
            current,
            (previous.shape[1], previous.shape[0]),
            interpolation=cv2.INTER_NEAREST,
        )
    old = previous > 0
    new = current > 0
    old_count = int(np.count_nonzero(old))
    new_count = int(np.count_nonzero(new))
    if old_count == 0 and new_count == 0:
        return 0.0, 0.0
    kernel = np.ones((3, 3), dtype=np.uint8)
    old_near = cv2.dilate(old.astype(np.uint8), kernel, iterations=1) > 0
    new_near = cv2.dilate(new.astype(np.uint8), kernel, iterations=1) > 0
    removed = int(np.count_nonzero(old & ~new_near)) / max(1, old_count)
    added = int(np.count_nonzero(new & ~old_near)) / max(1, new_count)
    return float(added), float(removed)


def mask_similarity(a, b, cv2, np):
    """Do giong cau truc 0..1 tren mask nhi phan, khong phu thuoc mau chu."""
    if a.shape != b.shape:
        b = cv2.resize(b, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_NEAREST)
    x = a.astype(np.float32) / 255.0
    y = b.astype(np.float32) / 255.0
    mu_x = cv2.GaussianBlur(x, (7, 7), 1.5)
    mu_y = cv2.GaussianBlur(y, (7, 7), 1.5)
    sigma_x = cv2.GaussianBlur(x * x, (7, 7), 1.5) - mu_x * mu_x
    sigma_y = cv2.GaussianBlur(y * y, (7, 7), 1.5) - mu_y * mu_y
    sigma_xy = cv2.GaussianBlur(x * y, (7, 7), 1.5) - mu_x * mu_y
    c1, c2 = 0.01 ** 2, 0.03 ** 2
    score = ((2 * mu_x * mu_y + c1) * (2 * sigma_xy + c2)) / (
        (mu_x * mu_x + mu_y * mu_y + c1) * (sigma_x + sigma_y + c2) + 1e-8
    )
    return float(np.clip(np.mean(score), 0.0, 1.0))


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


def visual_reset_clusters(added, removed, changes, fps):
    """Tra ve cac cum frame dang thay/chuyen subtitle.

    Cum duoc giu nguyen ca moc dau va cuoi de pipeline detection co the OCR
    phan on dinh truoc/sau transition, thay vi nuot cau ngan vao frame cuoi.
    """
    resets = []
    frame_count = min(len(added), len(removed), len(changes))
    for i in range(1, frame_count):
        is_hard_reset = removed[i] >= HARD_RESET_REMOVED_RATIO
        is_replacement = (
            removed[i] >= RESET_REMOVED_RATIO
            and added[i] >= RESET_ADDED_RATIO
            and changes[i] >= NG_DOI
        )
        if is_hard_reset or is_replacement:
            resets.append(i)

    cluster_gap = max(1, int(round(fps * 0.75)))
    clusters = []
    for frame in resets:
        if clusters and frame - clusters[-1][-1] <= cluster_gap:
            clusters[-1].append(frame)
        else:
            clusters.append([frame])
    return clusters


def visual_episode_ranges(frame_count, added, removed, changes, fps):
    """Gom frame thanh vong doi subtitle truoc khi OCR.

    Cac transition co nhieu pixel CU bi xoa moi la moc thay cau. Nhieu moc sat
    nhau la mot animation/fade duy nhat va duoc gom, lay moc CUOI de tranh OCR
    frame dang chuyen. Them chu, highlight va pop khong tao episode moi.
    """
    if frame_count <= 0:
        return []
    clusters = visual_reset_clusters(added, removed, changes, fps)
    min_episode_frames = max(1, int(round(fps * 0.40)))
    boundaries = [cluster[-1] for cluster in clusters]
    episodes, start = [], 0
    for boundary in boundaries:
        if boundary - start < min_episode_frames:
            continue
        episodes.append((start, boundary - 1))
        start = boundary
    if start < frame_count:
        episodes.append((start, frame_count - 1))
    return episodes


def phan_doan(files, y0, y1, x0, x1, fps, cv2, np, on_progress=None):
    """Luot thi giac re: tao episode subtitle, chua OCR.

    Khac cach cu, Jaccard chi do muc bien dong. Quyet dinh cat cue dung thay doi
    co huong: pixel cu BI XOA nhieu. Pixel moi duoc THEM vao duoc xem la reveal
    cua cung mot subtitle.
    """
    prev, prev_white = None, None
    rung = [0.0] * len(files)
    net = [0.0] * len(files)
    added = [0.0] * len(files)
    removed = [0.0] * len(files)
    report_every = max(1, len(files) // 100)
    for i, p in enumerate(files):
        im = cv2.imread(p)
        if im is None:
            continue
        roi = im[y0:y1, x0:x1]
        m = mask_chu(roi, cv2, np)
        white = mask_trang(roi, cv2)
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        net[i] = float(cv2.Laplacian(gray, cv2.CV_64F).var())
        if prev is not None:
            enough_white = (
                np.count_nonzero(white) >= 20
                and np.count_nonzero(prev_white) >= 20
            )
            # Phu de trang la truong hop pho bien: mask cu loc nen chuyen dong
            # tot hon. Mask da mau/den chi dung khi khong du pixel trang.
            current_signal = white if enough_white else m
            previous_signal = prev_white if enough_white else prev
            d_jaccard = jaccard(current_signal, previous_signal, np)
            d_structure = 1.0 - mask_similarity(m, prev, cv2, np)
            d = 0.85 * d_jaccard + 0.15 * d_structure
            rung[i] = d
            added[i], removed[i] = directional_mask_change(
                previous_signal, current_signal, cv2, np
            )
        prev = m
        prev_white = white
        if on_progress and ((i + 1) % report_every == 0 or i + 1 == len(files)):
            on_progress(i + 1, len(files))
    episodes = visual_episode_ranges(len(files), added, removed, rung, fps)
    return episodes, rung, net, added, removed


def khung_on_dinh(rung, net, a, b):
    """Khung IT RUNG nhat trong doan -> chu da dung han, tranh khung dang doi
    hieu ung (mo dan / truot) — thu da do ra chu RAC ma diem OCR van cao (0.8+),
    loc theo diem khong cuu duoc, phai chon theo do on dinh cua khung."""
    best, best_score = a, -1e18
    max_sharp = max([net[i] for i in range(a, b + 1)] or [1.0]) or 1.0
    for i in range(a, b + 1):
        d = rung[i]
        if i + 1 < len(rung):
            d += rung[i + 1]
        score = (net[i] / max_sharp) - d
        # Neu ngang diem, lay frame muon hon: reveal thuong day du nhat o cuoi.
        if score >= best_score:
            best_score, best = score, i
    return best


def khung_dai_dien(rung, net, a, b, limit=MAX_EPISODE_SAMPLES):
    """Chon toi da ba frame ro va on dinh, uu tien nua sau cua episode.

    OCR nhieu frame giup bo phieu sua mot ket qua loi, nhung khong OCR moi frame.
    Khoang cach toi thieu tranh chon ba anh gan nhu trung nhau.
    """
    if a > b:
        return []
    if b - a < 3 or limit <= 1:
        return [khung_on_dinh(rung, net, a, b)]
    max_sharp = max([net[i] for i in range(a, b + 1)] or [1.0]) or 1.0
    span = max(1, b - a)
    scored = []
    for i in range(a, b + 1):
        motion = rung[i] + (rung[i + 1] if i + 1 < len(rung) else 0.0)
        recency = (i - a) / span
        # Frame muon hon thuong da reveal du chu; do net va it rung van quyet dinh chinh.
        score = net[i] / max_sharp - motion * 1.35 + recency * 0.28
        scored.append((score, i))
    min_distance = max(1, int(round(span / max(4, limit + 1))))
    # Frame cuoi nam ngay truoc moc thay cau, thuong la luc reveal da day du.
    # Luon giu frame nay; chi dung diem on dinh de chon cac phieu bo sung.
    selected = [b]
    for _score, index in sorted(scored, reverse=True):
        if all(abs(index - other) >= min_distance for other in selected):
            selected.append(index)
            if len(selected) >= limit:
                break
    return sorted(selected or [khung_on_dinh(rung, net, a, b)])


def normalize_text(text):
    text = unicodedata.normalize("NFKC", text or "").casefold()
    return re.sub(r"\s+", " ", text).strip()


def compact_text(text):
    return "".join(
        ch for ch in normalize_text(text)
        if unicodedata.category(ch)[0] in ("L", "N")
    )


def _ngrams(text, size=2):
    if len(text) <= size:
        return {text} if text else set()
    return {text[i:i + size] for i in range(len(text) - size + 1)}


def _levenshtein_ratio(left, right):
    if left == right:
        return 1.0
    if not left or not right:
        return 0.0
    if len(left) > len(right):
        left, right = right, left
    previous = list(range(len(left) + 1))
    for row, char_right in enumerate(right, 1):
        current = [row]
        for col, char_left in enumerate(left, 1):
            current.append(min(
                current[-1] + 1,
                previous[col] + 1,
                previous[col - 1] + (char_left != char_right),
            ))
        previous = current
    return 1.0 - previous[-1] / max(len(left), len(right))


def text_similarity(left, right):
    a, b = compact_text(left), compact_text(right)
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    sequence = max(
        SequenceMatcher(None, a, b, autojunk=False).ratio(),
        _levenshtein_ratio(a, b),
    )
    na, nb = _ngrams(a), _ngrams(b)
    ngram = len(na & nb) / max(1, len(na | nb))
    ta, tb = set(normalize_text(left).split()), set(normalize_text(right).split())
    token = len(ta & tb) / max(1, len(ta | tb)) if ta and tb else 0.0
    # Token set bo qua thu tu; khong cho no tu gop hai cau dao vi tri tu neu
    # chuoi ky tu khong co du bang chung cung mot subtitle.
    token_score = token if sequence >= 0.70 else token * 0.60
    return max(sequence, ngram, token_score)


def _subsequence_fraction(shorter, longer):
    if not shorter:
        return 0.0
    pos = 0
    for char in longer:
        if pos < len(shorter) and shorter[pos] == char:
            pos += 1
    return pos / len(shorter)


def is_text_evolution(left, right):
    """True khi mot ket qua la phien ban dang hien dan cua ket qua kia."""
    a, b = compact_text(left), compact_text(right)
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    if len(short) < 2:
        # Reveal CJK co the bat dau tu mot ky tu. Chi chap nhan prefix de tranh
        # mot chu cai pho bien o giua hai cau khac nhau gay gop nham.
        return bool(short) and long.startswith(short)
    completeness = len(short) / max(1, len(long))
    if completeness < 0.30:
        return False
    return short in long or (
        _subsequence_fraction(short, long) >= 0.90
        and text_similarity(left, right) >= 0.58
    )


def is_reveal_variant(left, right):
    """So khop noi bo mot episode, duoc phep rong hon so khop giua hai cue.

    Episode da duoc thi giac xac dinh truoc, nen mot prefix rat ngan van la bang
    chung hop le cua word-by-word reveal. Khong dung ham nay de gop hai cue doc
    lap, tranh gop nham hai cau cung bat dau bang mot tu pho bien.
    """
    a, b = compact_text(left), compact_text(right)
    short, long = (a, b) if len(a) <= len(b) else (b, a)
    if not short or not long:
        return False
    if long.startswith(short):
        return True
    completeness = len(short) / max(1, len(long))
    return (
        completeness >= 0.18
        and _subsequence_fraction(short, long) >= 0.90
        and text_similarity(left, right) >= 0.42
    )


def bbox_overlap_min(left, right):
    if left is None or right is None:
        return 1.0
    x0 = max(left[0], right[0])
    y0 = max(left[1], right[1])
    x1 = min(left[2], right[2])
    y1 = min(left[3], right[3])
    inter = max(0.0, x1 - x0) * max(0.0, y1 - y0)
    area_left = max(1.0, (left[2] - left[0]) * (left[3] - left[1]))
    area_right = max(1.0, (right[2] - right[0]) * (right[3] - right[1]))
    return inter / min(area_left, area_right)


def _bbox_from_boxes(boxes):
    points = [point for box in boxes for point in box]
    if not points:
        return None
    xs = [float(point[0]) for point in points]
    ys = [float(point[1]) for point in points]
    return min(xs), min(ys), max(xs), max(ys)


def detect_frame_observation(ocr, path, frame_index, region):
    """Chay rieng model detection, chua doc noi dung chu.

    RapidOCR 3.x cho phep tat cls/rec cong khai. Nho vay moi frame duoc model
    nhin thay, trong khi buoc recognition ton kem chi chay tren frame dai dien.
    """
    y0, y1, x0, x1 = region
    result = ocr(
        path,
        use_det=True,
        use_cls=False,
        use_rec=False,
        box_thresh=DETECTION_BOX_THRESHOLD,
    )
    boxes = getattr(result, "boxes", None)
    scores = getattr(result, "scores", None)
    if boxes is None:
        return None
    if scores is None:
        scores = [1.0] * len(boxes)

    kept_boxes, kept_scores = [], []
    for box, score in zip(boxes, scores):
        if box is None or len(box) == 0:
            continue
        cx = sum(float(point[0]) for point in box) / len(box)
        cy = sum(float(point[1]) for point in box) / len(box)
        score = float(score)
        if y0 <= cy <= y1 and x0 <= cx <= x1 and score >= DETECTION_MIN_SCORE:
            kept_boxes.append(box)
            kept_scores.append(score)
    bbox = _bbox_from_boxes(kept_boxes)
    if bbox is None:
        return None
    return TextObservation(
        frame_index=frame_index,
        confidence=sum(kept_scores) / len(kept_scores),
        bbox=bbox,
        boxes=list(kept_boxes),
    )


def _observations_share_band(previous, current):
    """Cho phep do dai cau doi nhung khong noi hai vung chu o xa nhau."""
    if bbox_overlap_min(previous.bbox, current.bbox) >= 0.15:
        return True
    left, right = previous.bbox, current.bbox
    overlap_y = max(0.0, min(left[3], right[3]) - max(left[1], right[1]))
    min_height = max(1.0, min(left[3] - left[1], right[3] - right[1]))
    center_left = ((left[0] + left[2]) / 2, (left[1] + left[3]) / 2)
    center_right = ((right[0] + right[2]) / 2, (right[1] + right[3]) / 2)
    vertical_close = abs(center_left[1] - center_right[1]) <= max(
        left[3] - left[1], right[3] - right[1]
    )
    return overlap_y / min_height >= 0.45 and vertical_close


def _split_observations_at_transitions(observations, reset_clusters):
    """Bo frame dang transition, giu rieng hai phia on dinh cua moi cum."""
    groups = [list(observations)]
    for cluster in reset_clusters:
        first, last = cluster[0], cluster[-1]
        next_groups = []
        for group in groups:
            left = [item for item in group if item.frame_index < first]
            right = [item for item in group if item.frame_index >= last]
            if left:
                next_groups.append(left)
            if right:
                next_groups.append(right)
        groups = next_groups
    return groups


def build_detection_episodes(observations, added, removed, changes, fps, frame_count):
    """Tao episode tu su hien dien cua box chu va moc transition thi giac.

    Detection la tin hieu chinh. Mot vai frame mat box duoc noi lai de chiu
    fade/blink; transition tach noi dung cu/moi; episode dai duoc chia nho de
    khong the nuot nhieu cau khi mask khong bat duoc moc thay chu.
    """
    ordered = sorted(
        (item for item in observations if item is not None),
        key=lambda item: item.frame_index,
    )
    if not ordered:
        return []

    max_missing = max(1, int(round(fps * DETECTION_MISS_SECONDS)))
    activity_groups = [[ordered[0]]]
    for observation in ordered[1:]:
        previous = activity_groups[-1][-1]
        missing = observation.frame_index - previous.frame_index - 1
        if missing <= max_missing and _observations_share_band(previous, observation):
            activity_groups[-1].append(observation)
        else:
            activity_groups.append([observation])

    reset_clusters = visual_reset_clusters(added, removed, changes, fps)
    stable_groups = []
    for group in activity_groups:
        overlapping = [
            cluster for cluster in reset_clusters
            if group[0].frame_index < cluster[-1]
            and cluster[0] <= group[-1].frame_index
        ]
        stable_groups.extend(_split_observations_at_transitions(group, overlapping))

    max_span = max(2, int(round(fps * DETECTION_MAX_EPISODE_SECONDS)))
    capped_groups = []
    for group in stable_groups:
        chunk = []
        for observation in group:
            if chunk and observation.frame_index - chunk[0].frame_index >= max_span:
                capped_groups.append(chunk)
                chunk = []
            chunk.append(observation)
        if chunk:
            capped_groups.append(chunk)

    episodes = []
    for group in capped_groups:
        if not group:
            continue
        start = max(0, group[0].frame_index)
        end = min(frame_count - 1, group[-1].frame_index)
        episodes.append(DetectionEpisode(start, end, list(group)))
    return episodes


def detection_sample_indices(episode, rung, net, limit=MAX_EPISODE_SAMPLES):
    """Bat buoc giu frame dau/cuoi co box, phieu con lai chon frame ro nhat."""
    observations = sorted(episode.observations, key=lambda item: item.frame_index)
    if not observations or limit <= 0:
        return []
    first, last = observations[0], observations[-1]
    selected = [first.frame_index]
    if last.frame_index != first.frame_index and limit > 1:
        selected.append(last.frame_index)
    if len(selected) >= limit:
        return sorted(selected)

    sharpest = max((net[item.frame_index] for item in observations), default=1.0) or 1.0
    scored = []
    for observation in observations[1:-1]:
        index = observation.frame_index
        motion = rung[index] + (rung[index + 1] if index + 1 < len(rung) else 0.0)
        score = (
            net[index] / sharpest
            + observation.confidence * 0.45
            - motion * 1.20
        )
        scored.append((score, index))
    for _score, index in sorted(scored, reverse=True):
        if index not in selected:
            selected.append(index)
            if len(selected) >= limit:
                break
    return sorted(selected)


def _same_episode(previous, current):
    gap = max(0.0, current.start - previous.end)
    if gap > TEXT_MERGE_GAP or bbox_overlap_min(previous.bbox, current.bbox) < 0.52:
        return False
    similarity = text_similarity(previous.text, current.text)
    return similarity >= TEXT_SIMILARITY or is_text_evolution(previous.text, current.text)


def _choose_episode_text(candidates):
    """Chon bien the day du va duoc nhieu frame ung ho nhat."""
    if not candidates:
        return ""
    same_window = all(
        item.start == candidates[0].start and item.end == candidates[0].end
        for item in candidates
    )
    if same_window and len(candidates) > 1:
        # Cac phieu trong mot episode co cung timestamp. Khi do duration khong
        # phai bang chung rieng; uu tien noi dung day du, frame muon, confidence
        # va su dong thuan. Phieu cuoi confidence thap se khong duoc chon chi vi
        # no xuat hien muon.
        ordered = sorted(candidates, key=lambda item: item.frame_index)
        first_frame, last_frame = ordered[0].frame_index, ordered[-1].frame_index
        frame_span = max(1, last_frame - first_frame)
        max_len = max(1, max(len(compact_text(item.text)) for item in ordered))
        best_text, best_score = ordered[0].text, -1.0
        for candidate in ordered:
            support = sum(
                text_similarity(candidate.text, other.text) for other in ordered
            ) / len(ordered)
            completeness = len(compact_text(candidate.text)) / max_len
            recency = (candidate.frame_index - first_frame) / frame_span
            confidence_penalty = max(0.0, 0.82 - candidate.confidence) * 3.0
            score = (
                support * 0.90
                + candidate.confidence * 1.10
                + completeness * 1.25
                + recency * 0.55
                - confidence_penalty
            )
            if score >= best_score:
                best_text, best_score = candidate.text, score
        return best_text

    longest = max(candidates, key=lambda item: (len(compact_text(item.text)), item.confidence))
    related = sum(
        1 for item in candidates
        if item is longest or is_reveal_variant(item.text, longest.text)
    )
    if related / len(candidates) >= 0.60:
        return longest.text

    best_text, best_score = candidates[0].text, -1.0
    max_len = max(1, max(len(compact_text(item.text)) for item in candidates))
    for candidate in candidates:
        support = 0.0
        for other in candidates:
            duration = max(0.05, other.end - other.start)
            support += duration * text_similarity(candidate.text, other.text)
        completeness = len(compact_text(candidate.text)) / max_len
        score = support * 2.0 + candidate.confidence + completeness * 0.35
        if score > best_score:
            best_text, best_score = candidate.text, score
    return best_text


def _episode_to_cue(episode):
    candidates = episode.candidates
    if not candidates:
        return None
    start, end = candidates[0].start, candidates[-1].end
    if end - start < MIN_CUE_DURATION:
        return None
    chosen_text = _choose_episode_text(candidates)
    representative = max(
        candidates,
        key=lambda item: (text_similarity(item.text, chosen_text), item.confidence),
    )
    return FinalCue(start, end, chosen_text, representative.bbox, list(candidates))


def _merge_final_cues(cues):
    """Bao hiem khi bo tach thi giac dat moc ngay giua mot animation dai."""
    merged = []
    for cue in cues:
        if merged:
            previous = merged[-1]
            gap = max(0.0, cue.start - previous.end)
            same_place = bbox_overlap_min(previous.bbox, cue.bbox) >= 0.52
            related = (
                text_similarity(previous.text, cue.text) >= 0.86
                or is_text_evolution(previous.text, cue.text)
            )
            if gap <= 0.40 and same_place and related:
                combined = SubtitleEpisode(previous.candidates + cue.candidates)
                merged[-1] = _episode_to_cue(combined)
                continue
        merged.append(cue)
    return [cue for cue in merged if cue is not None]


def build_episode_cues(candidate_groups):
    """Moi nhom da la mot episode thi giac; OCR chi bo phieu noi dung trong nhom."""
    cues = []
    for candidates in candidate_groups:
        cue = _episode_to_cue(SubtitleEpisode(list(candidates)))
        if cue and cue.text:
            cues.append(cue)
    return _merge_final_cues(cues)


def build_final_cues(candidates):
    episodes = []
    for candidate in candidates:
        if not episodes:
            episodes.append(SubtitleEpisode([candidate]))
            continue
        if _same_episode(episodes[-1].candidates[-1], candidate):
            episodes[-1].candidates.append(candidate)
            continue
        # Mot OCR blip ngan khong duoc cat doi mot episode on dinh: neu ket qua
        # moi quay lai khop episode truoc blip, hap thu blip vao chuoi do de bo
        # phieu thay vi xuat thanh cue rac rieng.
        if len(episodes) >= 2:
            blip = episodes[-1]
            blip_duration = blip.candidates[-1].end - blip.candidates[0].start
            anchor = episodes[-2].candidates[-1]
            if blip_duration <= 0.50 and _same_episode(anchor, candidate):
                episodes[-2].candidates.extend(blip.candidates)
                episodes[-2].candidates.append(candidate)
                episodes.pop()
                continue
        episodes.append(SubtitleEpisode([candidate]))

    cues = [cue for cue in (_episode_to_cue(item) for item in episodes) if cue and cue.text]
    return _merge_final_cues(cues)


def _provider_options(provider, device_id):
    if provider == "cuda":
        return {"device_id": int(device_id), "do_copy_in_default_stream": True}
    if provider == "directml":
        return {"device_id": int(device_id)}
    return {}


def _session_handles(ocr):
    """Lay ba InferenceSession that cua RapidOCR 3.x (det/cls/rec)."""
    result = []
    for label, owner in (
        ("det", getattr(ocr, "text_det", None)),
        ("cls", getattr(ocr, "text_cls", None)),
        ("rec", getattr(ocr, "text_rec", None)),
    ):
        wrapper = getattr(owner, "session", None)
        session = getattr(wrapper, "session", None)
        if session is None or not hasattr(session, "get_providers"):
            raise ProviderError("Không đọc được provider của model %s." % label)
        result.append((label, session))
    return result


def _install_strict_provider(provider, device_id, require_gpu, forbid_cpu_fallback):
    """Bat RapidOCR tao session bang dung MOT provider da chon.

    RapidOCR mac dinh luon chen CPU vao cuoi danh sach. Voi GPU bat buoc, ta
    thay factory provider va bat session.disable_cpu_ep_fallback. Neu model co
    operator GPU khong ho tro, session phai LOI thay vi am tham chay CPU.
    """
    import onnxruntime as ort

    if provider == "cuda" and hasattr(ort, "preload_dlls"):
        # Artifact CUDA dong kem cac NVIDIA wheel; khong phu thuoc CUDA he thong.
        try:
            ort.preload_dlls(directory="")
        except Exception as exc:
            raise ProviderError("Không nạp được thư viện CUDA/cuDNN: %s" % exc) from exc

    expected = PROVIDER_NAMES[provider]
    available = list(ort.get_available_providers())
    if expected not in available:
        raise ProviderError(
            "%s không có trong engine. Provider hiện có: %s"
            % (expected, ", ".join(available) or "không có")
        )

    from rapidocr.inference_engine.onnxruntime.main import OrtInferSession
    from rapidocr.inference_engine.onnxruntime.provider_config import ProviderConfig

    options = _provider_options(provider, device_id)

    def strict_provider_list(_self):
        return [(expected, options)]

    ProviderConfig.get_ep_list = strict_provider_list

    if forbid_cpu_fallback:
        original_init = OrtInferSession._init_sess_opts

        def strict_session_options(cfg):
            session_options = original_init(cfg)
            session_options.add_session_config_entry("session.disable_cpu_ep_fallback", "1")
            return session_options

        OrtInferSession._init_sess_opts = staticmethod(strict_session_options)

    return ort, expected, available


def tao_ocr(provider, device_id=0, require_gpu=False, forbid_cpu_fallback=False):
    if provider not in PROVIDER_NAMES:
        raise ProviderError("Provider OCR không hợp lệ: %s" % provider)
    if require_gpu and provider == "cpu":
        raise ProviderError("Chế độ GPU bắt buộc không chấp nhận CPU.")
    if forbid_cpu_fallback and provider != "cuda":
        raise ProviderError("Chế độ cấm CPU fallback hiện chỉ hỗ trợ CUDA.")

    ort, expected, available = _install_strict_provider(
        provider, device_id, require_gpu, forbid_cpu_fallback
    )
    from rapidocr import RapidOCR

    params = {
        "EngineConfig.onnxruntime.use_cuda": provider == "cuda",
        "EngineConfig.onnxruntime.use_dml": provider == "directml",
        "EngineConfig.onnxruntime.cuda_ep_cfg.device_id": int(device_id),
    }
    ocr = RapidOCR(params=params)

    models = {}
    for label, session in _session_handles(ocr):
        providers = list(session.get_providers())
        primary = providers[0] if providers else None
        models[label] = primary
        if primary != expected:
            raise ProviderError(
                "Model %s dùng %s thay vì %s."
                % (label, primary or "không có provider", expected)
            )
        if forbid_cpu_fallback and "CPUExecutionProvider" in providers:
            raise ProviderError("Model %s vẫn đăng ký CPU fallback." % label)

    info = {
        "provider": provider,
        "execution_provider": expected,
        "available_providers": available,
        "models": models,
        "device_id": int(device_id),
        "strict": bool(forbid_cpu_fallback),
        "gpu_required": bool(require_gpu),
        "hybrid": bool(require_gpu and not forbid_cpu_fallback),
        "onnxruntime": getattr(ort, "__version__", "unknown"),
    }
    return ocr, info


def _ocr_rows(result):
    """Chuan hoa output RapidOCR 3.x thanh (box, text, score)."""
    boxes = getattr(result, "boxes", None)
    texts = getattr(result, "txts", None)
    scores = getattr(result, "scores", None)
    if boxes is None or texts is None or scores is None:
        return []
    return list(zip(boxes, texts, scores))


def self_test(provider, device_id, require_gpu, forbid_cpu_fallback):
    import cv2
    import numpy as np

    ocr, info = tao_ocr(provider, device_id, require_gpu, forbid_cpu_fallback)
    image = np.full((160, 520, 3), 255, dtype=np.uint8)
    cv2.putText(image, "T-BLAO 123", (24, 100), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (0, 0, 0), 3)
    # Luot dau khoi dong graph; luot hai moi dung de so sanh adapter DirectML.
    # Tren laptop, adapter 0 co the la iGPU va adapter 1 moi la GPU roi manh hon.
    ocr(image)
    started = time.perf_counter()
    result = ocr(image)
    info["inference_ms"] = round((time.perf_counter() - started) * 1000, 2)
    # Buoc nay ep det + cls + rec thuc su Run, khong chi khoi tao session.
    info["inference_ok"] = result is not None
    emit({"type": "self-test", "ok": True, **info})
    return 0


def ocr_frame_candidate(ocr, path, frame_index, a, b, fps, region):
    """OCR mot frame va tra ve ung vien da loc trong vung user chon."""
    y0, y1, x0, x1 = region
    # Detection-only o tren thay doi trang thai runtime cua RapidOCR. Luon bat
    # lai du ba buoc de frame dai dien thuc su duoc doc noi dung.
    result = ocr(
        path,
        use_det=True,
        use_cls=True,
        use_rec=True,
        text_score=0.5,
        box_thresh=0.5,
    )
    rows = []
    for box, text, score in _ocr_rows(result):
        cx = sum(point[0] for point in box) / 4
        cy = sum(point[1] for point in box) / 4
        if not (y0 <= cy <= y1 and x0 <= cx <= x1 and score > 0.5):
            continue
        xs = [float(point[0]) for point in box]
        ys = [float(point[1]) for point in box]
        rows.append({
            "x0": min(xs), "y0": min(ys), "x1": max(xs), "y1": max(ys),
            "cy": cy, "text": str(text).strip(), "score": float(score),
        })
    rows = [row for row in rows if row["text"]]
    if not rows:
        return None

    # Gom theo dong truoc, roi moi sap xep trai -> phai. Cach cu chi sap x nen
    # subtitle hai dong co the bi tron thu tu.
    heights = [row["y1"] - row["y0"] for row in rows]
    line_tolerance = max(4.0, sum(heights) / max(1, len(heights)) * 0.65)
    rows.sort(key=lambda row: (row["cy"], row["x0"]))
    lines = []
    for row in rows:
        if not lines or abs(row["cy"] - lines[-1]["cy"]) > line_tolerance:
            lines.append({"cy": row["cy"], "rows": [row]})
        else:
            lines[-1]["rows"].append(row)
            values = lines[-1]["rows"]
            lines[-1]["cy"] = sum(value["cy"] for value in values) / len(values)
    text_lines = []
    for line in lines:
        line["rows"].sort(key=lambda row: row["x0"])
        text_lines.append(" ".join(row["text"] for row in line["rows"]))

    bbox = (
        min(row["x0"] for row in rows), min(row["y0"] for row in rows),
        max(row["x1"] for row in rows), max(row["y1"] for row in rows),
    )
    confidence = sum(row["score"] for row in rows) / len(rows)
    return OcrCandidate(
        start=a / fps,
        # Mot subtitle rat ngan co the chi duoc detector nhin thay o mot frame.
        # Giu cue toi thieu 250 ms de buoc loc cuoi khong xoa mat no.
        end=max((b + 1) / fps, a / fps + MIN_CUE_DURATION),
        text="\n".join(text_lines),
        confidence=confidence,
        bbox=bbox,
        frame_index=frame_index,
    )


def run(args):
    import cv2
    import numpy as np

    ocr, provider_info = tao_ocr(
        args.provider, args.device_id, args.require_gpu, args.forbid_cpu_fallback
    )
    emit({
        "type": "provider",
        "provider": provider_info["provider"],
        "execution_provider": provider_info["execution_provider"],
        "device_id": provider_info["device_id"],
        "strict": provider_info["strict"],
        "models": provider_info["models"],
    })
    if args.provider == "cpu":
        emit({"type": "status", "message": "Đang dùng CPU…"})
    else:
        emit({"type": "status", "message": "Đang dùng GPU %s…" % provider_info["execution_provider"]})
    with tempfile.TemporaryDirectory() as td:
        emit({"type": "status", "message": "Đang tách khung hình…"})
        files = rut_khung(args.ffmpeg, args.input, td, args.fps)
        if not files:
            raise RuntimeError("Không tách được khung hình nào")

        im0 = cv2.imread(files[0])
        H, W = im0.shape[0], im0.shape[1]
        # Khong bat gioi han vung co nghia la quet ca khung hinh. Truoc day
        # engine am tham chi quet 25% phia duoi nen title/sub dau video bi sot.
        y0 = args.y0 if args.y0 >= 0 else 0
        y1 = args.y1 if args.y1 > 0 else H
        x0 = args.x0 if args.x0 >= 0 else 0
        x1 = args.x1 if args.x1 > 0 else W
        emit({"type": "info", "frames": len(files), "fps": args.fps, "height": H})

        emit({"type": "status", "message": "Đang theo dõi các đoạn phụ đề…"})
        last_scan_percent = -1

        def report_scan(done, total):
            nonlocal last_scan_percent
            percent = int(done / max(1, total) * 35)
            if percent == last_scan_percent:
                return
            last_scan_percent = percent
            emit({
                "type": "progress",
                "percent": percent,
                "text": "Đang theo dõi chữ trên video…",
            })

        visual_episodes, rung, net, added, removed = phan_doan(
            files, y0, y1, x0, x1, args.fps, cv2, np, report_scan
        )

        emit({"type": "status", "message": "Đang tìm và theo dõi vùng chữ…"})
        observations = []
        detection_count = 0
        detection_report_every = max(1, len(files) // 100)
        for i, path in enumerate(files):
            observation = detect_frame_observation(
                ocr, path, i, (y0, y1, x0, x1)
            )
            observations.append(observation)
            if observation is not None:
                detection_count += 1
            if (i + 1) % detection_report_every == 0 or i + 1 == len(files):
                emit({
                    "type": "progress",
                    "percent": 35 + int((i + 1) / max(1, len(files)) * 40),
                    "text": "",
                })

        episodes = build_detection_episodes(
            observations, added, removed, rung, args.fps, len(files)
        )

        candidates = []
        candidate_groups = []
        band_top, band_bot = None, None
        for k, episode in enumerate(episodes):
            a, b = episode.start_frame, episode.end_frame
            samples = []
            for i in detection_sample_indices(episode, rung, net):
                candidate = ocr_frame_candidate(
                    ocr, files[i], i, a, b, args.fps, (y0, y1, x0, x1)
                )
                if not candidate:
                    continue
                samples.append(candidate)
                candidates.append(candidate)
                if candidate.bbox:
                    band_top = candidate.bbox[1] if band_top is None else min(band_top, candidate.bbox[1])
                    band_bot = candidate.bbox[3] if band_bot is None else max(band_bot, candidate.bbox[3])
            if samples:
                candidate_groups.append(samples)
            text = _choose_episode_text(samples)
            emit({
                "type": "progress",
                "percent": 75 + int((k + 1) / max(1, len(episodes)) * 25),
                "text": text,
            })
        cues = build_episode_cues(candidate_groups)
        emit({
            "type": "diagnostic",
            "frames": len(files),
            "visual_segments": len(visual_episodes),
            "detection_frames": detection_count,
            "detection_episodes": len(episodes),
            "ocr_candidates": len(candidates),
            "final_cues": len(cues),
            "merged_candidates": max(0, len(candidates) - len(cues)),
        })

    os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
    with open(args.output, "w", encoding="utf-8") as f:
        for i, cue in enumerate(cues, 1):
            f.write("%d\n%s --> %s\n%s\n\n" % (
                i, hhmmss(cue.start), hhmmss(cue.end), cue.text
            ))
    emit({
        "type": "done",
        "output": args.output,
        "count": len(cues),
        "visual_segments": len(episodes),
        "ocr_candidates": len(candidates),
        "merged_candidates": max(0, len(candidates) - len(cues)),
        "band_top": int(band_top) if band_top is not None else None,
        "band_bot": int(band_bot) if band_bot is not None else None,
    })
    return 0


def main():
    p = argparse.ArgumentParser(description="ocr-engine")
    p.add_argument("--input", help="file video")
    p.add_argument("--output", help="file .srt xuat ra")
    p.add_argument("--y0", type=int, default=-1, help="mep TREN vung chu (px, -1 = tu chon)")
    p.add_argument("--y1", type=int, default=-1, help="mep DUOI vung chu (px)")
    p.add_argument("--x0", type=int, default=-1, help="mep TRAI vung chu (px, -1 = tu chon)")
    p.add_argument("--x1", type=int, default=-1, help="mep PHAI vung chu (px)")
    p.add_argument(
        "--fps", type=int, default=DEFAULT_SCAN_FPS,
        help="so khung/giay dung de theo doi vung chu",
    )
    p.add_argument("--ffmpeg", default="ffmpeg", help="duong dan ffmpeg")
    p.add_argument("--provider", choices=tuple(PROVIDER_NAMES), default="cpu")
    p.add_argument("--device-id", type=int, default=0)
    p.add_argument("--require-gpu", action="store_true")
    p.add_argument("--forbid-cpu-fallback", action="store_true")
    p.add_argument("--self-test", action="store_true")
    args = p.parse_args()
    try:
        if args.self_test:
            return self_test(
                args.provider, args.device_id, args.require_gpu, args.forbid_cpu_fallback
            )
        if not args.input or not args.output:
            raise ValueError("Thiếu --input hoặc --output")
        return run(args)
    except Exception as e:
        emit({"type": "error", "message": str(e)[:300]})
        return 1


if __name__ == "__main__":
    sys.exit(main())
