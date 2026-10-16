# Kế hoạch triển khai Railway — Hotfix Arc RPC
# Phiên bản 3 — 2026-10-16
# Xác minh từ Railway CLI docs, volumes docs, backups docs và source code

---

> **Không tự thực hiện.** Tất cả bước ảnh hưởng Railway production, database
> hoặc volume đều yêu cầu phê duyệt riêng của chủ dự án trước khi thực hiện.

---

## 1. Tình trạng Railway hiện tại

| Thông số | Giá trị |
|---|---|
| Branch đang chạy | `release/makoto-wallet-2026-10-01` |
| Commit đang chạy | `fe09df5014a1d8b96034e8249456b381347ad43e` |
| PR chưa triển khai | PR #8 (SQLite auth fix), PR #9 (UI/UX), PR #10 (Arc RPC hotfix — CI PASS) |
| Volume | `/data` — mount path trong container |
| Branch production | `makoto-wallet` (không phải `main`) |

---

## 2. Phân biệt Railway CLI commands — đã xác minh

| Lệnh | Chạy ở đâu | Mục đích |
|---|---|---|
| `railway ssh` | **Remote** — SSH vào container đang chạy trên Railway | Truy cập filesystem của container production, chạy lệnh trong container |
| `railway shell` | **Local** — mở shell trên máy local | Inject Railway env vars vào shell local để `railway run`, test local |
| `railway volume files download` | **Local** — tải file từ volume về máy | Backup/download file từ volume mà không cần SSH |
| `railway volume files list` | **Local** — liệt kê files trong volume | Kiểm tra nội dung volume |
| `railway volume browse` | **Local** — TUI interactive | Browse, upload, download, edit, rename file trong volume |

**Quy tắc:** Mọi thao tác với SQLite trong container dùng `railway ssh`. Backup
về máy local dùng `railway volume files download`. Không nhầm hai lệnh này.

---

## 3. Database paths — đã xác minh từ source code

Backend có **3 SQLite databases** (không phải 2):

| Database | Env var | Default path (trong container) | Nội dung |
|---|---|---|---|
| Auth | `TASK_AUTH_DB_PATH` | `<app>/data/task-auth.sqlite` | Sessions, nonces, rate limits |
| Tasks | `TASK_DB_PATH` | `<app>/data/tasks.sqlite` | Task definitions, results |
| Portfolio history | `PORTFOLIO_HISTORY_DB_PATH` | `<app>/data/portfolio-history.sqlite` | Snapshots lịch sử portfolio |

**Lưu ý Railway:** Nếu Railway mount volume vào `/data`, các path thực tế trong
container sẽ phụ thuộc vào Railway's mount point và cấu hình `TASK_AUTH_DB_PATH`,
`TASK_DB_PATH`, `PORTFOLIO_HISTORY_DB_PATH` trong Railway env vars. Cần kiểm tra
Railway dashboard để xác định giá trị thực tế trước khi backup.

**Cần xác nhận của chủ dự án:** Giá trị 3 env vars trên trong Railway production
trước Bước backup — không tiết lộ secrets, chỉ cần biết đường dẫn file.

---

## 4. Railway volume và deployment overlap — đã xác minh

### Điều đã xác minh từ Railway docs

- Volume chỉ **attach vào 1 service** tại một thời điểm
- Khi deploy mới, Railway thực hiện **staged replace**: start container mới,
  khi pass health check thì drain và stop container cũ
- **Railway docs không document rõ** khoảng thời gian overlap (nếu có) giữa
  old container và new container với cùng volume trong quá trình replace
- Tìm kiếm trong Railway docs và Station Q&A: **không có bằng chứng** rằng
  cả hai container cùng mount volume đồng thời trong rolling deploy

### Điều chưa xác minh (giả định trước đây là sai)

Kế hoạch v2 khẳng định "staged replace tạo overlap cả hai container mount volume"
nhưng **không có bằng chứng** từ Railway docs cho điều này. Railway volume có
hành vi single-attach — một volume chỉ mount vào một container tại một thời điểm.

### Rủi ro thực sự với PR #8

Rủi ro không phải từ Railway volume overlap (chưa xác minh) mà từ **code cũ
(`fe09df5`) dùng `connect-sqlite3` + `node:sqlite` đồng thời** — đây là
race condition bên trong cùng một process, đã reproduce 99/100 trên Linux CI.
PR #8 fix race condition này bằng cách dùng 1 handle duy nhất.

**Kết luận:** Deploy standard (không cần `railway down`) có thể an toàn nếu
Railway thực sự single-attach volume. Tuy nhiên, vì **không có xác nhận chính
thức** từ Railway về overlap behavior trong replace, kế hoạch vẫn dùng
`railway down` làm lựa chọn an toàn nhất cho lần upgrade đầu tiên bao gồm PR #8.
Chủ dự án có thể quyết định dùng standard deploy nếu muốn giảm downtime.

---

## 5. Backup SQLite nhất quán — thiết kế đúng

### Vì sao `wal_checkpoint(TRUNCATE)` + file copy không đủ

`PRAGMA wal_checkpoint(TRUNCATE)` flush WAL vào main database file và đặt WAL
về 0 bytes — nhưng chỉ thành công hoàn toàn khi **không có reader đang giữ
read transaction**. Nếu có concurrent reader, checkpoint trả về
`(1, pages_checkpointed, pages_moved)` — WAL vẫn còn data chưa merge.
Copy file ngay sau đó là không nhất quán.

### Cơ chế đúng: SQLite Backup API (`.backup`)

SQLite Backup API tạo hot backup nhất quán bất kể WAL state và concurrent readers:

```bash
# Chạy trong container qua railway ssh
# SQLite Backup API — nhất quán, không cần dừng writer
sqlite3 /data/task-auth.sqlite ".backup /data/task-auth.sqlite.bak-$(date +%Y%m%d-%H%M%S)"
sqlite3 /data/tasks.sqlite ".backup /data/tasks.sqlite.bak-$(date +%Y%m%d-%H%M%S)"
sqlite3 /data/portfolio-history.sqlite ".backup /data/portfolio-history.sqlite.bak-$(date +%Y%m%d-%H%M%S)" 2>/dev/null || echo "portfolio-history not found — verify path"

# Kiểm tra integrity của backup file (không phải main database)
BACKUP_TS=$(ls -t /data/task-auth.sqlite.bak-* 2>/dev/null | head -1)
sqlite3 "$BACKUP_TS" "PRAGMA integrity_check;"   # phải trả: ok
```

**Tại sao `.backup` tốt hơn `TRUNCATE` + `cp`:**
- SQLite Backup API đọc database page-by-page với shared lock, tự động retry
  khi có page bị ghi lại trong quá trình đọc — backup luôn nhất quán
- Không cần flush WAL trước
- Không ảnh hưởng performance của main database
- Kết quả là file `.sqlite` đã merge WAL, không cần copy WAL/SHM riêng

### Sau khi backup trong container: tải về máy local

```bash
# Chạy trên máy local (sau khi đã backup trong container)
mkdir -p ./railway-backup
railway volume files download /data/task-auth.sqlite.bak-<TIMESTAMP> ./railway-backup/task-auth-<TIMESTAMP>.sqlite
railway volume files download /data/tasks.sqlite.bak-<TIMESTAMP> ./railway-backup/tasks-<TIMESTAMP>.sqlite
railway volume files download /data/portfolio-history.sqlite.bak-<TIMESTAMP> ./railway-backup/portfolio-history-<TIMESTAMP>.sqlite 2>/dev/null || echo "skip if not exists"

# Xác minh trên máy local
sqlite3 ./railway-backup/task-auth-<TIMESTAMP>.sqlite "PRAGMA integrity_check;"   # ok
sqlite3 ./railway-backup/tasks-<TIMESTAMP>.sqlite "PRAGMA integrity_check;"        # ok
```

**Lưu ý về lệnh:** `railway volume files download` là lệnh đúng (đã xác minh
từ Railway volumes docs). Không phải `railway service files download`.

### Railway volume backup tích hợp — lớp bảo vệ thứ hai

Railway hỗ trợ **volume backup tích hợp** (manual và automated, incremental
copy-on-write snapshot). Đây là lớp bảo vệ độc lập với backup SQLite ở trên:

- **Manual backup:** Railway dashboard → Volume → Backups → Create backup
- **Automated backup:** Có thể cấu hình lịch backup định kỳ
- **Restore:** Chỉ restore từ Railway dashboard — **không tự restore**,
  mọi restore yêu cầu phê duyệt của chủ dự án
- **Caveat Railway:** Volume backup là snapshot filesystem, không biết SQLite
  WAL state — có thể capture trạng thái không nhất quán nếu chụp giữa write.
  Dùng làm lớp bảo vệ thứ hai, không thay thế backup SQLite level ở trên.

**Quy trình backup 2 lớp:**
1. SQLite Backup API (application-consistent, qua `railway ssh` + `.backup`)
2. Railway volume manual snapshot (filesystem-level, qua Railway dashboard)
Cả hai phải done trước khi `railway down`.

---

## 6. Rủi ro khi nâng cấp từ `fe09df5` (01/10) lên `makoto-wallet` mới nhất

### 6.1 Build và Node.js

| Thông số | `fe09df5` (ước tính) | Hiện tại (`makoto-wallet`) | Rủi ro |
|---|---|---|---|
| Node.js | Không có `engines` field — Railway tự chọn | Không có `engines` field | Railway có thể dùng Node version khác nếu builder image đã update. `node:sqlite` (dùng trong PR #8) yêu cầu Node ≥ 22.5. Xác nhận Railway đang dùng Node ≥ 22 |
| `connect-sqlite3` | Có (old code) | **Đã xóa** (PR #8) | PR #8 xóa `connect-sqlite3` — `npm ci` sẽ không install nữa. Không có backward compat issue |
| Start command | `node scripts/check-env.js node server.js` (qua `dev` script) | Tương tự | Railway cần biết start command đúng. Kiểm tra Railway service settings |
| Nixpacks | Không có `nixpacks.toml` | Không có | Railway tự detect — dùng `package.json#scripts.start` nếu có, không có thì dùng `server.js` hoặc hỏi. Cần xác nhận Railway start command |

**Cần xác nhận trước deploy:** Railway service → Settings → Start command đang
là gì. Nếu là `npm run dev`, cần đổi thành `node server.js` hoặc set `start`
script trong `package.json`.

### 6.2 SQLite schema compatibility

- `task-auth.sqlite`: PR #8 thay driver nhưng **cùng schema** (`sessions`,
  `challenges`, `rate_limits` tables). `SQLiteSessionStore` dùng `INSERT OR REPLACE`
  — tương thích với data cũ
- `tasks.sqlite`: Không có schema migration trong PR #8, PR #9, PR #10
- `portfolio-history.sqlite`: Không có schema migration

**Kết luận:** Schema tương thích ngược — không cần migration script.

### 6.3 Healthcheck

Backend có route `/api/health` (xác nhận qua tests). Railway cần biết healthcheck
path này. Kiểm tra Railway service settings → Health check → path phải là
`/api/health` và port đúng với `BACKEND_PORT`.

### 6.4 Autodeploy

Nếu Railway autodeploy đang bật cho branch `makoto-wallet`, merge PR #10 sẽ
trigger deploy ngay. Kiểm tra Railway → Service → Source → Autodeploy setting
trước khi merge. Nếu muốn kiểm soát timing, tắt autodeploy trước, merge, rồi
trigger deploy thủ công sau khi backup xong.

### 6.5 Rollback khả năng

Rollback về `fe09df5` không mất data nếu không restore database (xem Mục 8).
Nhưng `fe09df5` sẽ trả lại RPC `arc.network` đã chết — `/api/arc/network`
sẽ tiếp tục 5xx. Không có env var override nào fix được vì code không hỗ trợ.

---

## 7. Quy trình deploy an toàn — ít downtime, có PASS/FAIL

### PRE-FLIGHT: Kiểm tra không thay đổi production

```bash
# 1. Xác nhận Railway CLI login
railway login --browserless   # hoặc railway login
railway status                # xác nhận đúng project/environment

# 2. Xác nhận đường dẫn DB thực tế
railway ssh --service makoto-backend
echo "TASK_AUTH_DB_PATH=$TASK_AUTH_DB_PATH"
echo "TASK_DB_PATH=$TASK_DB_PATH"
echo "PORTFOLIO_HISTORY_DB_PATH=$PORTFOLIO_HISTORY_DB_PATH"
ls -lh /data/*.sqlite 2>/dev/null
exit
```
**PASS:** Thấy 3 file `.sqlite` và biết path thực tế.
**FAIL:** Không vào được SSH, hoặc path khác default → dừng, báo lại.

```bash
# 3. Xác nhận start command trong Railway
# Railway dashboard → Service → Settings → Start Command
# Phải là: node server.js (hoặc tương đương, KHÔNG phải npm run dev)
```
**PASS:** Start command là `node server.js` hoặc blank (Railway auto-detect).
**FAIL:** Là `npm run dev` → phải sửa trong Railway settings TRƯỚC khi deploy.

```bash
# 4. Xác nhận healthcheck
# Railway dashboard → Service → Settings → Health Check Path: /api/health
# Health Check Port: <giá trị BACKEND_PORT>
```
**PASS:** Path và port đúng.
**FAIL:** Không có health check → Railway không biết khi nào container ready.

```bash
# 5. Kiểm tra autodeploy
# Railway dashboard → Service → Source → Auto Deploy
# Nếu đang ON cho branch makoto-wallet → TẮT trước bước merge
```

### BƯỚC A — Merge PR #10 [cần phê duyệt]

```
GitHub: PR #10 → merge vào makoto-wallet (KHÔNG phải main)
```
**PASS:** Merge thành công, commit mới trên `makoto-wallet`.
**FAIL:** Conflict → giải quyết conflict, re-run CI.

### BƯỚC B — Backup Railway volume [cần phê duyệt]

**B1. Tạo Railway volume manual backup (lớp 2):**
```
Railway dashboard → Volume → Backups → Create backup
```
Đợi backup hoàn thành. Ghi lại backup ID/timestamp.
**PASS:** Backup status = completed.
**FAIL:** Backup fail → dừng, không tiếp tục.

**B2. SQLite Backup API qua SSH (lớp 1 — application-consistent):**
```bash
railway ssh --service makoto-backend

# Thay đường dẫn theo kết quả PRE-FLIGHT bước 2
BACKUP_TS=$(date +%Y%m%d-%H%M%S)
sqlite3 /data/task-auth.sqlite ".backup /data/task-auth.sqlite.bak-${BACKUP_TS}"
sqlite3 /data/tasks.sqlite ".backup /data/tasks.sqlite.bak-${BACKUP_TS}"
sqlite3 /data/portfolio-history.sqlite ".backup /data/portfolio-history.sqlite.bak-${BACKUP_TS}" || echo "SKIP: portfolio-history not at default path"

# Verify backup integrity
sqlite3 /data/task-auth.sqlite.bak-${BACKUP_TS} "PRAGMA integrity_check;"   # phải: ok
sqlite3 /data/tasks.sqlite.bak-${BACKUP_TS} "PRAGMA integrity_check;"        # phải: ok

echo "BACKUP_TS=$BACKUP_TS"   # lưu lại giá trị này
exit
```
**PASS:** Cả hai integrity check trả `ok`. Ghi lại `BACKUP_TS`.
**FAIL:** Integrity check trả khác `ok` → dừng hoàn toàn, điều tra.

**B3. Download backup về máy local:**
```bash
mkdir -p ./railway-backup
railway volume files download /data/task-auth.sqlite.bak-${BACKUP_TS} ./railway-backup/task-auth-${BACKUP_TS}.sqlite
railway volume files download /data/tasks.sqlite.bak-${BACKUP_TS} ./railway-backup/tasks-${BACKUP_TS}.sqlite

sqlite3 ./railway-backup/task-auth-${BACKUP_TS}.sqlite "PRAGMA integrity_check;"   # ok
sqlite3 ./railway-backup/tasks-${BACKUP_TS}.sqlite "PRAGMA integrity_check;"        # ok
```
**PASS:** Files download xong, integrity check `ok` trên máy local.
**FAIL:** Download fail hoặc integrity `ok` không ra → dừng.

### BƯỚC C — Remove deployment cũ [cần phê duyệt, gây downtime]

```bash
railway down --service makoto-backend
# Đợi Railway dashboard hiện "No active deployment"
# Volume vẫn còn — kiểm tra dashboard dưới service volumes
```
**PASS:** Dashboard hiện "No active deployment", volume vẫn attached.
**FAIL:** `railway down` báo lỗi → kiểm tra Railway dashboard, không tiếp tục.

> Sau bước này backend offline (~1–3 phút đến khi bước D xong).
> `railway ssh` không còn khả dụng cho đến khi deploy mới pass health check.

### BƯỚC D — Deploy từ `makoto-wallet` [cần phê duyệt]

```bash
# Option A: Trigger qua CLI
railway up --service makoto-backend --detach

# Option B: Railway dashboard → Service → Deploy → chọn branch makoto-wallet
```

Đợi Railway build và deploy. Theo dõi build logs:
```bash
railway logs --build --service makoto-backend
```

**PASS:** Health check `/api/health` trả 200, Railway dashboard hiện "Active".
**FAIL:** Health check fail, container crash loop → xem Mục 8 rollback.

### BƯỚC E — Verify sau deploy

```bash
# 1. Health check
curl https://RAILWAY_BACKEND_URL/api/health
```
**PASS:** HTTP 200.
**FAIL:** Không phải 200 → xem logs, rollback nếu cần.

```bash
# 2. Arc RPC — mục tiêu chính của hotfix
curl https://RAILWAY_BACKEND_URL/api/arc/network | python3 -m json.tool
```
**PASS:** `chainId: 5042002`, `blockNumber > 0`, không có `"error"` field.
**FAIL:** `{"error": "Arc RPC unavailable"}` → kiểm tra logs Railway, RPC endpoint.

```bash
# 3. SQLite integrity trong container mới
railway ssh --service makoto-backend
sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"   # ok
sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"        # ok
sqlite3 /data/portfolio-history.sqlite "PRAGMA integrity_check;" 2>/dev/null || echo "skip"
exit
```
**PASS:** `ok` cho cả databases.
**FAIL:** Bất kỳ kết quả nào khác `ok` → dừng, không để user truy cập, điều tra.

```bash
# 4. Cleanup backup files trong volume (sau khi đã có bản local)
railway ssh --service makoto-backend
ls -lh /data/*.bak-*   # xác nhận backup files
# Giữ nguyên backup files trong volume ít nhất 48 giờ sau deploy thành công
exit
```

### BƯỚC F — Verify UI production

- [ ] `makotowallet.xyz` — sidebar không còn "Đang kết nối Arc…" sau 30 giây
- [ ] Arc Chain Pulse hiển thị block number thực (số dương, cập nhật)
- [ ] Send/Swap/Bridge accessible (không cần thực hiện transaction thật)

---

## 8. Rollback — không ghi đè data mới

**Nguyên tắc:** Backup `.bak` files trong volume là ảnh chụp **trước** deploy.
Data mới (sessions, tasks) có thể đã được ghi sau khi deploy. Ghi đè sẽ xóa
data mới này mà không recover được.

**Quy trình rollback (chỉ khi cần, cần phê duyệt):**

```bash
# 1. Kiểm tra integrity hiện tại trước khi quyết định gì
railway ssh --service makoto-backend
sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"
sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"
exit
```

**Nếu integrity = `ok` (database tốt, chỉ cần rollback code):**
```bash
# Rollback code về commit cũ — KHÔNG touch database
railway down --service makoto-backend
# Railway dashboard → Service → Deployments → chọn deployment fe09df5 → Redeploy
# HOẶC: push revert commit lên makoto-wallet và deploy
```
**Chấp nhận:** Sau rollback về `fe09df5`, `/api/arc/network` sẽ lại 5xx vì RPC
`arc.network` đã chết. Đây là trạng thái trước hotfix — degraded nhưng không
mất data.

**Nếu integrity ≠ `ok` (database bị corrupt):**
```
DỪNG HOÀN TOÀN. Không tự thực hiện bất kỳ bước nào thêm.
Liên hệ team, đánh giá:
- Backup SQLite local (./railway-backup/) có intact không?
- Railway volume backup (lớp 2) có intact không?
Chỉ restore sau khi có phê duyệt rõ ràng và đánh giá thiệt hại đầy đủ.
```

---

## 9. Checklist phê duyệt

### Giai đoạn PRE-FLIGHT (không thay đổi production, không cần phê duyệt)
- [ ] Railway CLI login và link đúng project
- [ ] Xác nhận `TASK_AUTH_DB_PATH`, `TASK_DB_PATH`, `PORTFOLIO_HISTORY_DB_PATH`
- [ ] Xác nhận start command và healthcheck trong Railway settings
- [ ] Kiểm tra autodeploy setting

### Giai đoạn A — cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** Merge PR #10 vào `makoto-wallet`

### Giai đoạn B — cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** Tạo Railway volume manual backup
- [ ] **PHÊ DUYỆT:** SQLite `.backup` qua `railway ssh`
- [ ] **XÁC NHẬN:** Backup integrity = `ok` trước khi tiếp tục

### Giai đoạn C — cần phê duyệt riêng, GÂY DOWNTIME
- [ ] **PHÊ DUYỆT:** `railway down` (dừng service hiện tại)

### Giai đoạn D — cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** Trigger deploy từ `makoto-wallet`

### Giai đoạn E/F — verify (không cần phê duyệt riêng, thực hiện sau deploy)
- [ ] Health check, Arc RPC, SQLite integrity, UI production

### Giai đoạn rollback — chỉ khi cần, cần phê duyệt riêng
- [ ] **PHÊ DUYỆT:** Quyết định rollback (sau đánh giá integrity)

---

## 10. Tóm tắt rủi ro — phiên bản cuối

| Rủi ro | Xác minh | Biện pháp |
|---|---|---|
| `railway ssh` vs `railway shell` nhầm lẫn | **Đã xác minh:** ssh = remote, shell = local | Dùng đúng lệnh theo context |
| Rolling deploy có hai container mount chung volume | **Chưa có bằng chứng** — Railway docs không confirm | Dùng `railway down` + cold deploy để loại trừ rủi ro |
| `wal_checkpoint(TRUNCATE)` + cp không nhất quán | **Đúng** — checkpoint có thể fail nếu có reader | Dùng SQLite `.backup` API thay thế |
| Backup `railway service files download` sai lệnh | **Đã xác minh:** lệnh đúng là `railway volume files download` | Sửa trong kế hoạch |
| Bỏ sót `portfolio-history.sqlite` | **Đã xác minh:** 3 databases, không phải 2 | Thêm vào backup và verify |
| `ARC_RPC_OVERRIDE` không tồn tại trong code | **Đã xác minh** | Loại bỏ, không thêm lại |
| Rollback ghi đè data mới | **Rủi ro thực** | Chỉ rollback code nếu integrity ok |
| Railway volume backup không application-consistent | **Đã xác minh:** snapshot filesystem, không biết WAL | Dùng `.backup` API trước, volume backup là lớp 2 |
| Node.js version thay đổi ảnh hưởng `node:sqlite` | **Giả định:** Railway có thể update builder | Xác nhận Node ≥ 22.5 trong Railway |
| Downtime trong khoảng `railway down` → health check | **Xác nhận:** 1–3 phút | Thông báo user trước nếu cần |
