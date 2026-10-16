# Arc RPC Hotfix + Version Drift Report — 2026-10-16

## 1. Nguyên nhân lỗi RPC — đã chứng minh

**Root cause:** `rpc.testnet.arc.network` trả `NXDOMAIN` (DNS không phân giải được).
Từ sandbox này xác nhận trực tiếp:

```
curl https://rpc.testnet.arc.network   →  exit code 1, connect_time=0.000s  (NXDOMAIN)
curl https://rpc.testnet.arc.io        →  HTTP 200, latency ~50ms
```

JSON-RPC responses từ endpoint mới:
- `eth_chainId` → `0x4cef52` = **5042002** ✅
- `eth_blockNumber` → `0x405faf3` = 67500787 ✅
- `eth_gasPrice` → `0x4a817c800` = 20 gwei ✅

Kết quả này giải thích trực tiếp log Railway: `arc/network fetch failed` trên 572/678 request trong 3 giờ.

---

## 2. Endpoint mới được kiểm chứng

| Endpoint | DNS | HTTPS | eth_chainId | Latency |
|---|---|---|---|---|
| `https://rpc.testnet.arc.io` | ✅ Resolves | ✅ 200 | ✅ 5042002 | ~50ms |
| `https://rpc.testnet.arc.network` | ❌ NXDOMAIN | — | — | — |

---

## 3. Files đã sửa

| File | Thay đổi |
|---|---|
| `backend/routes/arc.js` | Thay `rpc.testnet.arc.network` → `rpc.testnet.arc.io`; thêm `RpcError`, `RpcErrorKind`; phân loại lỗi DNS/HTTP/JSONRPC/Timeout; retry 1 lần sau 400ms cho lỗi transient |
| `backend/lib/taskReads.js` | Thay `rpc.testnet.arc.network` → `rpc.testnet.arc.io` |
| `frontend/src/lib/wallet.ts` | Thay `ARC.rpc` → `rpc.testnet.arc.io` (dùng khi thêm chain vào MetaMask/OKX) |
| `frontend/src/lib/store.tsx` | Thêm `networkStatus` (`loading`/`online`/`stale`/`unavailable`) và `retryNetwork()`; thêm `retry: 1, retryDelay: 2000, staleTime: 30_000` để tránh skeleton vô hạn và false "Arc unreachable" sau 1 lỗi |
| `frontend/src/App.tsx` | Sidebar dùng `networkStatus` thay `networkError`; thêm nút Retry EN/VI khi unavailable; không hiển thị "Connecting to Arc…" khi đã có stale data |
| `frontend/src/pages/Dashboard.tsx` | `NetworkCard` dùng `networkStatus`; skeleton chỉ hiện khi `loading`, không khi `unavailable`; nút Retry |
| `frontend/src/pages/Product.tsx` | `StatusPage` dùng `networkStatus` thay `networkError` |
| `frontend/src/lib/i18n.ts` | Thêm keys: `Connecting to Arc…`, `Arc unreachable`, `Arc data is stale — last seen`, `Stale`, `Retry` với đầy đủ EN/VI/ZH/JA/KO |
| `backend/tests/arc.test.js` | **Mới**: 10 regression tests cho RPC URL, error classification, negative control |

---

## 4. Kết quả CI

| Gate | Kết quả |
|---|---|
| Backend full suite | **126/126 pass** (bao gồm 10 arc tests mới) |
| Frontend ESLint | **0 errors**, 12 warnings (đúng bằng baseline, không tăng) |
| Frontend TypeScript | **Pass** (0 errors) |
| Dev server | Đang chạy, preview HTTP 200 |

---

## 5. Version drift Railway

**Railway đang chạy:**
- Branch: `release/makoto-wallet-2026-10-01`
- Commit: `fe09df5014a1d8b96034e8249456b381347ad43e` (01/10/2026)

**Những thay đổi còn thiếu (PR #8, #9):**

### PR #8 — B6/P1 SQLite authentication fix (QUAN TRỌNG)
- **Vấn đề:** Old `SQLiteSessionStore` mở cùng 1 WAL database qua cả `node:sqlite` built-in VÀ `connect-sqlite3` (SQLite 3.44.2). Trên Linux Node 24, hai độc lập SQLite copies không chia sẻ POSIX lock bookkeeping → có thể corrupt database.
- **Fix:** Xoá `connect-sqlite3`; implement `SQLiteSessionStore` thuần `node:sqlite` built-in (một handle duy nhất, không race condition).
- **Tác động khi chưa có:** Trên Railway Linux Node 24, xác suất `SQLiteRateStore.increment` thất bại với "database disk image is malformed" → session auth trả 500 thay vì 401.
- **Baseline CI evidence:** Linux CI run [38880600184](https://github.com/congthuat/Makoto-Wallet/actions/runs/38880600184) fail 99/100 tests; Windows pass (khác biệt do locking primitives).

### PR #9 — Agent Native Execution (Send/Swap/Bridge)
- Nội dung cụ thể cần kiểm tra trên GitHub PR history.

---

## 6. Rủi ro khi upgrade Railway backend

### Rủi ro cao
- **Không dừng process cũ trước khi deploy mới:** Nếu Railway rolling deploy chạy old + new backend đồng thời trên cùng `backend/data/task-auth.sqlite`, old dùng `connect-sqlite3` + new dùng `node:sqlite` → **WAL corruption** như CI đã chứng minh trên Linux.
- **Giải pháp:** Buộc zero-downtime-off: dừng backend cũ hoàn toàn trước khi khởi động mới.

### Rủi ro thấp
- Sessions cũ vẫn valid sau PR #8 (path, schema, cookie format không đổi).
- Dữ liệu `tasks.sqlite` và `portfolio-history.sqlite` không bị ảnh hưởng.

---

## 7. Kế hoạch deploy an toàn lên Railway

**Không tự merge, không deploy khi chưa được chủ dự án chấp thuận.**

Quy trình khuyến nghị:

1. **Tạo PR** từ branch này (hoặc branch `fix/arc-rpc-hotfix`) vào `main`.
2. **Verify CI** pass trên Linux (đặc biệt auth tests × 20 runs như PR #8).
3. **Backup SQLite trên Railway** trước khi deploy:
   ```sh
   # Trên Railway shell
   cp backend/data/task-auth.sqlite backend/data/task-auth.sqlite.bak
   cp backend/data/tasks.sqlite backend/data/tasks.sqlite.bak
   ```
4. **Deploy với zero-overlap**: Tắt backend cũ (`railway down` hoặc scale to 0) TRƯỚC khi Railway khởi động phiên bản mới.
5. **Verify health**: `GET /api/health` → 200; `GET /api/arc/network` → 200 với `chainId: 5042002`.
6. **Rollback nếu cần**: Không xóa dữ liệu; chỉ revert deploy về commit `fe09df5` và restart.

---

## 8. Phân biệt lỗi backend RPC vs trạng thái kết nối ví

Đây là 2 thực thể hoàn toàn độc lập:

| | Backend RPC | Wallet connection |
|---|---|---|
| Nguồn | `GET /api/arc/network` → `https://rpc.testnet.arc.io` | `eth_chainId` / `eth_accounts` qua EIP-1193 provider trong browser |
| Hiển thị | Sidebar LiveDot + `networkStatus` | `walletChainId`, `mode`, `walletAccountConfirmed` |
| Khi lỗi | "Arc unreachable" + Retry button | "Wallet is not on Arc Testnet." hoặc connection picker |
| **KHÔNG nhầm** | networkStatus === 'unavailable' KHÔNG nghĩa là ví người dùng bị lỗi | walletError KHÔNG nghĩa là Arc network down |

Store đã tách biệt: `networkStatus` (Arc RPC health) vs `walletChainId` (user wallet chain) vs `walletError` (explorer API failure).

---

## 9. Guard an toàn còn nguyên

- Không dùng `networkStatus === 'unavailable'` làm bằng chứng để block Send/Swap/Bridge. Các flow đó dùng `walletChainId` (từ wallet provider trực tiếp) làm authority.
- `networkError` cũ vẫn còn trong store (backward compat) — agent/brain code dùng `context.networkError` không bị ảnh hưởng.
- Skeleton chỉ tắt sau khi TanStack Query đã retry xong và kết luận là lỗi thật, không phải ngay lập tức.
