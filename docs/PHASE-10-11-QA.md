# Phase 10.1 + 10.2 live QA

Use testnet assets only. Connect the same Reown wallet throughout each case.

## A. Read

Open `/unified-balance`, connect, and refresh. Confirm available, pending, and per-chain USDC values match Circle Gateway and no placeholder balance appears.

## B. Arc deposit

Select Arc Testnet, enter a positive USDC amount, review, approve any wallet-requested authorization, and confirm the deposit. Verify the real transaction hash in ArcScan and refresh after Gateway indexing.

## C. Base Sepolia deposit

Select Base Sepolia and repeat the deposit. Confirm Makoto requests the network through the active connector and never uses a different injected account. Verify the hash in BaseScan.

## D. Spend on Arc

Enter a valid Arc recipient and amount, request an estimate, inspect every returned fee, then confirm. Verify the returned transaction result and Arc explorer link.

## E. Rejections and stale state

Reject approval, deposit, and spend prompts in turn. Confirm each reports cancellation and permits retry. Change account or network during review and confirm the operation stops or the wallet requests the required network.

## F. Responsive and localized UI

Repeat at 390 px and desktop widths in English and Vietnamese. Confirm controls remain reachable, hashes/addresses wrap, and pending/success/error states are legible.
