# Makoto Wallet — Agent wallet on Arc Testnet

## Structure
- `frontend/` — Vite + React 19 + Tailwind 4 (UI, 5 languages, light/dark, PWA)
- `backend/`  — Express API (routes in `backend/routes`, mounted at `/api/<name>`)

## Local development (Node 24+)

Install dependencies once with `npm install --prefix backend` and `npm install --prefix frontend`, and copy each folder's `.env.example` to `.env` with the required local values. Then run the whole stack from the project root:

```bash
cd C:/Users/Admin/Downloads/Makotowallet.xyz/makoto-wallet
npm run dev
```

Open http://localhost:5173. The runner shows prefixed frontend/backend logs and checks http://localhost:3001/api/health. **Ctrl+C stops both services.** Ports 5173 and 3001 are required; if one is already in use, the runner reports it and exits instead of moving to another port. The root runner keeps direct ownership of the backend process so an exit is visible. For backend file watching, run `npm run dev` from `backend/` separately.

## Build
```bash
cd frontend && npm run build
```

## Makoto brain transplant

This build preserves the canonical `makoto-wallet.zip` product and adds a framework-neutral Makoto brain compatibility layer. See `BRAIN_TRANSPLANT.md` and `BRAIN_TRANSPLANT_MANIFEST.json` for the exact migration boundary, safety invariants, and donor-source mapping.

Connected Send uses the user's injected wallet for reviewed ERC-20 transfers on Arc Testnet. Demo and watch modes remain previews. See `docs/SEND_RUNTIME_AUDIT.md` for the active wiring, safety checks, validation, and limits.

Activity status truthfulness/localization and the three-asset Arc Testnet Faucet are documented in `docs/ACTIVITY_FAUCET_AUDIT.md`.
