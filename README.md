# LuaAI Studio

Website dark-mode responsive cho Android, triển khai frontend trên GitHub Pages và backend AI trên Cloudflare Workers. Firebase Authentication (Google), Firestore chat history theo UID, Firebase Storage upload wallpaper, URL ảnh và lịch sử ảnh.

## Cấu trúc

- `index.html`, `style.css`, `app.js`: frontend tĩnh.
- `worker/worker.js`: API proxy và xác minh Firebase ID token; API key AI chỉ nằm trong Cloudflare Worker secret.
- `worker/wrangler.toml`: cấu hình Worker.
- `firestore.rules`, `storage.rules`: quy tắc dữ liệu riêng theo người dùng.

## 1. Chuẩn bị Firebase trên điện thoại

1. Mở `https://console.firebase.google.com/` trong Chrome, bật chế độ Trang web cho máy tính nếu cần.
2. Chọn project đã có hoặc tạo project mới.
3. Authentication → Sign-in method → bật **Google**.
4. Authentication → Settings → Authorized domains: thêm `YOUR_GITHUB_USERNAME.github.io` (chỉ hostname, không có `https://`).
5. Project settings → General → Your apps → Add app → Web (`</>`). Đăng ký app rồi sao chép `firebaseConfig`.
6. Trong `app.js`, thay 6 giá trị `YOUR_...` bằng giá trị config của app web. `storageBucket` phải đúng chính xác như Firebase hiển thị.
7. Firestore Database → Create database nếu chưa có. Mở Rules, dán nội dung `firestore.rules`, bấm Publish.
8. Storage → Get started nếu chưa bật. Mở Rules, dán `storage.rules`, bấm Publish.
9. Kiểm tra Billing/Storage availability theo yêu cầu của dự án Firebase. Không chuyển Rules thành public để “sửa lỗi”.

## 2. Tạo backend AI bằng Cloudflare Worker

Worker dùng API kiểu OpenAI Chat Completions. Có thể dùng nhà cung cấp tương thích khác bằng cách đổi `AI_BASE_URL`, `AI_MODEL` và secret `AI_API_KEY`.

### Cách làm trên điện thoại (Dashboard, không cần máy tính)

1. Mở `https://dash.cloudflare.com/` → Workers & Pages → Create → Create Worker → Deploy.
2. Mở worker vừa tạo → Edit code. Thay nội dung bằng `worker/worker.js` trong ZIP → Deploy.
3. Vào Settings → Variables and Secrets. Thêm **secret** `AI_API_KEY` với API key nhà cung cấp AI. Không đặt key trong `app.js`, GitHub, HTML hay tin nhắn công khai.
4. Thêm variables:
   - `FIREBASE_PROJECT_ID`: Project ID trong Firebase Project settings.
   - `AI_BASE_URL`: `https://api.openai.com/v1/chat/completions` (hoặc endpoint chat completions tương thích của nhà cung cấp).
   - `AI_MODEL`: model có quyền sử dụng với API key của bạn.
   - `ALLOWED_ORIGIN`: URL gốc GitHub Pages, ví dụ `https://username.github.io` hoặc `https://username.github.io/repository-name`? **Lưu ý:** Origin không có đường dẫn repository, vì vậy dùng `https://username.github.io`.
5. Deploy Worker. URL sẽ có dạng `https://ten-worker.ten-tai-khoan.workers.dev`.
6. Mở `https://TEN-WORKER.workers.dev/api/health`; nếu thấy `{"ok":true,...}` là Worker hoạt động.

### Nếu dùng Wrangler

Từ môi trường có Node.js:
- Đặt `AI_BASE_URL`, `AI_MODEL`, `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGIN` theo `wrangler.toml`.
- Chạy `npx wrangler secret put AI_API_KEY`, nhập key tại prompt.
- Chạy `npx wrangler deploy`.

## 3. Đưa frontend lên GitHub Pages

1. Tạo repository GitHub, ví dụ `luaai-studio`.
2. Upload `index.html`, `style.css`, `app.js` ở thư mục gốc. Có thể upload từ trình duyệt GitHub → Add file → Upload files.
3. Trong `app.js`, đổi `WORKER_URL` thành URL Worker thật, không thêm dấu `/` cuối.
4. Repository → Settings → Pages → Build and deployment → Deploy from a branch → `main` / `/ (root)` → Save.
5. Chờ GitHub Pages phát hành. URL thường là `https://USERNAME.github.io/REPOSITORY/`.
6. Firebase Authentication → Authorized domains thêm `USERNAME.github.io`.
7. Cloudflare `ALLOWED_ORIGIN` đặt `https://USERNAME.github.io` (chỉ origin, không có `/REPOSITORY/`).
8. Mở trang bằng HTTPS, thử Google login, chat AI, rồi upload ảnh.

## 4. Kiểm tra nhanh

- Đăng nhập Google thành công.
- Chat một câu: Worker `/api/chat` trả về câu trả lời.
- Reload trang / mở lịch sử bên trái: chat được lưu theo UID.
- Tab Wallpaper: chọn PNG/JPG/WEBP dưới 8 MB; URL thật được tạo từ Firebase Storage và lưu trong `users/{uid}/wallpapers`.
- Dùng một tài khoản khác để xác nhận không đọc được lịch sử của tài khoản đầu tiên.

## Lưu ý bảo mật / vận hành

- `firebaseConfig` là cấu hình web công khai, nhưng Firebase Security Rules là bắt buộc.
- `AI_API_KEY` phải là Cloudflare Secret, tuyệt đối không đưa vào GitHub.
- Worker xác minh chữ ký Firebase ID token và project ID trước khi gọi AI. Đặt giới hạn chi tiêu/rate limit ở nhà cung cấp AI hoặc Cloudflare để tránh lạm dụng.
- Firebase Storage download URL là URL có token truy cập dài hạn. Chỉ chia sẻ URL ảnh nếu bạn muốn người có link xem ảnh; để bảo mật chặt hơn, có thể xây endpoint cấp URL tạm thời.
- Mẫu này không lưu API key người dùng; mọi yêu cầu AI dùng API key server-side của chủ website.
- Thư viện script hiện là các mẫu tĩnh. Chỉ chạy code bạn hiểu và tin cậy.
- Nếu gặp `auth/unauthorized-domain`, thêm hostname GitHub Pages trong Authorized domains. Nếu `Missing or insufficient permissions`, kiểm tra Rules và đăng nhập. Nếu CORS, kiểm tra `ALLOWED_ORIGIN` đúng origin.
