# T-blao

Trình tải video & audio đa nền tảng — chạy trên **Windows** và **macOS**.

Xây bằng **Electron + React + TypeScript** (electron-vite).

## Tính năng (MVP)

- Dán URL → xem tiêu đề, thumbnail, thời lượng
- Tải **Video (mp4)** với chọn độ phân giải, hoặc **Audio** (mp3/m4a/opus/flac/wav)
- Nhúng ảnh bìa + metadata
- Chọn thư mục lưu (mặc định: Downloads)
- **Progress bar** thời gian thực (tốc độ, ETA)
- **Tự kiểm tra & tải** các thành phần cần thiết khi thiếu (màn hình Setup lúc khởi động)

## Yêu cầu môi trường

- **Node.js** ≥ 18 (khuyến nghị 20+)
- Khi build bản **macOS** (`.dmg`) cần chạy trên máy Mac hoặc GitHub Actions.

## Lệnh

```bash
npm install       # cài dependencies
npm run dev       # chạy chế độ phát triển (hot reload)
npm start         # chạy bản build production (preview)
npm run build     # build ra out/
npm run typecheck # kiểm tra kiểu TypeScript
npm run package:win   # đóng gói .exe (NSIS installer) -> dist/
npm run package:mac   # đóng gói .dmg (cần macOS)
```

> ⚠️ **Lưu ý môi trường:** Nếu Electron khởi động mà báo `Cannot read properties of undefined (reading 'whenReady')`,
> nghĩa là biến `ELECTRON_RUN_AS_NODE=1` đang bật (làm Electron chạy như Node thuần).
> Khắc phục: xoá biến đó trước khi chạy — PowerShell: `Remove-Item Env:\ELECTRON_RUN_AS_NODE`.

## Cấu trúc

```
src/
  main/        # tiến trình chính: cửa sổ, IPC, kiểm tra/tải thành phần, gọi công cụ tải
  preload/     # cầu nối an toàn (contextBridge) main <-> renderer
  renderer/    # giao diện React
  shared/      # kiểu dữ liệu dùng chung
```

## Hướng phát triển tiếp

- Phụ đề (tải + nhúng), SponsorBlock, cắt theo thời gian
- Đổi định dạng đầu ra, mẫu tên file, tiếp tục tải dở
- Hỗ trợ Douyin (engine riêng)

## Giấy phép

T-blao phát hành theo giấy phép **MIT** — xem [LICENSE](LICENSE).

### Ghi công (bên thứ ba)

T-blao dùng các công cụ mã nguồn mở, được tải/dựng lúc chạy (không kèm trong repo):

- **ffmpeg** — xử lý & ghép âm thanh/video. Giấy phép **LGPL/GPL**: <https://ffmpeg.org/legal.html>
- Bộ tải xuống mã nguồn mở (giấy phép Unlicense / phạm vi công cộng).

> Người dùng chịu trách nhiệm tuân thủ điều khoản của các nền tảng và luật bản quyền khi tải nội dung.
