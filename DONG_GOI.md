# Nhật ký đóng gói T-blao

File này ghi **những gì đã chỉnh trên app** để khi chốt release biết đóng gói **App** hay **Engine** (hoặc cả hai).

Khi sửa thêm: **chỉ cần append** mục mới ở cuối phần «Chưa đóng gói», ghi rõ `[App]` / `[Engine]` / `[Cả hai]`.

---

## Phân loại nhanh

| Loại | Thuộc gì | Đóng gói thế nào |
|------|----------|------------------|
| **[App]** | Electron UI, main/preload, burn, download UI, IPC, `resources/fonts`, `electron-builder` | Bump `package.json` version → build Win/Mac → GitHub Release tag `vX.Y.Z` (+ `latest.yml` / `latest-mac.yml`) |
| **[Engine]** | `engines/ocr-engine`, `engines/douyin-engine`, whisper/CUDA zip, binary trong `assets-v1` | Build zip engine → upload tag **`assets-v1`** → tăng số trong `engines-manifest.json` (chỉ engine đổi) |
| **[Cả hai]** | Đổi API giữa app ↔ engine, hoặc app phụ thuộc engine mới | Làm Engine trước (manifest), rồi App version mới gọi được |

**Không nhầm:**

- Tag **`assets-v1`**: engine / ffmpeg / font assets cố định, **không** dùng cho auto-update app.
- Tag **`v0.1.x`**: bản cài app + electron-updater.
- Sửa chỉ UI/burn/font trong `src/` hoặc `resources/fonts/` → hầu hết là **[App]**, không cần rebuild OCR/Douyin.

---

## Checklist trước khi ship

### App (`vX.Y.Z`)

- [ ] Bump version trong `package.json`
- [ ] Cập nhật `RELEASE_NOTES.md` (gọn, user-facing)
- [ ] `npm run fonts:copy` nếu đổi danh sách font
- [ ] `npm run typecheck`
- [ ] `npm run package:win` (+ Mac CI / `package:mac` nếu cần)
- [ ] `gh release create/upload` setup + `latest.yml` (và Mac nếu có)
- [ ] **Không** `git add` `dist/`, `.env`, secrets

### Engine (`assets-v1`)

- [ ] Rebuild đúng zip (vd. `ocr-engine-win.zip`)
- [ ] Upload lên release `assets-v1`
- [ ] Sửa `engines-manifest.json` — **chỉ** key engine vừa đổi (tránh ép user tải lại engine không đổi)
- [ ] App đã có logic đọc manifest (không cần ship app nếu chỉ engine hotfix — trừ khi app cũ không hỗ trợ)

---

## Đã ship (mốc gần nhất)

### v0.1.10 — App (+ OCR engine trước đó)

| Hạng mục | Loại | Ghi chú đóng gói |
|----------|------|------------------|
| Dịch phụ đề ChatGPT cạnh Gemini | App | Trong installer `v0.1.10` |
| Douyin «Mỗi video một thư mục riêng» | App | |
| Engine auto-update (`engines-manifest`) | App | Logic trong app; manifest trên `assets-v1` |
| OCR log/diagnostics rõ hơn | App | |
| Rebuild `ocr-engine-win.zip` (UPX off), manifest `ocr: 2` | Engine | `assets-v1` |

---

## Chưa đóng gói (sau v0.1.10 — cần release tiếp theo)

> Đích gợi ý: **Engine** `video2x` trên `assets-v1` trước (hoặc cùng đợt) → rồi **App v0.1.11** (font/burn + tab Nâng cấp video).

| # | Hạng mục | Loại | Chi tiết kỹ thuật ngắn |
|---|----------|------|-------------------------|
| 1 | Font phụ đề đóng gói (UTM/UVF/UVN/VNF/SVN/iCiel + Latin) | **App** | `resources/fonts/` + `catalog.json`, `scripts/copy-fonts.mjs`, `extraResources` trong `electron-builder.yml` |
| 2 | Chọn font khi burn + preview live trên khung tím | **App** | `BurnReq.fontId`, `fonts:list`, CSP/`tblao` font+CORS, `RegionBox` |
| 3 | Bỏ chế độ phụ đề mềm — luôn gắn cứng | **App** | `ScreenText` `mode: 'burn'` |
| 4 | Bỏ tip 💡 + nhãn `rbox-nhan-sub` trên khung phụ đề | **App** | UI only |
| 5 | Style phụ đề: màu chữ, màu viền, độ dày viền (bước 0.5px) | **App** | `BurnReq` + ASS Style + preview |
| 6 | Nền sau chữ (bật/tắt + màu + opacity), ôm sát chữ khi xuống dòng | **App** | ASS `BorderStyle=3` + layer chữ; `\blur` mép mềm; preview `border-radius` |
| 7 | (Liên quan phiên trước, nếu chưa ship) Archive skip / retry download | **App** | Chỉ nếu vẫn còn diff chưa vào `v0.1.10` — kiểm tra git trước khi ghi vào notes |
| 8 | Tab **Nâng cấp video** (Video2X) — UI/IPC | **App** | `src/main/video2x.ts`, IPC/preload, `VideoEnhance`, tab `enhance`, CSS; hàng đợi + cột chỉnh task chung (persist); Stats/Pause/Abort; banner macOS không hỗ trợ; CLI flag `--no-copy-streams` (6.4) |
| 9 | Video2X trong tab Giấy phép + THIRD-PARTY | **App** | AGPL-3.0, K4YT3X — `License.tsx`, `THIRD-PARTY-NOTICES.txt` |
| 10 | Engine **`video2x-win.zip`** + manifest | **Engine** | Zip layout `video2x/video2x.exe` (+ DLL, `models/`); upload tag **`assets-v1`**; bump `"video2x": 1` trong `engines-manifest.json` (chỉ key này). Dev đã test bằng copy CLI vào `%APPDATA%/t-blao/bin/video2x/` |

### Việc đóng gói khi chốt đợt này

1. **Engine trước (bắt buộc cho tab Nâng cấp):** đóng `video2x-win.zip` → upload `assets-v1` → bump `"video2x"` trong `engines-manifest.json`. Không cần rebuild OCR/Douyin/Whisper.
2. **App v0.1.11:** mục font/burn (1–6) + Video2X UI/license (8–9) — bump → notes → build Win (+ Mac) → GitHub `v0.1.11`.
3. Nhớ bundle `resources/fonts` (~15 MB) qua `extraResources` (đã cấu hình).
4. Nút «Tải Video2X» chỉ hoạt động sau khi mục **10** đã lên `assets-v1`.

---

## Mẫu ghi mục mới (copy rồi điền)

```markdown
| N | Tên ngắn thay đổi | App / Engine / Cả hai | File / khu vực chính | Cần làm khi ship |
|---|-------------------|------------------------|----------------------|------------------|
|   |                   |                        |                      |                  |
```

**Ví dụ:**

| N | Tên ngắn thay đổi | App / Engine / Cả hai | File / khu vực chính | Cần làm khi ship |
|---|-------------------|------------------------|----------------------|------------------|
| 8 | Sửa crash OCR tiếng Thái | Engine | `engines/ocr-engine` | Rebuild zip + bump `ocr` trong manifest `assets-v1` |
| 9 | Thêm nút Huỷ trên tab Douyin | App | `src/renderer/...` | Bump app `v0.1.x` |

---

## Ghi chú vận hành

- Repo: `NeeyuBL/neeyut-blao`
- App update: `electron-updater` ← release `v*`
- Engine update: app đọc `engines-manifest.json` trên `assets-v1`
- Font nguồn lớn `font/` **không** ship; chỉ subset `resources/fonts/` khi **đóng gói App** (`npm run fonts:copy` + `extraResources`).
- **GitHub public:** không commit binary `.ttf`/`.otf` (UTM/SVN/Windows stock…) — chỉ `catalog.json` + `resources/fonts/README.md`. Xem Phase 4 / README trong thư mục fonts.
- Video2X engine: zip **`video2x-win.zip`** trên `assets-v1` (không commit zip vào git); app tìm `bin/video2x/video2x.exe`
