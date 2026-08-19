# fb-manager

CLI quản lý fanpage, bài viết, comment và quảng cáo Facebook qua Graph API + Marketing API.
Dùng System User token của Business Manager (không hết hạn), gọi API bằng `fetch` — không phụ thuộc SDK của Meta.

## Cài đặt

```powershell
npm install
Copy-Item .env.example .env   # rồi điền giá trị vào .env
```

## Bước đầu

```powershell
npm run fb -- token:check     # token còn sống? có đủ quyền?
npm run fb -- pages:list      # lấy FB_PAGE_ID
npm run fb -- ads:accounts    # lấy FB_AD_ACCOUNT_ID
```

Điền hai ID vừa lấy vào `.env`, sau đó các lệnh còn lại chạy được.

## Các lệnh

```powershell
npm run fb -- --help
```

Ví dụ thường dùng:

```powershell
# Fanpage
npm run fb -- pages:info
npm run fb -- pages:insights --since 2026-07-01 --until 2026-08-01

# Bài viết
npm run fb -- posts:list --limit 10
npm run fb -- posts:create --message "Xin chào"
npm run fb -- posts:create --message "Ảnh mới" --photo .\anh.jpg
npm run fb -- posts:create --message "Khuyến mãi" --schedule 2026-08-20T09:00:00
npm run fb -- posts:insights 123456_789012

# Comment
npm run fb -- comments:list 123456_789012
npm run fb -- comments:reply 987654 --message "Cảm ơn bạn"
npm run fb -- comments:hide 987654

# Quảng cáo — xem và điều khiển
npm run fb -- ads:campaigns
npm run fb -- ads:insights --level campaign --since 2026-08-01
npm run fb -- ads:toggle 23851234567890 --status PAUSED

# Lên camp trọn gói (campaign + ad set + creative + ad)
npm run fb -- ads:launch --name "Tin nhắn T8" --goal messages --daily-budget 200000 `
  --message "Inbox để nhận báo giá" --image .\anh.jpg

npm run fb -- ads:launch --name "Sale T8" --goal sales --daily-budget 500000 `
  --link https://shop.example.com --pixel 1234567890 --event PURCHASE --message "Giảm 30%"

npm run fb -- ads:launch --name "Đẩy bài" --goal engagement --daily-budget 100000 `
  --post-id 123456_789012

# Báo cáo tổng hợp ra CSV
npm run fb -- report --since 2026-07-01 --until 2026-08-01
```

## Lên camp

Mục tiêu (`--goal`) quyết định toàn bộ phần còn lại — objective, cách tối ưu và trường bắt buộc:

| `--goal` | Dùng khi | Bắt buộc thêm |
| --- | --- | --- |
| `messages` | Kéo tin nhắn về Messenger | — |
| `sales` | Chuyển đổi trên website | `--link`, `--pixel` (tuỳ chọn `--event`, mặc định `PURCHASE`) |
| `leads` | Thu lead bằng form trên Facebook | `--lead-form` (form tạo sẵn trên Page) |
| `traffic` | Kéo click về website | `--link` |
| `engagement` | Đẩy tương tác một bài viết | `--post-id` |

Nội dung quảng cáo lấy từ **một trong hai** nguồn: `--post-id` để dùng lại bài đã đăng, hoặc dựng mới
bằng `--message` / `--headline` / `--link` cộng ảnh (`--image` file trên máy, hoặc `--picture` URL công khai).

Nhắm chọn đối tượng mặc định là Việt Nam, 18–65 tuổi, mọi giới tính. Đổi bằng `--countries`,
`--age-min`, `--age-max`, `--genders`.

**Camp luôn được tạo ở trạng thái `PAUSED`.** Kiểm tra lại trên Ads Manager rồi mới bật bằng
`ads:toggle <campaign-id> --status ACTIVE`, hoặc thêm `--activate` nếu muốn chạy ngay.

Bốn lệnh `ads:campaign:create`, `ads:adset:create`, `ads:creative:create`, `ads:ad:create` là các
mảnh rời của `ads:launch` — dùng khi cần thêm ad thứ hai vào ad set có sẵn để test creative.

## Dashboard web

Giao diện xem toàn bộ tài khoản quảng cáo: chi tiêu, công nợ, thẻ đang gắn, trạng thái, thuộc BM nào.

```powershell
npm run sync    # kéo dữ liệu từ Facebook về SQLite (data/fb.db) — vài phút với hơn 10k tài khoản
npm run web     # mở http://127.0.0.1:3000
```

Hai tiến trình tách rời có chủ đích: `web` **không gọi Facebook**, chỉ đọc SQLite. Nhờ vậy trang tải
tức thì, không bao giờ chạm giới hạn API, và tiến trình phục vụ web không cần giữ token.

Chạy `sync` định kỳ (Task Scheduler trên Windows) để dữ liệu luôn mới.

### Những gì Facebook không cho lấy

Đã dò và xác nhận trên v19, v21, v23 — các thứ sau **không có** trong Marketing API:

| Muốn hiển thị | Tình trạng |
| --- | --- |
| Đã chi tiêu, công nợ, thẻ, trạng thái, trả trước/trả sau | Lấy được |
| Số hóa đơn thành công / thất bại | Không có |
| Số tiền Facebook hoàn trả | Không có |
| Ngày đến hạn thanh toán tiếp theo | Trường không tồn tại |
| Mức ngưỡng thanh toán | Không truy cập được |

Muốn có mấy con số đó thì phần mềm phải tự ghi sổ (tiền công ty nạp, lần thanh toán đã đối soát),
hoặc tự suy ra từ công nợ. Ngưỡng cảnh báo hiện là ô nhập tay trên giao diện.

Dò lại bất cứ lúc nào bằng `npm run fb:probe -- <act_id | business_id>`.

### Đăng nhập và phân quyền

```powershell
# Tạo tài khoản quản trị đầu tiên (chỉ làm một lần)
npm run manage -- user:add admin@congty.vn "mat khau that dai" "Phú Trần" admin

# Tạo khách và gán tài khoản quảng cáo cho họ
npm run manage -- customer:add "Công ty ABC" 50000000
npm run manage -- customer:assign 1 act_1697594428130036 act_4194660570770328
npm run manage -- customer:list
```

Khách tự đăng ký ở `/register`, tài khoản ở trạng thái chờ. Quản trị viên vào `/admin` để duyệt và
chọn khách tương ứng. Duyệt xong họ **chỉ thấy tài khoản quảng cáo đã gán cho khách đó**.

Ba vai trò: `admin` (toàn quyền, xem được `/admin`), `staff` (nhân viên nội bộ, xem mọi tài khoản),
`client` (nhân viên của khách, chỉ xem phần được gán).

Việc tạo người dùng và gán tài khoản cố ý **chỉ làm từ dòng lệnh**, không đưa lên web — chúng chỉ chạy
lúc khởi tạo, và để ngoài web thì bớt được một mặt tấn công.

## Triển khai lên VPS Windows

### 1. Chuẩn bị

Cài [Node.js 22 trở lên](https://nodejs.org) trên VPS. Chép mã nguồn vào `C:\fbdashboard`, rồi:

```powershell
cd C:\fbdashboard
npm install
Copy-Item .env.example .env    # điền FB_ACCESS_TOKEN
npm run manage -- user:add admin@congty.vn "mat khau that dai" "Tên bạn" admin
npm run sync
```

### 2. Chạy web như dịch vụ Windows

Dùng [NSSM](https://nssm.cc) để tiến trình tự chạy lại khi VPS khởi động lại:

```powershell
nssm install FbDashboard "C:\Program Files\nodejs\node.exe" `
  "C:\fbdashboard\node_modules\tsx\dist\cli.mjs" "C:\fbdashboard\src\server.ts"
nssm set FbDashboard AppDirectory C:\fbdashboard
nssm set FbDashboard AppEnvironmentExtra TRUST_PROXY=1 SECURE_COOKIE=1
nssm start FbDashboard
```

Hai biến môi trường đó **bắt buộc** khi chạy sau proxy: `TRUST_PROXY=1` để nhật ký ghi đúng IP người
dùng thay vì `127.0.0.1`, `SECURE_COOKIE=1` để cookie phiên chỉ đi qua HTTPS.

### 3. HTTPS bằng Caddy

Tải [Caddy cho Windows](https://caddyserver.com/download), tạo file `Caddyfile`:

```
dashboard.tenmiencua.ban {
    reverse_proxy 127.0.0.1:3000
}
```

Trỏ bản ghi A của tên miền về IP VPS, rồi cài Caddy thành dịch vụ:

```powershell
nssm install Caddy "C:\caddy\caddy.exe" run --config C:\caddy\Caddyfile
nssm start Caddy
```

Caddy tự xin chứng chỉ Let's Encrypt và tự gia hạn — không phải làm gì thêm.

### 4. Tường lửa

```powershell
New-NetFirewallRule -DisplayName "HTTP"  -Direction Inbound -LocalPort 80  -Protocol TCP -Action Allow
New-NetFirewallRule -DisplayName "HTTPS" -Direction Inbound -LocalPort 443 -Protocol TCP -Action Allow
```

Cổng 3000 **không cần mở** — máy chủ web chỉ nghe ở `127.0.0.1`, chỉ Caddy trên cùng máy gọi tới được.

### 5. Đồng bộ định kỳ

Task Scheduler, chạy mỗi 3 tiếng:

```
Program:   C:\Program Files\nodejs\node.exe
Arguments: C:\fbdashboard\node_modules\tsx\dist\cli.mjs C:\fbdashboard\src\sync.ts
Start in:  C:\fbdashboard
```

### 6. Siết RDP — quan trọng nhất

Với VPS Windows, **RDP là đường bị tấn công nhiều nhất**, hơn hẳn ứng dụng web. Bot quét cổng 3389
suốt ngày và dò mật khẩu Administrator. Mọi lớp bảo vệ trong phần mềm này đều vô nghĩa nếu kẻ tấn công
đăng nhập thẳng vào máy.

Tối thiểu phải làm:

- Đổi cổng RDP khỏi 3389, hoặc chỉ cho phép RDP từ IP văn phòng của bạn
- Mật khẩu Administrator dài, không dùng lại ở đâu khác
- Đổi tên tài khoản `Administrator` thành tên khác
- Bật khoá tài khoản sau vài lần đăng nhập sai
- Bật Windows Update tự động

### Còn thiếu

Bản hiện tại chưa có: form tạo camp cho khách kèm kiểm tra hạn mức, đồng bộ camp, và phát hiện camp lạ.

## Những điểm cần biết

- **Ngân sách đặt ở đâu**: để ở `ads:campaign:create` là bật CBO (Facebook tự chia cho các ad set);
  khi đó ad set **không được** có ngân sách riêng. `ads:launch` đặt ngân sách ở ad set.
- **`--lifetime-budget` bắt buộc đi kèm `--end`.**
- **Camp mới bị từ chối hoặc không tiêu tiền** thường do tài khoản chưa có phương thức thanh toán,
  hoặc ngân sách ngày thấp hơn mức tối thiểu Meta quy định cho loại tối ưu đang chọn.
- **Hẹn giờ bài viết**: Facebook yêu cầu thời điểm cách hiện tại từ 10 phút đến 6 tháng.
- **Đơn vị ngân sách**: `daily_budget` / `lifetime_budget` / `spend` trả về theo đơn vị nhỏ nhất của tiền tệ tài khoản. Với VND thì đã là số nguyên đồng; với USD thì là cent.
- **Metric của insights thay đổi theo phiên bản API.** Nếu gặp lỗi code 100, dùng `--metrics` để chỉ định danh sách khác.
- **Rate limit**: wrapper tự đọc header `x-business-use-case-usage`, nghỉ khi dùng quá 90% hạn mức và tự thử lại các lỗi tạm thời tối đa 4 lần.
- **Phiên bản API** được pin trong `FB_API_VERSION`. Meta khai tử mỗi phiên bản sau khoảng 2 năm — theo dõi [changelog](https://developers.facebook.com/docs/graph-api/changelog) và nâng định kỳ.
- **App Review**: token chỉ thao tác được trên page và ad account mà System User có quyền trong Business Manager. Muốn phục vụ tài sản của bên thứ ba thì app phải qua App Review để có Advanced Access.
