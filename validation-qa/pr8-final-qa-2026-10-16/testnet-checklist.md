# Kịch bản testnet cần chủ ví xác nhận

Chưa có live-wallet/testnet PASS trong vòng QA này. Tab Preview hiện dừng ở Vercel Login; không có ví đã được xác minh kết nối với Preview. Không yêu cầu private key/seed phrase và không tạo yêu cầu ký để QA tự động.

## Mạng và token

- Nguồn: **Arc Testnet**, chain ID **5042002**, RPC cấu hình `https://rpc.testnet.arc.network`.
- Đích Bridge: **Base Sepolia**, chain ID **84532**. Chỉ USDC qua Circle CCTP v2 forwarding.
- Swap: USDC `0x3600000000000000000000000000000000000000` ↔ EURC `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`, mỗi token 6 decimals.
- Phí nguồn: native USDC của Arc, smallest unit 18 decimals. Không dùng mainnet.
- Nhận USDC trên Base Sepolia tại chính địa chỉ ví; không cần chữ ký nhận/mint trong luồng forwarding đang hỗ trợ.

## Số dư tối thiểu

Đề xuất nhập **1 USDC** cho mỗi lần Swap/Bridge sau khi chủ ví chấp thuận riêng. Đây là số tiền thử đề xuất, không phải số dư hoặc quote đã quan sát từ ví người dùng.

Gọi `Gapproval`, `Gswap`, `Gburn` là **phí gas tối đa USDC** của từng review mới, tính từ `gasLimit × gasPrice / 10^18`; làm tròn lên tới đơn vị USDC token 6 decimals khi dự trù số dư. Không có review từ ví kết nối nên chưa có giá trị số chính xác cho các G này; không được thay bằng phí lịch sử.

- Swap USDC→EURC đã đủ allowance: ít nhất **1 + Gswap USDC** trên Arc.
- Swap chưa đủ allowance: ít nhất **1 + Gapproval + Gswap USDC** trên Arc.
- Swap EURC→USDC: ít nhất **1 EURC** và **Gswap USDC**, thêm **Gapproval** nếu cần Approve.
- Bridge: ít nhất **1 + Gburn USDC**, thêm **Gapproval** nếu cần. Quote hiện tại dùng 1 USDC là gross/totalDebit, phí Circle nằm trong số này; receive floor là `1 − maxFee` và phải dương. Nếu quote không hợp lệ hoặc gas/fee/balance không đủ thì dừng, không đổi dữ liệu để ép chạy.
- Kiểm tra cả số dư token và native gas qua dữ liệu mới của ví; không dùng balance demo. Số dư đủ phải được xác nhận lại ngay trước từng yêu cầu ví.

## Các bước thủ công và bằng chứng

1. Chủ dự án đăng nhập Preview hợp lệ. Xác định deployment thuộc đúng SHA đã QA; kết nối ví testnet do người dùng kiểm soát và xác minh account/chain.
2. Flow A: chọn USDC→EURC, nhập 1, lấy quote/simulation/policy mới. Nếu allowance đủ, không có Approve; dừng trước **Confirm swap in wallet** cho tới khi có cho phép live QA cụ thể.
3. Flow B: dùng một ví/asset có allowance thực tế chưa đủ; không tự tạo transaction revoke để dựng tình huống. Review phải là finite approval đúng token/spender/số tiền. Chủ ví tự xác nhận **Approve**, ghi hash và receipt thành công; ứng dụng chỉ tự chuẩn bị fresh Swap review. Chủ ví tự xác nhận **Swap** riêng.
4. Bridge: Arc→Base Sepolia, 1 USDC, kiểm tra gross amount/maxFee/receive floor/tốc độ/gas ceiling từ quote mới. Chủ ví tự Approve nếu cần, rồi tự xác nhận **CCTP burn** riêng. Không dùng hash Approve làm hash burn.
5. Sau mỗi yêu cầu thực tế, lưu hash ngay; kiểm tra trên `https://testnet.arcscan.app/tx/<hash>`. Approval cần receipt/allowance; Swap cần receipt thành công, đúng binding và matching output transfer.
6. Bridge giữ trạng thái pending qua source receipt/MessageSent, Circle attestation/forwarding. Chỉ hoàn tất sau Base receipt thành công và USDC Transfer đúng recipient, đạt receive floor; đối chiếu `https://sepolia.basescan.org/tx/<destinationHash>`.
7. Refresh ở các ranh giới pending/unknown; không xác nhận/gửi lại vì refresh. Nếu không nhận được hash thì giữ UNKNOWN và đối chiếu ví/explorer. Nếu storage lỗi, sao lưu hash trước khi rời trang.
8. Chỉ bấm Done khi có bằng chứng hoàn tất; kiểm tra Activity vẫn còn sau reload.

Không có bước nào trên được agent ký hoặc broadcast trong vòng QA này. Live QA chỉ được bắt đầu sau một sự cho phép riêng, cụ thể về account, mạng, amount và hành động; chủ ví giữ quyền xác nhận cuối cùng.
