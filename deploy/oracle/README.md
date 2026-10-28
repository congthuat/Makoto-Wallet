# Chạy backend Makoto trên Oracle Cloud Always Free ($0)

Hướng dẫn này chuyển backend từ Railway sang một máy ảo **Oracle Cloud Always Free** (vùng **Tokyo**), chạy 24/7 tại `https://api.makotowallet.xyz`, HTTPS tự động, backup tự động hằng ngày.

- Thời gian: khoảng **45–60 phút** cho lần đầu.
- Bạn cần: thẻ Visa/Mastercard (chỉ để Oracle xác minh), tài khoản Vercel và Railway.
- Railway vẫn chạy song song cho đến bước cuối, nên web **không bị gián đoạn**.

> 💡 Chỗ nào có khung `lệnh` thì bấm nút copy rồi dán vào cửa sổ dòng lệnh. Dòng bắt đầu bằng `#` chỉ là ghi chú.

---

## ⚡ Cách nhanh: 1 lệnh trong Oracle Cloud Shell (khuyên dùng)

Sau khi đăng ký Oracle (bước 1 bên dưới), bạn **không cần bấm tạo máy ảo bằng tay**:

1. Đăng nhập <https://cloud.oracle.com>, bấm biểu tượng **>_** (**Cloud Shell**) trên thanh trên cùng và chờ cửa sổ đen mở ra.
2. Dán lệnh này rồi bấm Enter:

   ```bash
   bash <(curl -fsSL https://raw.githubusercontent.com/congthuat/Makoto-Wallet/makoto-wallet/deploy/oracle/provision-cloudshell.sh)
   ```

3. Script tự làm, và chỉ dừng lại khi cần bạn:
   - Tạo mạng và mở cổng 22, 80, 443.
   - Tạo máy ảo ARM miễn phí. Nếu Oracle báo **hết chỗ**, script tự thử lại mỗi phút, xen kẽ 2 OCPU/12 GB và 1 OCPU/6 GB.
   - Tự cài backend (5–10 phút).
   - **Hỏi từng khóa bí mật.** Mở Railway → **Variables** → **Raw Editor**, copy từng giá trị rồi dán vào khi được hỏi. Khi dán sẽ không thấy chữ hiện ra, đó là bình thường.
   - **In ra IP máy ảo và hướng dẫn thêm DNS trong Vercel** (bước 5 bên dưới), rồi tự chờ DNS và HTTPS.
   - Hỏi có chuyển dữ liệu từ Railway không. Trả lời `y`, rồi mở đường link Railway in ra và bấm **Approve**.
4. Nếu Cloud Shell bị ngắt giữa chừng, **chỉ cần dán lại đúng lệnh trên**. Script tự nhận ra phần đã làm và chạy tiếp.
5. Nếu cứ báo **hết chỗ ARM** mãi: bấm `Ctrl+C`, rồi dùng máy **AMD Micro** (cũng miễn phí vĩnh viễn, 1 GB RAM + 2 GB swap tự tạo, dễ có chỗ hơn nhiều):

   ```bash
   SHAPE=micro bash <(curl -fsSL https://raw.githubusercontent.com/congthuat/Makoto-Wallet/makoto-wallet/deploy/oracle/provision-cloudshell.sh)
   ```

Phần dưới đây là **cách làm tay**, dùng khi cần tự kiểm soát từng bước hoặc khi gỡ lỗi.

---

## Bước 1: Đăng ký Oracle Cloud

1. Mở <https://signup.cloud.oracle.com> → điền email, quốc gia **Vietnam**.
2. **Home Region**: chọn **Japan East (Tokyo)**. ⚠️ Không đổi được sau này.
3. Nhập thẻ để xác minh. Oracle có thể tạm giữ khoảng $1 rồi hoàn lại. Gói **Always Free** không bị trừ tiền.
4. Chờ email "Your account is ready" (thường 5–30 phút), rồi đăng nhập <https://cloud.oracle.com>.

### (Khuyên làm) Nâng lên Pay As You Go: vẫn $0

Tài khoản miễn phí thuần có thể bị Oracle **thu hồi máy ảo khi máy rảnh lâu**, và hay báo **hết chỗ** khi tạo máy ARM. Nâng lên *Pay As You Go* giúp tránh cả hai. Bạn **vẫn $0** nếu chỉ dùng tài nguyên Always Free như hướng dẫn này.

1. Menu ☰ → **Billing & Cost Management** → **Upgrade and Manage Payment** → **Upgrade to Pay As You Go**.
2. Đặt cảnh báo cho yên tâm: **Billing** → **Budgets** → **Create Budget**, số tiền `1` USD, gửi email cảnh báo khi vượt 100%.

---

## Bước 2: Tạo khóa SSH trong Cloud Shell

Cloud Shell là cửa sổ dòng lệnh chạy ngay trên trình duyệt, không cần cài gì lên máy tính.

1. Trên thanh trên cùng của Oracle Cloud, bấm biểu tượng **>_** (**Cloud Shell**) và chờ cửa sổ đen mở ở dưới.
2. Dán lệnh sau rồi bấm Enter:

   ```bash
   [ -f ~/.ssh/id_rsa ] || ssh-keygen -q -t rsa -b 4096 -N '' -f ~/.ssh/id_rsa; cat ~/.ssh/id_rsa.pub
   ```

3. Lệnh sẽ in ra một dòng bắt đầu bằng `ssh-rsa ...`. **Copy cả dòng đó**, dùng ở bước 3. (Cloud Shell chạy chế độ FIPS nên không dùng khóa ED25519.)

---

## Bước 3: Tạo máy ảo

1. Menu ☰ → **Compute** → **Instances** → **Create instance**.
2. **Name**: `makoto-backend`.
3. **Image and shape** → **Edit**:
   - **Image** → **Change image** → **Canonical Ubuntu** → **24.04** (bản thường, không phải Minimal) → **Select image**.
   - **Shape** → **Change shape** → **Ampere** → **VM.Standard.A1.Flex** → **OCPU = 2**, **Memory = 12 GB** → **Select shape**. Thẻ "Always Free-eligible" phải hiện.
4. **Networking**: để mặc định (**Create new virtual cloud network** + **public subnet**), bật **Assign a public IPv4 address**.
5. **Add SSH keys** → chọn **Paste public keys** → dán dòng `ssh-rsa ...` từ bước 2.
6. **Boot volume**: để mặc định.
7. Bấm **Create** và chờ trạng thái **RUNNING** màu xanh (1–3 phút).
8. Ghi lại **Public IP address** (ví dụ `140.238.x.x`).

> ❗ Nếu báo **"Out of capacity for shape VM.Standard.A1.Flex"**: thử lại sau vài phút, hoặc giảm còn **1 OCPU / 6 GB** (vẫn đủ chạy Makoto). Nâng Pay As You Go như bước 1 thường giải quyết được.

---

## Bước 4: Mở cổng 80 và 443 cho máy ảo

1. Trong trang máy ảo vừa tạo → mục **Primary VNIC** → bấm vào tên **Subnet**.
2. Tab **Security** (hoặc mục **Security Lists**) → bấm **Default Security List for ...** → **Add Ingress Rules**.
3. Thêm **2 luật**, mỗi luật:
   - **Source CIDR**: `0.0.0.0/0`
   - **IP Protocol**: `TCP`
   - **Destination Port Range**: `80` (luật thứ hai: `443`)
4. Bấm **Add Ingress Rules**.

Cổng 22 (SSH) đã mở sẵn. Không mở cổng 3001, vì backend chỉ nghe nội bộ.

---

## Bước 5: Trỏ `api.makotowallet.xyz` về máy ảo (làm trong **Vercel**)

Tên miền mua ở Spaceship, nhưng **DNS đang do Vercel quản lý** (nameserver `ns1/ns2.vercel-dns.com`). Vì vậy bản ghi phải thêm **trong Vercel**, không phải Spaceship.

1. Vào <https://vercel.com> → chọn team → tab **Domains** (hoặc **Settings → Domains**) → bấm **makotowallet.xyz**.
2. Phần **DNS Records** → **Add**:
   - **Name**: `api`
   - **Type**: `A`
   - **Value**: Public IP của máy ảo (bước 3)
   - **TTL**: để mặc định
3. Bấm **Add / Save**.
4. Kiểm tra trong Cloud Shell. Sau 1–5 phút, lệnh này phải in ra đúng IP máy ảo:

   ```bash
   getent hosts api.makotowallet.xyz
   ```

---

## Bước 6: Vào máy ảo và chạy cài đặt

1. Trong **Cloud Shell**, nối vào máy ảo (thay `IP_MAY_AO` bằng IP ở bước 3). Lần đầu nó hỏi `yes/no` thì gõ `yes`.

   ```bash
   ssh ubuntu@IP_MAY_AO
   ```

2. Chạy cài đặt. Script tự cài Node 24, Caddy (HTTPS), tường lửa, dịch vụ chạy 24/7 và backup hằng ngày. Mất khoảng 3–5 phút.

   ```bash
   curl -fsSL https://raw.githubusercontent.com/congthuat/Makoto-Wallet/makoto-wallet/deploy/oracle/setup.sh | sudo bash
   ```

   Kết thúc sẽ có dòng vàng `Not starting yet: ... CHANGE_ME`. **Như vậy là đúng**, vì bạn chưa điền các khóa ở bước 7.

---

## Bước 7: Điền cấu hình (các khóa bí mật)

1. Lấy giá trị từ Railway: **makoto-backend** → **Variables** → bấm **Raw Editor** (góc phải). Railway hiện toàn bộ biến dạng `TEN=giatri`. Giữ cửa sổ này để copy từng giá trị.
2. Trên máy ảo, chạy lệnh hỏi từng khóa (dán giá trị rồi Enter; khi dán sẽ không thấy chữ hiện ra):

   ```bash
   sudo makoto-configure
   ```

   Lệnh tự lưu, khởi động backend và báo `Backend is healthy ✔`. Đến đây có thể bỏ qua mục 3–5 bên dưới, sang thẳng mục 6.
   Muốn tự sửa file thì dùng `sudo nano /etc/makoto/backend.env`.

3. (Nếu tự sửa file) Thay **từng chữ `CHANGE_ME`** bằng giá trị lấy từ Railway:

   | Dòng trong file | Lấy từ Railway |
   | --- | --- |
   | `TASK_SESSION_SECRET=` | `TASK_SESSION_SECRET` (**phải giống hệt** để người dùng không phải xác minh ví lại) |
   | `SURF_API_KEY=` | `SURF_API_KEY` |
   | `COINGECKO_API_KEY=` | `COINGECKO_API_KEY` |
   | `LLM_API_KEY=` | khóa OpenAI (**nên dùng khóa mới** rồi thu hồi khóa cũ) |

   **Giữ nguyên** các dòng khác trong file (`BACKEND_PORT=3001`, `TASK_TRUST_PROXY_HOPS=2`, các đường dẫn `/var/lib/makoto/...`), **đừng** chép đè bằng giá trị của Railway. Nếu Railway có `COINGECKO_API_MODE` hoặc `LLM_MODEL` khác mặc định thì sửa theo Railway.

4. Lưu bằng **Ctrl + O** → **Enter**, thoát bằng **Ctrl + X**.
5. Khởi động và kiểm tra:

   ```bash
   sudo systemctl restart makoto-backend && sudo makoto-update --check
   ```

   Thấy `Health: OK` là được ✅.

6. Kiểm tra từ Internet. Lần đầu Caddy cần khoảng 30 giây để lấy chứng chỉ HTTPS:

   ```bash
   curl https://api.makotowallet.xyz/api/health
   ```

   Kết quả phải là `{"status":"ok"}`.

---

## Bước 8: Chuyển dữ liệu từ Railway sang

Bước này chép Tasks, lịch sử số dư và phiên xác minh ví. Railway **không bị thay đổi gì**: chỉ đọc và tạo bản sao nhất quán.

1. Trên máy ảo (**không** dùng `sudo`):

   ```bash
   makoto-railway-export
   ```

   Lệnh sẽ:
   - Cài Railway CLI nếu chưa có.
   - In một **đường link và mã**: mở link trên trình duyệt đã đăng nhập Railway, kiểm tra mã khớp rồi bấm **Approve**.
   - Hỏi chọn **project** → **production** → **makoto-backend**. Dùng phím mũi tên và Enter.
   - Có thể hỏi đăng ký SSH key với Railway: chọn **Yes**.
   - Cuối cùng in ra `ok task-auth`, `ok tasks`, `ok portfolio-history` và một dòng `Next: sudo makoto-import-data /home/ubuntu/railway-export-...`

2. **Copy nguyên dòng `sudo makoto-import-data ...`** vừa in ra và chạy. Script sẽ:
   - Kiểm tra từng file.
   - Backup dữ liệu hiện có.
   - Thay dữ liệu, khởi động lại và báo `Import complete; backend is healthy.` ✅

3. **Báo cho Makoto Agent / người hỗ trợ** để đổi trang thật sang Oracle (sửa `vercel.json`). Railway vẫn chạy cho đến lúc đó.

> Dữ liệu ghi vào Railway sau thời điểm xuất (ví dụ ai đó vừa tạo Task) sẽ không có trên Oracle. Nên làm bước 8 ngay trước khi đổi `vercel.json`.

---

## Vận hành hằng ngày

| Việc | Lệnh (trên máy ảo) |
| --- | --- |
| Xem trạng thái và sức khỏe | `sudo makoto-update --check` |
| Xem log trực tiếp (Ctrl+C để thoát) | `sudo journalctl -u makoto-backend -f` |
| Cập nhật code mới từ GitHub | `sudo makoto-update` (tự backup trước, kiểm tra sau) |
| Backup ngay | `sudo makoto-backup` |
| Xem danh sách backup | `sudo makoto-backup --list` |
| Khôi phục một bản backup | `sudo ALLOW_PARTIAL=1 makoto-import-data /var/backups/makoto/<THOI_GIAN>` |
| Đổi khóa bí mật | `sudo makoto-configure` |
| Sửa cấu hình thủ công | `sudo nano /etc/makoto/backend.env` rồi `sudo systemctl restart makoto-backend` |
| Khởi động lại máy ảo | `sudo reboot` (backend và HTTPS tự chạy lại) |

- Backup tự chạy **3:17 sáng (UTC)** mỗi ngày, giữ **14 bản** gần nhất trong `/var/backups/makoto`.
- **Theo dõi miễn phí:** tạo tài khoản <https://uptimerobot.com> → **Add New Monitor** → **HTTP(s)**, URL `https://api.makotowallet.xyz/api/health`, 5 phút/lần. Máy chủ ngừng là bạn nhận email.
- **Muốn backup ra ngoài máy ảo** (phòng mất máy): trong Cloud Shell, chạy `scp -r ubuntu@IP_MAY_AO:/var/backups/makoto ./makoto-backups` sau khi `sudo chmod -R a+rX /var/backups/makoto`. Bạn cũng có thể tải về máy bằng menu ⚙ của Cloud Shell → **Download**.

---

## Sự cố thường gặp

| Hiện tượng | Cách xử lý |
| --- | --- |
| `Out of capacity` khi tạo máy | Thử lại sau, hoặc 1 OCPU / 6 GB, hoặc nâng Pay As You Go (bước 1). |
| `curl https://api.makotowallet.xyz/...` không phản hồi | Kiểm tra lần lượt: (1) bước 4 đã mở 80/443; (2) `getent hosts api.makotowallet.xyz` ra đúng IP; (3) `sudo journalctl -u caddy -n 50`. |
| Caddy báo lỗi chứng chỉ (certificate) | Thường do DNS chưa trỏ đúng. Đợi vài phút rồi `sudo systemctl restart caddy`. |
| `Health` không OK | `sudo journalctl -u makoto-backend -n 80 --no-pager`. Hay gặp nhất là còn sót `CHANGE_ME` hoặc giá trị dán thiếu ký tự. |
| Người dùng phải xác minh ví lại | `TASK_SESSION_SECRET` khác Railway. Chép lại cho giống, rồi khởi động lại. |
| `makoto-update` báo không healthy | Làm theo lệnh "roll back" mà script in ra để về bản trước. |

## Bảo mật

- Các khóa bí mật chỉ nằm trong `/etc/makoto/backend.env` (quyền `600`, chỉ root đọc được), **không bao giờ** đưa vào GitHub.
- Backend chạy bằng user riêng `makoto`, không có quyền root, chỉ được ghi vào `/var/lib/makoto`.
- Chỉ cổng 22, 80, 443 mở ra Internet. Cổng 3001 bị chặn bởi tường lửa.
- Máy ảo không giữ khóa ví nào. Makoto vẫn không ký giao dịch; người dùng ký trong ví của họ.
