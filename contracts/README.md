# MakotoPayRequests

Payment requests and bill splitting on Arc Testnet.

- **Non-custodial:** each payment goes straight from payer to payee (`transferFrom(payer → payee)`); the contract never holds tokens.
- **No owner, no admin, no upgrade, no fees.** Only USDC and EURC (fixed at deployment) are accepted.
- **Invoice** (`maxPayments = 1`, optionally only one `allowedPayer`) or **split bill** (`maxPayments = N`, each address pays one share once).
- Payee can `cancel`; optional expiry; memo ≤ 140 bytes.

```sh
forge install foundry-rs/forge-std --no-git   # once
forge test                                     # 11 tests incl. fuzzing
forge build && node scripts/export-artifact.mjs  # refresh frontend/src/contracts/makotoPayRequests.ts
```

Note: Arc's native USDC calls an Arc-only precompile (blocklist check), so a local fork
cannot simulate USDC transfers; the EURC path was verified on an Arc Testnet fork.
Deployment is done from the owner's wallet in the app (Payment requests → Deploy contract).
