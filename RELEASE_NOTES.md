## T-blao v0.1.18

### Biên tập video trực quan

- Thêm tab **Biên tập video** để xem trước video, phụ đề, vùng làm mờ và âm thanh trước khi xuất.
- Ánh xạ phụ đề SRT theo đúng thời gian phát và đúng tỷ lệ video ngang, vuông hoặc dọc, kể cả khi xem toàn màn hình.
- Thêm bộ điều khiển phát/tạm dừng, tua và âm lượng ngay dưới bản xem trước để không bị vùng chỉnh sửa che thao tác.
- Cho phép nghe thử file WAV lồng tiếng cùng video, điều chỉnh riêng âm lượng gốc và âm lượng lồng tiếng; thiết lập xem trước được dùng khi xuất.

### Phụ đề và hiệu ứng chữ

- Thêm ba phong cách: hiện cả câu, hiện lần lượt từng từ và làm nổi bật từ đang đọc.
- Hiệu ứng highlight dùng dòng nền cố định và lớp pop riêng, giữ bố cục ổn định, không làm chữ co giãn hoặc nhảy dòng liên tục.
- Cải thiện tự ngắt dòng theo kích thước glyph và tỷ lệ video; cue dài được giới hạn hợp lý, tránh tràn khung hoặc xuống dòng dư.
- Tối ưu đánh giá phụ đề theo nhịp lời nói thực tế; cảnh báo tập trung vào đoạn có nguy cơ ảnh hưởng trải nghiệm xem.

### Font đa ngôn ngữ

- Đóng gói và kiểm checksum bốn font Noto cho tiếng Việt/Latin, Ả Rập, Thái và CJK (Trung–Nhật–Hàn).
- Preview và video xuất dùng cùng font; hỗ trợ nhập font cá nhân và lưu ngoài thư mục cài đặt để không mất khi cập nhật.
- Quy trình đóng gói sẽ thất bại nếu thiếu font, sai checksum hoặc có binary font ngoài manifest.

### Hỗ trợ và giao diện

- Nâng cấp tab **Hỗ trợ** với bảng chẩn đoán và bản sao thông tin đã làm sạch, đủ dữ kiện để phân tích lỗi mà không kèm cookie hay bí mật.
- Làm mới tab **Hệ sinh thái Neeyu** theo dạng thư viện sản phẩm có thể mở rộng; NeeyuVoice hiển thị hỗ trợ Windows và macOS.
- Tách rõ luồng tạo phụ đề và biên tập, đồng thời giữ handoff video/SRT an toàn giữa các tab.

### Độ ổn định phát hành

- Windows tiếp tục phát hành bộ cài x64 có metadata tự cập nhật.
- macOS phát hành cho **Apple Silicon (M1 trở lên)**, gồm DMG và ZIP ARM64; không phát hành bản Intel.
- FFmpeg macOS chuyển sang binary ARM64 cố định có `libass`, AV1 và H.264, được kiểm SHA-256 trước khi cài.
- Bổ sung cổng kiểm version/tag, font, subtitle engine, kiến trúc ARM64, chữ ký, notarization và metadata updater trước khi tạo release.

### Lưu ý

- Bản macOS yêu cầu macOS 11 trở lên và máy Apple Silicon.
- Cookie, phiên đăng nhập, font cá nhân, file video/SRT/WAV và báo cáo cục bộ không nằm trong bộ cài hoặc GitHub release.
