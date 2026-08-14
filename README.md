# T-blao

Trình tải video & audio đa nền tảng — chạy trên **Windows x64** và **macOS Apple Silicon (M1 trở lên)**.

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
- Bản macOS yêu cầu macOS 11 trở lên; T-blao không phát hành binary Intel.

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

## Cổng phát hành

Trước khi tạo tag, chạy `npm run release:verify`, `npm run typecheck`,
`npm run test:subtitles` và gói Windows. Workflow tag chỉ tạo draft release khi cả
Windows x64 và macOS ARM64 vượt qua kiểm tra artifact.

Windows dùng `latest.yml` để tự tải/cài bản mới. macOS chỉ kiểm tra phiên bản từ
GitHub Release và mở DMG cho người dùng cài thủ công; release không được chứa
`latest-mac.yml` hoặc ZIP updater. Bản macOS hiện chưa ký/notarize nên có thể cần
được cho phép thủ công trong **Privacy & Security** khi mở lần đầu.

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

## Font phụ đề

Bộ font mở được tải ở bước build từ nguồn và commit đã ghim, sau đó kiểm tra SHA-256 trước khi đóng gói. Chạy `npm run fonts:prepare && npm run fonts:verify` và xem [resources/fonts/README.md](resources/fonts/README.md).

## Giấy phép

T-blao phát hành theo **PolyForm Noncommercial License 1.0.0** (source-available, **phi thương mại** + bắt buộc ghi công).

- Toàn văn: [LICENSE](LICENSE)
- Ghi công / NOTICE: [NOTICE](NOTICE)
- Dùng cá nhân, học tập, nghiên cứu, tổ chức phi thương mại: được phép theo license.
- **Dùng thương mại** (bán, SaaS, tích hợp sản phẩm thương mại…): cần thỏa thuận riêng với **NeeyuBL**.

Đây **không** phải giấy phép OSI “Open Source” (vì cấm thương mại).

### Ghi công (bên thứ ba)

T-blao dùng các công cụ/thư viện bên thứ ba (tải khi cần hoặc đóng gói riêng), mỗi thành phần giữ giấy phép gốc — xem [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) và tab **Giấy phép** trong app. Ví dụ:

- **ffmpeg** — LGPL/GPL: <https://ffmpeg.org/legal.html>
- **Video2X** — AGPL-3.0: <https://github.com/k4yt3x/video2x>
- Bộ tải xuống mã nguồn mở (Unlicense / phạm vi công cộng).

> Người dùng chịu trách nhiệm tuân thủ điều khoản của các nền tảng và luật bản quyền khi tải nội dung.
