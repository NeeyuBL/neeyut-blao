# 🚀 Release v0.1.8 - T-blao Video Editor

Phiên bản **v0.1.8** tập trung nâng cấp trải nghiệm người dùng trực quan, bổ sung các tùy chọn điều chỉnh âm thanh linh hoạt, hỗ trợ khoanh vùng OCR dễ dàng và sửa lỗi hiệu năng trên hệ điều hành macOS.

## 🌟 Tính năng & Trải nghiệm mới

### 🎵 1. Cấu hình âm thanh linh hoạt & mượt mà
- **Thêm khu vực cấu hình âm thanh**: Bổ sung mục cấu hình chuyên biệt đồng bộ hoàn toàn với các mục "Làm mờ" và "Thêm phụ đề".
- **Hỗ trợ chọn nhạc nền**: Cho phép bạn dễ dàng tải lên các định dạng âm thanh thông dụng (`.mp3`, `.wav`, `.aac`, `.m4a`, `.ogg`, `.flac`).
- **Thanh trượt điều chỉnh âm lượng gốc**: Hỗ trợ tăng/giảm âm lượng của video gốc từ `0%` (tắt tiếng hoàn toàn) đến `100%` (âm lượng gốc). Âm lượng thay đổi tự nhiên và mượt mà theo cảm nhận thực tế của tai người khi trượt.
- **Hoạt động độc lập**: Bạn có thể bật cấu hình chỉ để chỉnh nhỏ âm lượng video gốc mà không bắt buộc phải tải lên tệp nhạc nền mới.

### 🔍 2. Khung khoanh vùng OCR trực quan
- **Khung nét đứt màu vàng tiện lợi**: Xuất hiện trực tiếp trên khung xem trước (Preview) giúp bạn dễ dàng dùng chuột di chuyển và co giãn để chọn chính xác vùng cần quét chữ OCR.
- **Ngăn ngừa lỗi thao tác**: Nút **Bắt đầu** sẽ tự động vô hiệu hóa nếu bạn bật tính năng OCR nhưng chưa kéo chọn vùng quét trên màn hình.

### 💾 3. Xuất đồng thời 4 định dạng phụ đề & văn bản
- Hệ thống tự động lưu kết quả dịch ra cùng lúc **4 định dạng file** phổ biến chỉ sau một lần xử lý:
  - `.srt` (Phụ đề tiêu chuẩn)
  - `.vtt` (Phụ đề Web)
  - `.txt` (Văn bản dịch thuần túy)
  - `.json` (Dữ liệu cấu trúc chi tiết kèm mốc thời gian)

### ⚡ 4. Tự động hóa thiết lập ban đầu (Setup)
- Khi mở ứng dụng lần đầu tiên, hệ thống sẽ tự động kích hoạt tiến trình tải và cài đặt các công cụ hỗ trợ cần thiết mà không yêu cầu bạn phải nhấn nút thủ công.

---

## 🛠️ Sửa lỗi & Cải tiến hiệu năng

- **Khắc phục lỗi treo trên macOS**: Sửa triệt để sự cố ứng dụng bị treo đứng ở 100% khi tải và giải nén các công cụ hỗ trợ ban đầu trên thiết bị macOS.
- **Tối ưu hóa xử lý video**: Giúp quá trình ghép phụ đề và xử lý âm thanh hoạt động trơn tru, ổn định trên cả hệ điều hành Windows và macOS.
