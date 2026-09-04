## T-blao v0.1.20

### Đọc chữ video chính xác hơn

- T-blao phát hiện vùng chữ trước trên các frame đã lấy mẫu, rồi mới nhận dạng tại frame đầu, rõ nhất và cuối của mỗi đoạn.
- Tăng tần suất theo dõi lên 6 frame/giây, hạn chế bỏ sót chữ ở đầu video hoặc subtitle xuất hiện ngắn.
- Nhận diện tốt hơn subtitle có hiệu ứng hiện từng từ, đổi màu karaoke, fade hoặc chuyển cảnh; giảm cue lặp và chữ rác.
- Khi không khoanh vùng, T-blao quét toàn bộ khung hình thay vì chỉ phần đáy video.

### Tăng tốc và độ tin cậy OCR

- Windows ưu tiên DirectML để dùng GPU NVIDIA, AMD hoặc Intel; người dùng vẫn có thể chọn CPU khi cần.
- Engine tự kiểm tra detection, xoay chữ và recognition trước khi sử dụng; kết quả bị từ chối nếu engine chạy sai provider đã chọn.
- Bổ sung trạng thái GPU/CPU rõ ràng trong tab Đọc chữ video và nút kiểm tra lại khi thành phần tăng tốc chưa sẵn sàng.
- Gói OCR Windows tách DirectML và CPU, kiểm tra SHA-256 khi tải, đồng thời giữ lại engine cũ nếu quá trình cập nhật thất bại.

### Phát hành

- Windows sẽ tự nhận, tải và cài v0.1.20 khi kết nối được với GitHub.
- macOS Apple Silicon sẽ thông báo bản mới và mở trang tải DMG để cài thủ công. Bản macOS chưa ký/notarize, nên có thể cần cấp quyền trong **Privacy & Security** khi mở lần đầu.
