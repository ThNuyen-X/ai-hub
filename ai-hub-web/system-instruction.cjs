const fs = require("node:fs");
const path = require("node:path");

const LESSONS_FILE = path.resolve(__dirname, "..", "lessons.md");
const _textFileCache = new Map();

function readCachedTextFile(filePath, maxChars = 2500) {
  try {
    if (!filePath || !fs.existsSync(filePath)) return "";
    const stat = fs.statSync(filePath);
    const cached = _textFileCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.maxChars === maxChars) {
      return cached.content;
    }
    const raw = fs.readFileSync(filePath, "utf8").trim();
    const content = raw.length > maxChars ? raw.slice(0, maxChars) + "\n..." : raw;
    _textFileCache.set(filePath, { mtimeMs: stat.mtimeMs, maxChars, content });
    return content;
  } catch {
    return "";
  }
}

function buildSystemInstruction(cwd) {
  const baseRules =
    "QUY TẮC BẮT BUỘC:\n" +
    "- Trước khi gọi lệnh shell quan trọng (build, deploy, sửa file lớn, tác động hệ thống), BẮT BUỘC viết 1 câu siêu ngắn (dưới 15 từ) thông báo mục đích cho người dùng trước khi gọi tool.\n" +
    "- Với các thao tác đọc nhẹ (ls, cat, grep nhỏ), hãy gọi thẳng lệnh và gộp thao tác để tối ưu tốc độ phản hồi.\n" +
    "- QUY CHUẨN MƯỢT MÀ, ỔN ĐỊNH & TỐI ƯU TÀI NGUYÊN:\n" +
    "  + Đọc & Sửa File: Không đọc toàn bộ file lớn (>500 dòng) khi chỉ cần sửa đoạn nhỏ; lưu ý chuẩn dòng CRLF trên Windows.\n" +
    "  + Backend & DB: Tránh gọi execSync/spawn trong luồng API thường xuyên; tránh lỗi N+1 query; đọc SQLite ở chế độ { readOnly: true } và đóng kết nối trong finally; dùng TTL cache cho dữ liệu hệ thống ít biến động.\n" +
    "  + Frontend & Stream: Chống gọi trùng (coalesce/debounce) khi tải dữ liệu; giải phóng sạch EventSource/timer/.streaming-cursor khi đóng hoặc chuyển phiên; đặt thanh tiến trình (.live-progress-container) ở dưới .ai-content-body.\n" +
    "  + Kiểm chứng & Tự học: Luôn chạy kiểm tra cú pháp (node --check hoặc test liên quan) sau khi sửa code. Khi giải quyết xong bug phức tạp mới, ghi tóm tắt 1 dòng bài học vào D:\\ai-hub\\lessons.md.\n" +
    "- QUY TẮC SUBAGENT (DELEGATE):\n" +
    "  + Ưu tiên làm trực tiếp: Tự thực hiện đọc, sửa code, chạy test, commit, deploy ngay trong phiên chính.\n" +
    "  + CẤM tuần tự hóa subagent: Không ủy quyền cho các bước nối tiếp thông thường (đọc diff -> sửa file -> test -> commit -> ghi doc).\n" +
    "  + CẤM tạo subagent cho tác vụ nhỏ, đọc nhanh hoặc lệnh shell đơn lẻ.\n" +
    "  + CHỈ gọi subagent khi thật sự cần thiết: Dò quét phạm vi rộng (hàng trăm file) có nguy cơ tràn context, hoặc chạy song song các nhánh nghiên cứu độc lập.";

  const parts = [baseRules];
  if (cwd) {
    const wsHints = readCachedTextFile(path.join(cwd, ".goosehints"), 1500);
    if (wsHints) {
      parts.push("[WORKSPACE HINTS (.goosehints)]:\n" + wsHints);
    }
  }
  const lessons = readCachedTextFile(LESSONS_FILE, 2200);
  if (lessons) {
    parts.push("[BÀI HỌC THỰC CHIẾN CHUNG (D:\\ai-hub\\lessons.md)]:\n" + lessons);
  }
  return parts.join("\n\n");
}

module.exports = {
  LESSONS_FILE,
  readCachedTextFile,
  buildSystemInstruction
};
