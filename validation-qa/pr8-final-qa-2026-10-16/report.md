# Final QA PR #8 — 2026-10-16

1. **Tổng kết QA:** AUTOMATED PASS và LOCAL MOCKED UI PASS trên bản sửa cuối. Hosted UI smoke đã kiểm tra trực tiếp 8/8 tổ hợp trên deployment ban đầu; phải đối chiếu lại deployment sau push bản sửa. LIVE TESTNET NOT VERIFIED: chưa có giao dịch mới được chủ ví cho phép. Kết luận có điều kiện, không suy ra an toàn chỉ từ CI.

2. **Commit/branch:** Bắt đầu tại `adb05b9aeaffbbbb2edf94a90efe487b38bd2ddc`, branch `fix/swap-bridge-approval-continuation-2026-10-15`; local và remote trùng nhau sau fetch. PR #8 OPEN, chưa merge, base `makoto-wallet` (`1b53de4324cb707c0f50cd2da3774af4dcdbab35`); CI run `38876860087` và hai Vercel checks thành công cho đúng SHA này. Mọi file local chưa track được giữ nguyên. Bản sửa QA nằm cùng branch; SHA sau commit/CI và hosted recheck được ghi trong PR description/kết quả post-push. Code đóng băng khi chạy bộ cuối có diff SHA256 `d266b2701c05f6bf82bee910ef0ebeaf9ea29057c24704bfe1745ccdb3372df2`; hash 228 file code/config trước và sau test trùng nhau.

3. **Swap:** Actual SwapPage/control/policy trong browser cô lập xác minh Flow A đủ allowance không Approve dư; Flow B finite Approve → receipt/allowance mới → fresh review → click xác nhận Swap riêng. Quote/material/slippage/expiry/gas thay đổi bị chặn hoặc yêu cầu review lại đúng điều kiện. Click liên tục vẫn một request cho mỗi bước, ví từ chối không báo thành công. Sau bản sửa, hash Approve chỉ còn trong approvalReceipt lịch sử, không hiển thị thành hash của action UNKNOWN.

4. **Bridge:** Actual BridgePage/control xác minh đúng Arc Testnet→Base Sepolia USDC/CCTP v2, amount/fee/floor/speed, finite Approve và burn riêng; REVALIDATING hiển thị là tiếp tục approval. Gas mới hợp lệ dưới/bằng ceiling không review lặp; vượt ceiling phải review lại. Không báo hoàn tất từ source receipt hoặc Circle forwarding hash đơn lẻ. Gate đích vẫn cần Base receipt thành công và matching USDC Transfer. Ngoài mock, script chỉ đọc mới chạy qua code reconciliation hiện tại trên giao dịch lịch sử có trong fixture repository: Arc source hash `0x452e3fcc7a2112e4940b19e23e065cf62dadcd20ffb53d620361ab57d605dba4`, destination `0x5053ac4396a41769dd18e72f353de75533d458ecab3d5e8f7fd8c1d693e0fbe9`, trạng thái quan sát được `destination-confirmed`. Đây không phải giao dịch do agent tạo hay live-wallet QA mới.

5. **Reload/recovery:** Kiểm tra approval confirmed/pending, Swap/burn pending, UNKNOWN có hoặc không hash, Circle attestation pending, account/chain khác, nhiều reload khi quote đang chờ, RPC/status unavailable, read/write storage failure, property getter bị từ chối và Activity/callback lỗi. Input phục hồi đúng identity; không tự gửi lại. Hash thật được giữ trên trang khi không lưu/đọc được checkpoint, có EN/VI hướng dẫn bảo toàn. Remount khi identity checkpoint không đọc được dừng ghi/quote/send. Khi storage hoạt động lại, chỉ đúng revision cũ được phép kiểm tra receipt. Done vẫn giữ lịch sử đã lưu.

6. **Automated tests:** Chạy mới toàn bộ 15 lệnh sau trên cùng snapshot code đóng băng, **633 PASS / 0 FAIL / 0 SKIP**. Bộ đầu trên adb05b9 chỉ có 615 PASS; QA độc lập phát hiện các case chưa được bao phủ, rồi thêm 18 regression có negative control trước khi sửa.

| Lệnh | PASS |
|---|---:|
| `npm run test:completion --prefix frontend` | 143/143 |
| `npm run test:migration --prefix frontend` | 110/110 |
| `npm run test:brain --prefix frontend` | 21/21 |
| `npm run test:agent --prefix frontend` | 32/32 |
| `npm run test:send --prefix frontend` | 31/31 |
| `npm run test:tasks --prefix frontend` | 22/22 |
| `npm run test:portfolio --prefix frontend` | 18/18 |
| `npm run test:ux --prefix frontend` | 59/59 |
| `npm run test:ui --prefix frontend` | 39/39 |
| `npm run test:polish --prefix frontend` | 58/58 |
| `npm test --prefix backend` | 100/100 |
| `npm run type-check --prefix frontend` | exit 0 |
| `npm run lint --prefix frontend` | exit 0; 0 error, 12 cảnh báo cũ |
| `npm run build --prefix frontend` | exit 0; client và SSR |
| `git diff --check` | exit 0 |

CDP observer gắn trong bộ nhớ của harness vào chính hai lệnh npm browser, không sửa code production/test để quan sát: **174 browser tests, 0 Runtime exceptions, 0 console errors**. Hai cảnh báo buffer/Vite đã tái hiện trên controls historical; hai favicon 404 chỉ thuộc fixture. Không có network error khác. Vị trí/nội dung 12 cảnh báo lint trùng bằng chứng trước; dynamic-import/large-chunk warnings hiện hữu không bị giấu. Các SDK error-level logs của migration là assertion ví mock từ chối đã có trước. Không có uncaught/unhandled exception trong log bộ cuối.

7. **Vercel Preview:** Ban đầu cả browser cô lập và Chrome hiện có đều tới Vercel Login; không thay đổi Deployment Protection/quyền truy cập, không tạo bypass link. Sau khi phiên Chrome được xác thực, đã trực tiếp kiểm tra Swap/Bridge × EN/VI × 1440×900/390×844 trên alias Preview của deployment `7TRqyQarpi1A9e1gSdvrsLoioq4K`, gắn với adb05b9 qua GitHub commit status. Trang hiển thị đúng; không overflow ngang; input rỗng khóa CTA, input 1 bật một nút review preview; chọn Standard đổi đúng speed; không có approval/action signature dialog khi chưa kết nối ví. Console app không có error; warning Google One Tap quan sát được thuộc trang Vercel Login trước đó. Sau push cần đối chiếu lại đúng deployment mới. Hosted này ở chế độ dữ liệu mẫu/preview, không chứng minh connected transaction flow.

8. **Live wallet/testnet:** NOT VERIFIED. Không có ví được xác minh kết nối trong Preview đã truy cập; không tạo yêu cầu ký, không Approve/Swap/burn/broadcast thật. [Kịch bản cần chủ ví xác nhận](testnet-checklist.md) nêu Arc 5042002, Base Sepolia 84532, token, amount thử đề xuất 1 USDC, yêu cầu số dư `amount + gas tối đa` theo quote mới, các chữ ký tách biệt và receipt/transfer evidence. Không bịa số dư, quote hay gas minimum tuyệt đối khi chưa có dữ liệu account/quote mới. Read-only RPC mới xác minh chain/code/gas và reconciliation lịch sử ở trên, không nâng thành LIVE TESTNET PASS.

9. **Bugs đã xác minh và sửa:**

| ID | Mức độ | Tái hiện/nguyên nhân | Sửa |
|---|---|---|---|
| S1 | P1 | Checkpoint chưa giải quyết tồn tại; getItem lỗi; remount rồi bắt đầu review. Hai undefined bị coi là cùng identity, ghi IDLE đè checkpoint. | Không bắt đầu khi checkpoint không đọc được; null đã xác minh vẫn là chưa có checkpoint. Giữ nguyên bytes/hash, không quote/send mới. |
| S2 | P2 | Ví trả hash khi getItem lỗi; early return làm control mất hash/check/warning, dù action Activity vẫn có bằng chứng độc lập. | Fallback chỉ giữ hash thật trong đúng mounted operation, UNKNOWN + cảnh báo; không ghi qua identity chưa xác minh và không poll cho tới khi đọc lại đúng revision. |
| S3 | P2 | Approve confirmed → action transport UNKNOWN không trả hash; hash approval cũ bị hiển thị như action, kể cả reload. | Current hash chỉ từ run.hash; giữ approvalReceipt riêng; không có action hash thì không có nút kiểm receipt action, hướng dẫn kiểm lịch sử ví/explorer. |
| S4 | P2 | Đổi amount/speed sau CCTP review làm phase cũ từ chối fresh review. Đã tái hiện cả production base trước PR. | Explicit Start chỉ thay review chưa gửi/idle và các terminal phase đã cho phép; pending/unknown barriers giữ nguyên. |
| S5 | P2 | LocalStorage property getter ném SecurityError làm page/control crash. | Catch tại khôi phục form/layout; hiển thị unavailable và chặn thao tác trong khi không xác minh được checkpoint. |

Cả **18 regression mới đều FAIL ở adb05b9** qua read-only historical override, rồi PASS trên bản sửa; hai negative after-reload bổ sung trùng S3 nên không cộng như test unique. Các thay đổi không giữ signer, không cấp quyền thực thi từ storage và không đổi address/chain/route. Review source độc lập sau sửa không tìm thêm lỗi actionable trong phạm vi đã thử.

10. **Kết luận:** **CONDITIONALLY READY**, với điều kiện CI và hosted smoke được xác minh lại cho SHA chứa bản sửa, sau đó chủ dự án quyết định phần live testnet được phép. Không kết luận READY TO MERGE tuyệt đối khi chưa có live-wallet receipt evidence. Không merge, push production hoặc deploy production trong vòng QA. Phase 13 implementation vẫn chưa bắt đầu.

## Bằng chứng và giới hạn

Raw logs/screenshot/probe scripts được giữ local trong thư mục QA này. Tóm tắt có cấu trúc ở `automated/final-worktree/summary.json`; security review ở `security/review.md`; local UI ở `local-ui/README.md` và `local-ui/final-focused-summary.json`. Full App demo EN/VI/light/dark/desktop/mobile là bằng chứng bổ sung; vòng local đóng băng cuối rerun 14/14 trường hợp chọn lọc, gồm 8 flow EN/VI×desktop/mobile và các recovery/getter cases. Các harness assertions/selector sai đã được ghi lại và sửa theo DOM thực tế, không dùng chúng làm bug production hoặc thay test để ép PASS. Source hash trước/sau các lượt cuối trùng nhau.

Các lượt intermediate hoặc mixed-source được lưu riêng và loại khỏi kết luận cuối. Browser/provider/mock evidence, hosted demo/preview evidence và public historical-chain reads được phân biệt rõ với live-wallet transaction QA. Script [read-only-network.mjs](read-only-network.mjs) và [kết quả đọc mới](read-only-network.json) có thể kiểm tra lại; không có signer hay RPC write method.
