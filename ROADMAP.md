# 🗺️ ROADMAP — T-blao

> **Nguyên tắc vàng:** Hoàn thiện **GIAI ĐOẠN 0 (tính năng)** cho thật tốt & ổn định TRƯỚC.
> ❌ Chưa đụng tới licensing/thanh toán cho tới khi GĐ0 xong. Tránh lan man.

Cập nhật lần cuối: 2026-07-13 · Repo: https://github.com/NeeyuBL/T-blao

---

## ✅ ĐÃ XONG (nền tảng)

- [x] Tải video (mp4) / audio (mp3, m4a…), chọn độ phân giải
- [x] Nhúng ảnh bìa + metadata, chọn thư mục lưu, progress bar realtime
- [x] Tự tải yt-dlp + ffmpeg về userData (cắm là chạy, không cần Python)
- [x] Xem trước thông tin (tiêu đề/thumbnail/format)
- [x] Hàng đợi tải nhiều video
- [x] Hỗ trợ Playlist (bảng chọn video)
- [x] Chọn định dạng nâng cao (nút ⚙ mỗi video)
- [x] Cảnh báo khi chọn độ phân giải vượt mức video hỗ trợ
- [x] Đăng nhập cookie bằng cửa sổ Electron (bỏ phụ thuộc Python)
- [x] Layout sidebar + tab (dễ thêm tính năng)
- [x] Icon app (từ logo chữ T)
- [x] Đóng gói .exe + phát hành GitHub Release v0.1.0

---

## 🎯 GIAI ĐOẠN 0 — HOÀN THIỆN TÍNH NĂNG (ĐANG LÀM — ưu tiên số 1)

### Tính năng tải (P1 còn lại)
- [ ] **Phụ đề** — tải + nhúng vào video, chọn ngôn ngữ, phụ đề tự động (`--write-subs --embed-subs --sub-langs --write-auto-subs`)
- [ ] **Bỏ qua file đã tải** — download archive (`--download-archive`)
- [ ] **Mẫu tên file tùy chỉnh** — đặt quy tắc đặt tên (`-o` template)
- [ ] **Đổi định dạng đầu ra** — mp4/mkv (`--remux-video` / `--recode-video`)
- [ ] **Tiếp tục tải dở / ghi đè** (`-c` / `-w`)

### Trải nghiệm & độ hoàn thiện (quan trọng để "share được")
- [ ] **Dịch lỗi thường gặp sang tiếng Việt thân thiện** (vd "Unsupported URL" → gợi ý dán link video)
- [ ] **Nhớ tùy chọn người dùng** (thư mục cuối, định dạng ưa dùng) — lưu ở userData
- [ ] **Cơ chế tự cập nhật app** (`electron-updater` đọc GitHub Release)
- [ ] **Suy giảm nhẹ nhàng** khi engine lỗi → báo rõ, không sập app

### Tab Douyin (engine riêng)
- [ ] Freeze `dy-downloader` (D:\Repo_Vscode\douyin-downloader-main) thành `.exe` bằng PyInstaller (tắt browser_fallback)
- [ ] T-blao tự tải `dy-downloader.exe` về userData + cơ chế cập nhật (Douyin hay gãy → cần vá nhanh)
- [ ] Tab "Douyin" trong sidebar: ô link + tùy chọn (mode post/mix, số lượng), gọi CLI subprocess
- [ ] Cookie Douyin: xuất từ cửa sổ đăng nhập Electron sang config cho dy-downloader
- [ ] ⚠️ Giữ ghi công MIT (© jiji262); KHÔNG ship config.yml dev (chứa token thật)

### P2 (làm nếu còn thời gian, không bắt buộc trước licensing)
- [ ] SponsorBlock (bỏ quảng cáo YouTube)
- [ ] Cắt theo thời gian (`--download-sections`)
- [ ] Giới hạn tốc độ (`-r`), tải song song (`-N`)
- [ ] Live stream (`--live-from-start`)

### Đóng gói & phát hành (khi GĐ0 gần xong)
- [ ] Build lại `.exe` với icon mới (`npm run package:win` — nhớ chạy quyền admin do winCodeSign)
- [ ] Push toàn bộ commit local + phát hành Release mới (vd v0.2.0)

---

## 🔒 GIAI ĐOẠN 1-3 — LICENSING (CHƯA LÀM — chỉ sau khi GĐ0 xong)

> Chi tiết xem "Bản định hướng bảo mật & license" đã lập.
> Quyết định sơ bộ: nghiêng về **mô hình theo tài khoản** (Telegram bot) — nhẹ, hợp cộng đồng VN.

### GĐ1 — Khung license (chưa khóa cứng)
- [ ] Chọn hướng: **Telegram bot** (tạo ID + thanh toán) vs Google login vs key
- [ ] Backend nhỏ + database (serverless Cloudflare/Vercel + Supabase/Firebase)
- [ ] App gọi backend kiểm license (online), token ký số (bất đối xứng)
- [ ] Thanh toán VN: chuyển khoản + xác nhận → nâng lên PayOS/SePay (webhook tự kích hoạt)

### GĐ2 — Khóa thiết bị
- [ ] Fingerprint / device session, giới hạn số máy, nút "đăng xuất/chuyển thiết bị"
- [ ] Grace period offline, chấp nhận sai lệch fingerprint (tránh khóa nhầm khách thật)

### GĐ3 — Củng cố & pháp lý
- [ ] Trial, xử lý hết hạn / thu hồi
- [ ] **Privacy Policy + Terms** (bắt buộc khi thu thập ID/thu phí)
- [ ] (Tùy) Code signing `.exe` để tránh cảnh báo SmartScreen
- [ ] Trang bán / hướng dẫn mua

---

## 📌 QUYẾT ĐỊNH ĐANG CHỜ (ghi lại để khỏi quên)
- Mô hình license: **tài khoản (Telegram bot)** hay phần cứng+key? → nghiêng Telegram bot
- Thanh toán: bắt đầu thủ công → PayOS/SePay
- Douyin engine: freeze .exe + mô hình tải/tự-cập-nhật (không nhúng cứng vì Douyin hay đổi)
- Kiểu cài đặt NSIS: giữ màn hình chọn (all users / only me) hay chuyển 1-click?

## ⚙️ LƯU Ý KỸ THUẬT (khỏi vấp lại)
- Chạy dev/build phải **xóa biến `ELECTRON_RUN_AS_NODE`** trước (`Remove-Item Env:\ELECTRON_RUN_AS_NODE`)
- `npm run package:win` phải chạy **quyền admin** (winCodeSign chứa symlink macOS)
- KHÔNG commit secret (cookie/token) — `.gitignore` đã chặn sẵn
