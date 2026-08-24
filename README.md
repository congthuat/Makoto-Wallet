# Makoto Wallet

> Arc-native Phase 10–11 engine status: Arc lifecycle/fee/review utilities, provider-neutral Circle Gateway/App Kit capability detection, bridge state validation, smart swap routing, activity merging, Batch Pay validation/call planning, and an optional smart-wallet interface are implemented and tested. Existing Send, Receive, XyloNet swap, CCTP V2, Arc Memo, and Makoto Vault remain the live transaction paths. Circle App Kit/Gateway actions require real provider configuration; Batch Pay execution requires a verified official Arc `Multicall3From` address; ERC-4337 remains experimental/configuration-required. No simulated balances, quotes, bridge completion, sponsorship, or smart accounts are shown.

Architecture and operational boundaries are documented in [docs/ARC-NATIVE-ARCHITECTURE.md](docs/ARC-NATIVE-ARCHITECTURE.md). Manual validation steps are in [docs/PHASE-10-11-QA.md](docs/PHASE-10-11-QA.md).

<p align="center">
  <img src="frontend/public/makoto/logo-pro-v2.png" alt="Makoto Wallet" width="96" />
</p>

<p align="center">
  <strong>A non-custodial wallet experience built for Arc Testnet.</strong>
</p>

Makoto Wallet focuses on everyday stablecoin use. Connect a wallet to manage supported assets, send and receive funds, swap stablecoins, create protected savings goals through Makoto Vault, explore Makoto Pay, review wallet security, and inspect real activity and transaction receipts.

## Live Demo

- **Main application:** [makoto-wallet.vercel.app](https://makoto-wallet.vercel.app)
- **Makoto Vault:** [makoto-wallet.vercel.app/savings](https://makoto-wallet.vercel.app/savings)
- **Network:** Arc Testnet — Chain ID `5042002`
- **Release status:** Public Beta / Testnet

## Dashboard

The Dashboard combines the connected wallet's real USDC balance with locally observed balance history, `1D` / `1W` / `1M` / `1Y` / `All` time ranges, Send / Receive / Swap wallet actions, Wallet Status, supported assets, Makoto Vault, Makoto Tools, and recent Activity.

Balance history is built from real locally observed wallet-balance snapshots. It is scoped to the connected wallet and chain; it is not simulated, randomly generated, or presented as a full market portfolio chart.

![Makoto Wallet Dashboard](docs/screenshots/makoto-dashboard.png)

## Core Features

### Asset management

- Real connected-wallet USDC and EURC balances
- Verified token contract metadata and ArcScan links
- Send and Receive for supported assets
- Real XyloNet USDC ↔ EURC swaps with wallet-signed approval and execution
- Arc Testnet network detection and switching
- Transaction safety review and confirmed-receipt checks

No fabricated token prices or fiat portfolio values are displayed.

### Makoto Tools

- **Makoto Vault:** goal-based protected savings backed by real on-chain state
- **Makoto Pay:** consumer payment and service concepts built around USDC
- **Security Center:** wallet, network, recovery, privacy, and application-lock information

Send, Receive, and Swap are wallet actions—not applications or service modules.

## Makoto Vault

Makoto Vault provides goal-based protected USDC savings. Users can create a Savings Goal, add deposits or contributions, inspect Total goals / Active goals / Completed goals, configure Guardian and Recovery protection where supported, and withdraw according to the goal's on-chain unlock conditions.

The user-facing product is **Makoto Vault**. Its underlying smart-contract implementation retains the internal name **PenguJar V3**.

![Makoto Vault savings goals](docs/screenshots/makoto-vault.png)

## Makoto Pay

Makoto Pay explores consumer payment experiences built around USDC on Arc. **Mobile Top-up is an available product demo.** Other catalog entries are explicitly marked **Coming Soon** and are product concepts, not live service-provider integrations.

The Mobile Top-up demo does not transfer USDC, deliver real mobile credit, or claim a telecom-provider integration.

![Makoto Pay service catalog](docs/screenshots/makoto-pay.png)

## Security Center

The Security Center presents deterministic wallet and network state, connected wallet/provider information, Arc Testnet verification, Makoto App Lock, Guardian / Recovery protection, receipt verification context, and privacy/security disclosures.

Makoto does not assign a numeric security score or guarantee wallet security. Makoto App Lock restricts access to the application interface in the current browser; it does not encrypt or control a wallet private key and does not replace wallet-provider security.

![Makoto Wallet Security Center](docs/screenshots/makoto-security.png)

## Activity & Receipts

Activity provides wallet-scoped and Arc Testnet-scoped history for supported operations, including Send, Swap, Makoto Vault transactions, and Bridge where supported. Entries are persisted locally where appropriate, deduplicated, sorted newest-first, and linked to their transaction hashes on ArcScan.

Verified receipts read real transaction receipt and log data. Makoto does not claim arbitrary or complete blockchain indexing, and it does not display fabricated or reconstructed transactions.

![Makoto Wallet Activity](docs/screenshots/makoto-activity.png)

## Language, Appearance, and Layout

- English and Vietnamese
- Dark Mode and Light Mode
- Responsive desktop, tablet, and mobile layouts
- Manrope interface typography

## Technical Overview

Makoto Wallet is a client-side dApp. The connected wallet controls signing credentials and reviews every blockchain write; Makoto does not store private keys.

### Frontend

- Next.js 16.3
- React 19
- TypeScript
- wagmi 3 and viem 2
- Reown AppKit
- TanStack Query 5
- Deployed on Vercel

### Smart contracts

- Solidity and Hardhat
- OpenZeppelin contracts
- PenguJar V3 for the Makoto Vault implementation

### Local application data

Contacts, recent recipients, optimistic Activity, and observed balance snapshots are stored client-side and scoped where applicable by wallet and chain. Private Makoto Vault metadata uses its existing wallet-signature-derived client-side encryption flow.

## Arc Testnet & Contracts

| Item | Value |
| --- | --- |
| Network | Arc Testnet |
| Chain ID | `5042002` |
| RPC | `https://rpc.testnet.arc.network` |
| Explorer | [testnet.arcscan.app](https://testnet.arcscan.app) |
| Gas token | USDC |
| Arc Testnet USDC | `0x3600000000000000000000000000000000000000` |
| Arc Testnet EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` |
| PenguJar V3 | [`0x2d2C...226a`](https://testnet.arcscan.app/address/0x2d2C30ACe5d1f057C6eC2e2E8219A43355Dd226a#code) |
| V3 deployment block | `56927475` |
| USDC / EURC decimals | `6` |

## Running Locally

Requirements: Node.js 20 or later and npm.

```bash
git clone https://github.com/congthuat/Makoto-Wallet.git
cd Makoto-Wallet
npm ci

cd frontend
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`. On Windows PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

Public frontend configuration may be supplied through the documented `NEXT_PUBLIC_*` variables. Never place a private key or other wallet signing secret in frontend, GitHub, or Vercel environment variables.

## Testing

Run contract validation from the repository root:

```bash
npm ci
npm run compile
npm test
```

Run frontend validation from `frontend/`:

```bash
npm ci
npm test
npm run typecheck
npm run lint
npm run build
```

Latest confirmed release validation:

- Frontend tests: **302/302 PASS**
- Contract tests: **19/19 PASS**
- Typecheck: **PASS**
- Lint: **PASS**
- Production build: **PASS**

These are project validation results, not evidence of an independent professional security audit.

## Security & Public Beta Notice

- Makoto Wallet is non-custodial and does not store a user's private key.
- The connected wallet reviews and signs blockchain transactions.
- The application is deployed on Arc Testnet for testing and demonstration.
- Testnet assets have no intended real-world monetary value.
- Makoto Wallet and PenguJar V3 have not undergone an independent professional security audit.
- This software is not represented as mainnet-ready financial software.

Security issues should not include private keys, seed phrases, or other wallet secrets in public reports.

## Deployment

- **Application:** [makoto-wallet.vercel.app](https://makoto-wallet.vercel.app)
- **Vercel root directory:** `frontend`
- **Repository:** [congthuat/Makoto-Wallet](https://github.com/congthuat/Makoto-Wallet)
- **Production branch:** `makoto-wallet`

## License

This project is available under the [MIT License](LICENSE).
