# Railway Backend Migration Plan — Arc RPC Hotfix
# 2026-10-16

## Tình trạng hiện tại Railway

| Thông số | Giá trị |
|---|---|
| Branch đang chạy | `release/makoto-wallet-2026-10-01` |
| Commit đang chạy | `fe09df5014a1d8b96034e8249456b381347ad43e` |
| Deploy date | 2026-10-01 |
| PR chưa có | PR #8 (B6/P1 SQLite auth fix), PR #9 (UI/UX fixes) |
| Volume | `/data` — chứa `task-auth.sqlite`, `tasks.sqlite` và WAL/SHM files |
| Env | `SURF_API_KEY`, `BACKEND_PORT`, `COINGECKO_*`, `LLM_*`, `TASK_*` |

---

## Version drift — những thay đổi còn thiếu

### PR #8 — B6/P1 SQLite authentication fix (QUAN TRỌNG)

**Vấn đề:** Old code dùng `connect-sqlite3` (SQLite 3.44.2) và `node:sqlite` (SQLite 3.53.0)
cùng một WAL file. Trên Linux, hai bản SQLite độc lập không chia sẻ POSIX lock — có thể
gây database corruption. CI Linux đã reproduce được lỗi 99/100 tests.

**Fix:** Thay `connect-sqlite3` bằng `SQLiteSessionStore` native dùng cùng `DatabaseSync`
handle với phần còn lại của backend.

**Impact khi upgrade:** KHÔNG được chạy old backend và new backend đồng thời trên cùng
file `task-auth.sqlite`. Rolling deploy mà overlap sẽ trigger đúng lỗi mà PR #8 fix.

### PR #9 — UI/UX fixes

Feedback modal localization, Receive share improvements. Không có schema migration.
Không ảnh hưởng SQLite, không cần đặc biệt chú ý khi deploy.

### Hotfix hiện tại (PR #10 sắp tạo)

RPC endpoint fix. Backend chỉ đổi constant string và thêm error classification.
Không có schema migration, không thay đổi SQLite structure.

---

## Tiêu chí bắt buộc trước khi deploy

1. **Backup nhất quán SQLite** — cần flush WAL trước khi copy:
   ```bash
   # Chạy trên Railway shell TRƯỚC KHI dừng service
   sqlite3 /data/task-auth.sqlite "PRAGMA wal_checkpoint(FULL);"
   sqlite3 /data/tasks.sqlite "PRAGMA wal_checkpoint(FULL);"
   cp /data/task-auth.sqlite /data/task-auth.sqlite.bak-$(date +%Y%m%d-%H%M%S)
   cp /data/tasks.sqlite /data/tasks.sqlite.bak-$(date +%Y%m%d-%H%M%S)
   # Giữ cả WAL/SHM cùng backup
   cp /data/task-auth.sqlite-wal /data/task-auth.sqlite-wal.bak-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
   cp /data/task-auth.sqlite-shm /data/task-auth.sqlite-shm.bak-$(date +%Y%m%d-%H%M%S) 2>/dev/null || true
   ```

2. **Không rollover đồng thời** — Railway phải scale backend về 0 trước khi deploy mới.
   Không dùng rolling deploy / zero-downtime cho lần này do PR #8 không an toàn với overlap.

3. **Kiểm tra integrity sau restart**:
   ```bash
   sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"
   sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"
   # Kết quả phải là: ok
   ```

---

## Quy trình deploy an toàn (theo thứ tự)

### Bước 1 — Chuẩn bị (không cần downtime)

- [ ] Xác nhận PR #10 (hotfix) và PR #9 đã được review và approved
- [ ] Xác nhận CI GitHub Actions PASS trên commit mới nhất
- [ ] Xác nhận Vercel Preview (frontend) không có regression mới

### Bước 2 — Backup SQLite (Railway shell)

```bash
# 1. Flush WAL
sqlite3 /data/task-auth.sqlite "PRAGMA wal_checkpoint(FULL);"
sqlite3 /data/tasks.sqlite "PRAGMA wal_checkpoint(FULL);"

# 2. Backup với timestamp
BACKUP_TS=$(date +%Y%m%d-%H%M%S)
cp /data/task-auth.sqlite /data/task-auth.sqlite.bak-${BACKUP_TS}
cp /data/tasks.sqlite /data/tasks.sqlite.bak-${BACKUP_TS}
cp /data/task-auth.sqlite-wal /data/task-auth.sqlite-wal.bak-${BACKUP_TS} 2>/dev/null || true
cp /data/task-auth.sqlite-shm /data/task-auth.sqlite-shm.bak-${BACKUP_TS} 2>/dev/null || true

# 3. Xác minh backup
ls -lh /data/*.bak-${BACKUP_TS}
```

### Bước 3 — Dừng service cũ

```bash
# Railway dashboard: Service → Settings → Scale down to 0 replicas
# Đợi Railway confirm "0 instances running"
# KHÔNG dùng Deploy mới ngay — phải đợi instance cũ dừng hoàn toàn
```

### Bước 4 — Deploy version mới

- Đổi Railway service sang branch `main` (hoặc branch sau khi merge PR)
- Trigger deploy
- Đợi health check `/api/health` trả 200

### Bước 5 — Verify sau deploy

```bash
# 1. Health check
curl https://<railway-backend-url>/api/health

# 2. Arc RPC status — phải trả 200 với blockNumber
curl https://<railway-backend-url>/api/arc/network | jq .

# Kỳ vọng:
# {
#   "chainId": 5042002,
#   "blockNumber": <số dương>,
#   "gasPriceGwei": <số dương>,
#   ...
# }

# 3. Wallet read (dùng public address test)
curl "https://<railway-backend-url>/api/arc/wallet?address=0x0000000000000000000000000000000000000001"
# Kỳ vọng: 400 (invalid address) — tức là route đang chạy

# 4. SQLite integrity
sqlite3 /data/task-auth.sqlite "PRAGMA integrity_check;"
sqlite3 /data/tasks.sqlite "PRAGMA integrity_check;"
```

### Bước 6 — Verify production UI

- [ ] Sidebar không còn "Đang kết nối Arc…" kéo dài
- [ ] Arc Chain Pulse hiển thị block number
- [ ] Nếu thấy "Arc unreachable" + Retry → RPC vẫn gặp vấn đề → điều tra log
- [ ] Không được hiện "Connecting to Arc…" sau 30 giây

---

## Rollback plan (không xóa dữ liệu)

Nếu deploy mới có vấn đề:

```bash
# 1. Scale Railway về 0
# 2. Restore SQLite từ backup
cp /data/task-auth.sqlite.bak-${BACKUP_TS} /data/task-auth.sqlite
cp /data/tasks.sqlite.bak-${BACKUP_TS} /data/tasks.sqlite
# 3. Đổi Railway service trở lại commit cũ (fe09df5)
# 4. Scale lên 1 replica
# 5. Verify /api/health
```

**Lưu ý:** Rollback về fe09df5 có nghĩa là quay lại RPC `arc.network` đã chết.
Nếu phải rollback, cần patch thủ công RPC URL trong Railway env:
```bash
# Thêm env var vào Railway
ARC_RPC_OVERRIDE=https://rpc.testnet.arc.io
```
Và sửa `backend/routes/arc.js` để đọc `process.env.ARC_RPC_OVERRIDE` nếu có.
(Đây là lý do tại sao deploy version mới là ưu tiên — không cần env var override.)

---

## Checklist cuối trước khi bàn giao Railway cho chủ dự án

- [ ] PR #10 (hotfix) đã được review và CI pass
- [ ] PR #9 đã được review (nếu chưa deploy)
- [ ] Backup SQLite đã xác nhận (`ls -lh /data/*.bak-*`)
- [ ] `PRAGMA integrity_check` trả `ok` trước deploy
- [ ] Railway scale về 0 trước khi deploy mới
- [ ] `/api/arc/network` trả 200 với `blockNumber > 0` sau deploy
- [ ] `PRAGMA integrity_check` trả `ok` sau deploy
- [ ] Sidebar production hiển thị block number (không còn skeleton)

---

## Ghi chú bảo mật

- Session hiện tại trên `task-auth.sqlite` sẽ còn hợp lệ sau upgrade
  (SQLiteSessionStore dùng cùng schema, không migration)
- Nonces chưa consume sẽ expire tự nhiên (5 phút TTL)
- Không có user data bị mất khi upgrade đúng quy trình trên
- `TASK_SESSION_SECRET` không thay đổi — cookies cũ vẫn valid

---

## Tại sao KHÔNG dùng rolling deploy lần này

PR #8 fix race condition giữa `connect-sqlite3` và `node:sqlite` trên cùng WAL file.
Nếu Railway spin up 1 instance mới (new code) trong khi instance cũ vẫn chạy, cả hai
sẽ cùng mở `task-auth.sqlite` — đúng scenario mà B6/P1 đã reproduce database corruption.

**Scale to 0 → Deploy new → Scale to 1** là quy trình duy nhất an toàn.
