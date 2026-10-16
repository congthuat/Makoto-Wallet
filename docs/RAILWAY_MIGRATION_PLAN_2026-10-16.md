# Kế hoạch triển khai Railway — Hotfix Arc RPC
# Phiên bản 2 — 2026-10-16
# Cập nhật: sửa scale-to-zero, backup SQLite, rollback, bỏ ARC_RPC_OVERRIDE

---

## 1. Tình trạng Railway hiện tại

| Thông số | Giá trị |
|---|---|
| Branch đang chạy | `release/makoto-wallet-2026-10-01` |
| Commit đang chạy | `fe09df5014a1d8b96034e8249456b381347ad43e` |
| Deploy date | 2026-10-01 |
| PR chưa triển khai | PR #8 (B6/P1 SQLite auth fix), PR #9 (UI/UX fixes), PR #10 (hotfix RPC) |
| Volume `/data` | `task-auth.sqlite`, `tasks.sqlite` và WAL/SHM files |
| Env vars | `SURF_API_KEY`, `BACKEND_PORT`, `COINGECKO_*`, `LLM_*`, `TASK_*`, `PUBLIC_APP_ORIGIN` |

**Tất cả bước bên dưới đều yêu cầu phê duyệt riêng của chủ dự án trước khi thực hiện.
Arc Studio không tự thực hiện bất kỳ bước nào ảnh hưởng Railway, database hoặc production.**

---

## 2. Version drift — thay đổi còn thiếu

### PR #8 — B6/P1 SQLite authentication fix (RỦI RO CAO)

**Vấn đề gốc:** Code cũ (`fe09df5`) dùng `connect-sqlite3` (SQLite 3.44.2) và
`node:sqlite` (SQLite 3.53.0) cùng mở một WAL file. Trên Linux, hai bản SQLite
biên dịch độc lập không chia sẻ in-process POSIX lock bookkeeping — một bên
không thấy lock của bên kia, dẫn đến write conflict và có thể corrupt WAL.
CI Linux reproduce lỗi 99/100 test runs.

**Fix:** `connect-sqlite3` được thay bằng `SQLiteSessionStore` native dùng cùng
`DatabaseSync` handle với phần còn lại của backend. Một handle duy nhất, SQLite
tự serialize.

**Hệ quả với deploy:** Old code và new code KHÔNG ĐƯỢC chạy đồng thời trên cùng
`task-auth.sqlite`. Xem Mục 5 về cách Railway xử lý điều này.

### PR #9 — UI/UX fixes

Feedback modal localization, Receive share improvements. Không có schema migration.
Không ảnh hưởng SQLite structure.

### PR #10 — Hotfix Arc RPC (CI PASS)

`rpc.testnet.arc.network` → `rpc.testnet.arc.io`. Thêm `RpcError`/`RpcErrorKind`,
retry 1 lần, phân loại lỗi rõ ràng. **Không có schema migration, không thay đổi
SQLite.** Đây là thay đổi duy nhất vá lỗi production ngay lập tức.

---

## 3. Cấu hình RPC — không dùng env var override

`backend/routes/arc.js` hiện hardcode:
```js
const RPC = 'https://rpc.testnet.arc.io'
```

**Không có cơ chế `process.env.ARC_RPC_OVERRIDE`** trong codebase. Kế hoạch cũ
đề xuất env var này là sai — nó chưa được code, chưa được test và không được
triển khai. Phương án duy nhất đúng để thay RPC là deploy commit mới có code đã
được kiểm thử (PR #10).

**Hệ quả rollback:** Nếu phải quay lại `fe09df5`, RPC cũ (`arc.network`) đã
chết vẫn sẽ bị dùng. Không có cách vá nhanh qua env var. Xem Mục 7.

---

## 4. Giới hạn Railway với persistent volume — đã xác minh

**Railway không cho phép scale service về 0 replicas khi có persistent volume đính kèm.**
Đây là giới hạn được document và enforce tự động bởi platform
(nguồn: Railway docs + Railway Central Station Q&A 2026-07-15):

- `railway scale sfo=0` thực thi thành công nhưng Railway silently giữ nguyên
  1 replica — không báo lỗi, không warn.
- Lý do: volume phải được mount để data accessible; 0 replicas đồng nghĩa
  volume không mount được.

**Hệ quả:** Không thể dùng "scale to 0 → deploy mới → scale to 1" như kế hoạch
cũ đề xuất. Thay vào đó phải dùng `railway down` (xem Mục 5).

**Shell access khi deployment bị remove:** Sau `railway down`, không còn container
nào chạy nên không có shell để truy cập `/data`. Mọi backup từ volume phải được
thực hiện **trước khi** remove deployment, dùng Railway CLI file download.

---

## 5. Cơ chế ngăn old/new backend chạy đồng thời

Railway deploy theo cơ chế **replace**: khi trigger deploy mới từ branch/commit,
Railway:
1. Build image mới
2. Start container mới (new code)
3. Sau khi container mới pass health check, drain và stop container cũ
4. Volume được re-mount vào container mới

Trong khoảng **bước 2–3**, có một khoảng thời gian ngắn (~seconds) mà cả old và
new container đều chạy và đều có thể nhận request. Với service 1 replica có
volume, Railway documentation gọi đây là "staged change" nhưng overlap ngắn này
vẫn xảy ra.

**Với PR #8, overlap này là nguy hiểm** vì cả hai version đều mở `task-auth.sqlite`
cùng lúc — đúng scenario B6/P1.

**Quy trình an toàn duy nhất được xác minh:**
```
railway down   →   backup   →   deploy từ branch makoto-wallet   →   verify
```

`railway down` **remove active deployment** (stop container, free compute) nhưng
**giữ nguyên service, env vars và volume**. Sau đó deploy mới sẽ là cold start
trên volume đã tắt — không có overlap.

**Downtime:** Có. Khoảng thời gian từ `railway down` đến khi deployment mới pass
health check (thường 1–3 phút trên Railway với Node.js). Cần thông báo cho người
dùng nếu cần.

---

## 6. Backup SQLite nhất quán — quy trình đúng

### Vấn đề với `cp` khi backend đang chạy

`cp /data/task-auth.sqlite /data/task-auth.sqlite.bak` trong khi backend đang có
writer **không nhất quán**: cp đọc từng page tuần tự, writer có thể đang ghi page
khác cùng lúc — backup có thể chứa mix của trạng thái cũ và mới.

**WAL mode thêm vấn đề:** Trong WAL mode, trạng thái database thực sự là tổng
hợp của `.sqlite` + `.sqlite-wal`. Copy từng file riêng lẻ (không atomic) sẽ
cho backup không khớp nhau.

### Quy trình đúng: checkpoint trước khi download

**Bước A — Chạy trong Railway shell (khi backend vẫn đang chạy):**
```bash
# Dùng Railway shell: railway shell --service makoto-backend
# Hoặc dùng railway run nếu có pre-deploy command access

# 1. Flush và truncate WAL vào main database file (atomic, SQLite serialize)
sqlite3 /data/task-auth.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 /data/tasks.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"

# Lưu ý: TRUNCATE (không phải FULL) vừa checkpoint vừa đưa WAL về 0 bytes.
# Sau lệnh này, .sqlite-wal và .sqlite-shm không còn uncommitted data.
# Nếu checkpoint trả về (0, X, X) — busy writers đang giữ read transaction,
# thử lại sau 10 giây hoặc dùng PRAGMA wal_checkpoint(PASSIVE) và đợi.

# 2. Kiểm tra integrity trước backup
sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"   # phải trả: ok
sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"        # phải trả: ok
```

**Bước B — Download từ ngoài (Railway CLI trên máy local):**
```bash
# Dùng Railway CLI v5+ với file download
railway service files download /data/task-auth.sqlite ./backup/task-auth-$(date +%Y%m%d-%H%M%S).sqlite
railway service files download /data/tasks.sqlite ./backup/tasks-$(date +%Y%m%d-%H%M%S).sqlite

# Kiểm tra backup integrity trên máy local
sqlite3 ./backup/task-auth-*.sqlite "PRAGMA integrity_check;"
sqlite3 ./backup/tasks-*.sqlite "PRAGMA integrity_check;"
# Phải trả: ok
```

**Tại sao download thay vì cp trong container:**
- `railway service files download` dùng snapshot nhất quán của Railway volume
- Không bị ảnh hưởng bởi concurrent write trong container
- Backup được lưu ngoài Railway — an toàn hơn backup nằm trong cùng volume

**Lưu ý:** Sau `railway down`, không còn container chạy, không vào được shell.
Backup bắt buộc phải xong **trước** `railway down`.

---

## 7. Quy trình deploy an toàn (theo thứ tự)

**Tất cả các bước dưới đây yêu cầu phê duyệt riêng của chủ dự án.**

### Bước 0 — Điều kiện tiên quyết (kiểm tra, không downtime)

- [ ] **CHỦ DỰ ÁN PHÊ DUYỆT** việc merge PR #10 vào `makoto-wallet`
- [ ] PR #10 CI pass (đã xác nhận: GitHub Actions backend + frontend pass)
- [ ] Vercel Preview của PR #10 không có regression
- [ ] Xác nhận Railway service name chính xác (ví dụ: `makoto-backend`)
- [ ] Xác nhận Railway environment (production / staging)
- [ ] Cài Railway CLI trên máy local nếu chưa có: `npm i -g @railway/cli`
- [ ] Login Railway CLI: `railway login`
- [ ] Link project: `railway link` (chọn đúng project và environment)
- [ ] Xác nhận Railway service có healthcheck endpoint `/api/health`

### Bước 1 — Merge PR #10 vào `makoto-wallet` (không phải `main`)

**Chỉ thực hiện sau khi được phê duyệt.**

```
GitHub: PR #10 → merge vào branch makoto-wallet
```

Railway autodeploy có thể được trigger từ đây. Nếu autodeploy bật cho branch
`makoto-wallet`, **tắt autodeploy trước** hoặc thực hiện Bước 2 (backup) trước
khi merge.

### Bước 2 — Backup SQLite (trên máy local, dùng Railway CLI)

```bash
# A. Vào Railway shell để flush WAL
railway shell --service makoto-backend
# Trong shell:
sqlite3 /data/task-auth.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 /data/tasks.sqlite "PRAGMA wal_checkpoint(TRUNCATE);"
sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"   # kỳ vọng: ok
sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"        # kỳ vọng: ok
exit

# B. Download backup ra ngoài
mkdir -p ./railway-backup
railway service files download /data/task-auth.sqlite ./railway-backup/task-auth-$(date +%Y%m%d-%H%M%S).sqlite --service makoto-backend
railway service files download /data/tasks.sqlite ./railway-backup/tasks-$(date +%Y%m%d-%H%M%S).sqlite --service makoto-backend

# C. Kiểm tra backup trên máy local
sqlite3 ./railway-backup/task-auth-*.sqlite "PRAGMA integrity_check;"
sqlite3 ./railway-backup/tasks-*.sqlite "PRAGMA integrity_check;"
# Dừng lại nếu kết quả KHÔNG phải "ok"
```

### Bước 3 — Remove active deployment (`railway down`)

```bash
# Remove deployment hiện tại — dừng container, giữ service + volume + env
railway down --service makoto-backend

# Xác nhận: Railway dashboard phải hiện "No active deployment"
# Volume vẫn còn: kiểm tra trong dashboard dưới service volumes
```

**Sau bước này:** Backend offline. Frontend Vercel vẫn chạy nhưng API calls sẽ
fail. Không thể vào shell để truy cập `/data`.

### Bước 4 — Deploy version mới từ `makoto-wallet`

```bash
# Option A: Trigger qua Railway dashboard
# Service → Deploy → chọn branch makoto-wallet → Deploy

# Option B: Trigger qua CLI
railway up --service makoto-backend --detach
# Hoặc nếu đã link với branch makoto-wallet:
railway redeploy --service makoto-backend
```

Đợi deploy hoàn thành — Railway sẽ chạy health check.

### Bước 5 — Verify sau deploy

```bash
# 1. Health check (thay RAILWAY_URL bằng URL thực)
curl https://RAILWAY_BACKEND_URL/api/health
# Kỳ vọng: HTTP 200

# 2. Arc RPC status — phải có blockNumber > 0
curl https://RAILWAY_BACKEND_URL/api/arc/network | python3 -m json.tool
# Kỳ vọng:
# {
#   "chainId": 5042002,
#   "blockNumber": <số dương>,
#   "gasPriceGwei": <số dương>,
#   ...
# }
# LỖI nếu: {"error": "Arc RPC unavailable"} — điều tra log Railway

# 3. Kiểm tra route auth hoạt động (không cần session)
curl https://RAILWAY_BACKEND_URL/api/arc/wallet
# Kỳ vọng: HTTP 400 (thiếu address param) — route đang chạy

# 4. SQLite integrity sau deploy (Railway shell)
railway shell --service makoto-backend
sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"
sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"
# Phải trả: ok
exit
```

### Bước 6 — Verify production UI

- [ ] Mở makotowallet.xyz
- [ ] Sidebar không còn hiện "Đang kết nối Arc…" kéo dài (tối đa 30 giây)
- [ ] Arc Chain Pulse hiển thị block number thực
- [ ] Không có báo lỗi "Arc unreachable" liên tục
- [ ] Send/Swap/Bridge flow vẫn accessible (không cần thực hiện transaction)

---

## 8. Rollback plan — không ghi đè dữ liệu mới

**Nguyên tắc:** Nếu deploy mới có vấn đề, KHÔNG ghi đè database mới bằng backup
cũ. Database có thể đã có sessions và nonces mới được ghi sau khi deploy.
Ghi đè sẽ xóa dữ liệu mới này và gây confusion cho người dùng đang đăng nhập.

**Quy trình rollback:**

```bash
# 1. Remove deployment mới (không xóa data)
railway down --service makoto-backend

# 2. Kiểm tra database integrity TRƯỚC KHI quyết định gì thêm
railway shell --service makoto-backend 2>/dev/null || echo "shell unavailable during down"
# Nếu không vào được shell: dùng file download để kiểm tra offline
railway service files download /data/task-auth.sqlite ./rollback-check/task-auth.sqlite --service makoto-backend
sqlite3 ./rollback-check/task-auth.sqlite "PRAGMA integrity_check;"

# 3a. Nếu integrity OK → rollback code về commit cũ, KHÔNG restore database
# Railway dashboard: Service → Source → chọn commit fe09df5 → Deploy
# Hoặc: git push một revert commit lên branch makoto-wallet

# 3b. Nếu integrity FAIL → đây là sự cố nghiêm trọng, DỪNG LẠI
# Không tự tiếp tục — liên hệ team, đánh giá backup trước khi quyết định
```

**Lưu ý quan trọng về rollback về `fe09df5`:**
- `fe09df5` chứa `rpc.testnet.arc.network` đã chết — backend sẽ lại bị 5xx
  trên `/api/arc/network`
- **Không có env var override** nào fix được điều này — `ARC_RPC_OVERRIDE` không
  tồn tại trong codebase
- Nếu phải rollback, chấp nhận `/api/arc/network` degraded tạm thời và ưu tiên
  re-deploy version mới sớm nhất có thể

---

## 9. Checklist phê duyệt — bắt buộc trước từng giai đoạn

### Giai đoạn A: Chuẩn bị (chỉ đọc, không thay đổi production)
- [ ] Chủ dự án đọc và confirm toàn bộ kế hoạch này
- [ ] Xác nhận Railway service name và environment đúng
- [ ] Railway CLI đã login và link đúng project
- [ ] `railway service files download` hoạt động (test với file nhỏ)

### Giai đoạn B: Merge PR — cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** Merge PR #10 vào `makoto-wallet` (không phải `main`)
- [ ] Tắt Railway autodeploy nếu cần kiểm soát thời điểm deploy

### Giai đoạn C: Backup — cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** Flush WAL và download backup SQLite
- [ ] Backup đã verify `integrity_check = ok` trên máy local

### Giai đoạn D: Deploy — cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** `railway down` để remove deployment cũ (gây downtime)
- [ ] **PHÊ DUYỆT:** Trigger deploy từ branch `makoto-wallet`
- [ ] Health check pass, Arc RPC trả blockNumber > 0
- [ ] `integrity_check = ok` sau deploy

### Giai đoạn E: Rollback (chỉ khi cần)
- [ ] **PHÊ DUYỆT:** Quyết định rollback sau khi đã kiểm tra integrity
- [ ] Không ghi đè database nếu integrity OK

---

## 10. Ghi chú bảo mật

- Sessions trong `task-auth.sqlite` vẫn hợp lệ sau upgrade: `SQLiteSessionStore`
  dùng cùng schema (`sessions` table), không migration cần thiết
- Nonces SIWE chưa consume sẽ expire tự nhiên (5 phút TTL) — không cần xử lý
- `TASK_SESSION_SECRET` không thay đổi — cookies cũ vẫn valid
- Không có user data bị mất nếu quy trình trên được thực hiện đúng

---

## 11. Tóm tắt rủi ro

| Rủi ro | Mức độ | Biện pháp |
|---|---|---|
| Old/new backend overlap mở cùng SQLite | **CAO** | Dùng `railway down` trước deploy — xem Mục 5 |
| Backup không nhất quán (cp khi có writer) | **CAO** | `PRAGMA wal_checkpoint(TRUNCATE)` + Railway file download — xem Mục 6 |
| Scale-to-zero không hoạt động với volume | **ĐÃ XÁC NHẬN** | Dùng `railway down` thay thế — xem Mục 4 |
| ARC_RPC_OVERRIDE không tồn tại trong code | **ĐÃ XÁC NHẬN** | Không dùng env var workaround, deploy code mới — xem Mục 3 |
| Rollback ghi đè dữ liệu mới | **TRUNG BÌNH** | Chỉ rollback code, không restore database nếu integrity ok — xem Mục 8 |
| Downtime trong khoảng `railway down` → health check pass | **THẤP** | Thông báo người dùng trước, ước tính 1–3 phút |
| `fe09df5` rollback trả lại RPC chết | **TRUNG BÌNH** | Chấp nhận degraded tạm thời, re-deploy sớm — xem Mục 8 |
