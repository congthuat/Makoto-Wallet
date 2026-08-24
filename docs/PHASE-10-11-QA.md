# Phase 10–11 manual QA

## Phase 10.0 — Arc Transaction Engine V2

- Prerequisites: connected wallet on Arc Testnet. Action: send a small real USDC transfer. Expected: Preparing → signature → Submitted/Pending → Final, with fee in USDC and an ArcScan link. Failure: reject signature and confirm no transaction is resubmitted. Mobile: repeat at 375 px.

## Phase 10.1 — Circle App Kit

- Prerequisites: configured App Kit adapter. Action: inspect capabilities. Expected: only adapter-supported actions are enabled. Failure: remove configuration; actions say configuration required. Mobile: no dead or overflowing controls.

## Phase 10.2 — Unified Balance

- Prerequisites: Circle Gateway configuration and a real deposit. Action: load balance breakdown. Expected: provider-reported available, pending, total, and source chains. Failure: disconnect provider; no wallet-balance summation is shown as unified balance. Mobile: breakdown is readable at 390 px.

## Phase 10.3 — Universal Bridge

- Prerequisites: supported CCTP/App Kit route. Action: bridge test USDC. Expected: source hash, message state, destination state, and completion only after destination execution. Failure: unsupported route stays disabled. Mobile: status timeline fits at 430 px.

## Phase 10.4 — Smart Swap Router

- Prerequisites: XyloNet and, if configured, App Kit quotes. Action: request USDC/EURC quote. Expected: current real routes are compared and provider is named. Failure: wait for expiry; signing is blocked. Mobile: review has no horizontal overflow.

## Phase 10.5 — Activity / Indexer

- Prerequisites: wallet with known transactions. Action: reload on a clean browser. Expected: indexed/direct-chain records appear and duplicate optimistic entries merge into verified records. Failure: disable indexer; existing direct-chain/receipt fallback remains truthful. Mobile: filters remain keyboard/touch usable.

## Phase 10.6 — Batch Pay

- Prerequisites: verified official Multicall3From configuration and enough USDC. Action: enter two unique recipients and review. Expected: exact total, fee, contract, and one signature. Failure: duplicate/zero/invalid/over-balance rows block review. Until address verification, expected state is configuration required. Mobile: rows remain editable at 375 px.

## Phase 11.0 — Smart Wallet

- Prerequisites: configured Arc-compatible ERC-4337 provider. Action: query capabilities and submit a test operation only if available. Expected: provider-derived account and operation status. Failure: without provider, creation is unavailable/configuration required; gasless is never shown. Mobile: normal wallet connection remains available at 768 px and below.
