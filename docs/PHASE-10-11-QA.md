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
# Phase 10.3 — Universal Bridge owner QA

Use only small testnet amounts accepted by the live Circle estimate. No CLI or private key is required.

## A. Base Sepolia → Arc Testnet

1. Connect a Reown wallet holding Base Sepolia USDC and ETH.
2. Open Swap & Bridge → Bridge USDC. Choose Base Sepolia, enter `0.10` USDC, keep Same connected wallet and Standard, then select Review Bridge.
3. Confirm the wallet network switch if requested. Expect a live itemized estimate, Base source gas in ETH, Forwarding Service enabled, and no Makoto custom fee.
4. Continue to wallet. Confirm approval only if requested, then burn. Expect the event-driven Approval/Burn/Attestation/Mint timeline and Completed only after Circle returns destination completion.
5. Verify the real source link on BaseScan. Verify an ArcScan destination link only when Circle returns a destination hash; otherwise expect “Destination confirmed by Circle Forwarding Service.” The Arc USDC balance should increase by the minted amount after Circle fees.

## B. Arc Testnet → Base Sepolia

Repeat A with Arc Testnet as source and a small Arc USDC balance. Expect Arc source gas to display as USDC. Standard is supported; Fast is disabled because Circle currently does not support Arc Testnet as a Fast source. Verify the real source transaction on ArcScan and destination evidence on BaseScan or through Circle Forwarding Service confirmation.

## C. Standard and Fast estimate

On Base Sepolia source, compare Standard and Fast reviews. Fast must show Circle's returned CCTP protocol fee; Standard must not invent one. Changing speed must discard the previous review and fetch a new estimate.

## D. Reject a wallet request

Reject the network switch, approval, or bridge request. Expect a cancellation message, no Completed state, no confirmed bridge activity, and an enabled retry path.

## E. Wrong network and account mutation

Begin with the wallet on the destination network. Review must request the source network and verify `eth_chainId`. Change accounts after review; Continue must block because the active provider account no longer matches the reviewed Makoto account.

## F. Destination completion

After burn confirmation, leave the browser open. Completed must appear only after the App Kit bridge call returns success. A destination explorer link must appear only for a real returned mint hash.
