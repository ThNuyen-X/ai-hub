# AI Hub Remote Controller (Tailscale PWA)

Hệ thống điều khiển máy tính laptop và AI Hub từ xa qua điện thoại, tối ưu mạng riêng ảo Tailscale.

## Tính Năng Chính
1. **PWA Mobile-First**: Mở trên Safari/Chrome của điện thoại, thêm vào Màn hình chính là có ngay 1 Native App toàn màn hình, không thanh URL, cực mượt.
2. **Điều khiển AI Hub Server**: Bật, Tắt, Khởi động lại máy chủ `ai-hub` (cổng 20130).
3. **Điều khiển Laptop An Toàn**:
   - **Tắt màn hình**: Dùng Win32 API siêu nhẹ (< 10ms), tắt đen màn hình laptop để tiết kiệm điện, máy vẫn hoạt động và nhận lệnh 100%. Chạm chuột trên laptop là sáng lại.
   - **Khóa máy**: Khóa màn hình làm việc tức thì.
   - **Tắt máy & Khởi động lại**: Cơ chế an toàn 2 lớp, đếm ngược 30 giây kèm nút **HỦY KHẨN CẤP** trên điện thoại nếu bấm nhầm.
4. **AI Prompt Runner**:
   - Chọn Thư mục (Workspace) & Mô hình (Gemini Flash, Claude Sonnet, Codex, Claude Code).
   - Nhập prompt trên điện thoại và gửi lên laptop.
   - Stream trực tiếp kết quả chạy (SSE) về terminal trên điện thoại.

## Cách Sử Dụng Trên Điện Thoại
1. Kết nối điện thoại vào cùng mạng **Tailscale**.
2. Mở trình duyệt trên điện thoại (Safari trên iOS hoặc Chrome trên Android) và truy cập:
   `http://100.94.115.99:20139`
3. Bấm nút **Chia sẻ / Cài đặt** -> Chọn **"Thêm vào Màn hình chính" (Add to Home Screen)**.
4. Mở app từ màn hình chính để sử dụng.

## Khởi Động & Cài Đặt Tự Chạy
- **Chạy thử nghiệm (hiện console)**: Chạy `start-remote.bat`.
- **Chạy ngầm (không hiện cửa sổ)**: Chạy `launch-remote.vbs`.
- **Tự khởi động cùng Windows**: Mở PowerShell chạy `.\install-startup.ps1`.
- **Hủy tự khởi động**: Mở PowerShell chạy `.\uninstall-startup.ps1`.
