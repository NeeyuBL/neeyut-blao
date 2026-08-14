# Font phụ đề của T-blao

T-blao v0.1.18 dùng một font pack mặc định có giấy phép rõ ràng và được đóng trực tiếp
vào installer. Ứng dụng không tải font khi chạy.

## Font mặc định

Font pack hiện gồm bốn họ Noto dưới giấy phép SIL Open Font License 1.1:

- Noto Sans: Latin, tiếng Việt, Greek và Cyrillic.
- Noto Sans Arabic: chữ Ả Rập.
- Noto Sans Thai: chữ Thái.
- Noto Sans KR: một bộ CJK có đủ chữ Hán, kana Nhật và Hangul Hàn.

Nguồn, commit cố định, checksum và ký tự đại diện cần có được khai báo trong
`manifest.json`. Bản quyền nằm trong `licenses/NOTICES.md`, toàn văn giấy phép nằm
trong `licenses/OFL-1.1.txt`.

## Chuẩn bị và kiểm tra

```text
npm run fonts:prepare
npm run fonts:verify
```

`fonts:prepare` chỉ tải từ URL GitHub raw đã ghim commit và chỉ nhận file có SHA-256
khớp manifest. Nếu mạng lỗi hoặc checksum sai, lệnh thất bại và không thay file đang
dùng bằng dữ liệu chưa xác minh.

Các lệnh `package:win` và `package:mac` tự chạy hai bước trên, rồi kiểm tra lại font
trong thư mục app sau khi `electron-builder` hoàn tất. Vì vậy CI không thể phát hành
installer chỉ có catalog nhưng thiếu font binary.

## Font cá nhân

Font người dùng nhập được lưu ngoài thư mục cài đặt:

- Windows/macOS/Linux: thư mục `fonts/custom` bên trong `app.getPath('userData')`.

Font cá nhân không được commit, không được đóng vào installer và không mất khi ứng
dụng tự cập nhật.

Không đưa các font Windows, UTM, SVN, UVF, UVN, VNF hoặc iCiel cũ vào repo/public
installer nếu chưa xác minh quyền phân phối.
