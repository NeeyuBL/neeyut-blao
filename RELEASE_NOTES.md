## T-blao v0.1.23

Bản cập nhật dành cho người dùng v0.1.19 và các bản v0.1.20–v0.1.22 đã được thu hồi, bao gồm toàn bộ cải tiến đọc chữ video và sửa lỗi cài công cụ.

### Sửa lỗi cài công cụ đọc chữ video

- Sửa lỗi Windows tải xong tài nguyên nhưng không giải nén được do tên file tạm không có đuôi cuối `.zip`.
- Xử lý đường dẫn có tiếng Việt/ký tự đặc biệt và gộp yêu cầu cài trùng để tránh ghi đè file đang tải.
- Tự chuẩn bị công cụ khi chưa có bộ xử lý sẵn sàng; tự chuyển sang CPU nếu tăng tốc DirectML không sử dụng được.
- Giữ kiểm tra SHA-256 và khôi phục công cụ cũ nếu cài bản mới thất bại.
- Thông báo và nhật ký phân biệt bước tải, xác minh, giải nén và tự kiểm tra; không còn mặc định quy mọi lỗi cài đặt cho kết nối mạng.
- Bổ sung kiểm thử luồng cài thực tế trên Windows với tài nguyên tải công khai từ GitHub, bao gồm cài mới CPU và chuyển sang CPU khi tăng tốc lỗi.

### Đọc chữ video chính xác hơn

- T-blao phát hiện vùng chữ trước trên các frame đã lấy mẫu, rồi mới nhận dạng tại frame đầu, rõ nhất và cuối của mỗi đoạn.
- Tăng tần suất theo dõi lên 6 frame/giây, hạn chế bỏ sót chữ ở đầu video hoặc subtitle xuất hiện ngắn.
- Nhận diện tốt hơn subtitle có hiệu ứng hiện từng từ, đổi màu karaoke, fade hoặc chuyển cảnh; giảm cue lặp và chữ rác.
- Khi không khoanh vùng, T-blao quét toàn bộ khung hình thay vì chỉ phần đáy video.

### Tăng tốc và độ tin cậy OCR

- Windows ưu tiên DirectML để dùng GPU NVIDIA, AMD hoặc Intel; tự dùng CPU ổn định nếu tăng tốc chưa sẵn sàng.
- Engine tự kiểm tra detection, xoay chữ và recognition trước khi sử dụng; kết quả bị từ chối nếu engine chạy sai provider đã chọn.
- Bổ sung trạng thái GPU/CPU rõ ràng trong tab Đọc chữ video và nút kiểm tra lại khi thành phần tăng tốc chưa sẵn sàng.
- Gói OCR Windows tách DirectML và CPU, kiểm tra SHA-256 khi tải, đồng thời giữ lại engine cũ nếu quá trình cập nhật thất bại.

### Phát hành

- Windows tự nhận và tải v0.1.23 khi kết nối được với GitHub, cài khi người dùng khởi động lại hoặc thoát ứng dụng.
- macOS Apple Silicon sẽ thông báo bản mới và mở trang tải DMG để cài thủ công. Bản macOS chưa ký/notarize, nên có thể cần cấp quyền trong **Privacy & Security** khi mở lần đầu.
