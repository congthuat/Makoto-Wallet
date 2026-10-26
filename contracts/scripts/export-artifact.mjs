// Copies the compiled ABI and bytecode into the frontend (run after `forge build`).
import fs from 'node:fs'
const art = JSON.parse(fs.readFileSync(new URL('../out/MakotoPayRequests.sol/MakotoPayRequests.json', import.meta.url)))
const header = '/* Generated from contracts/src/MakotoPayRequests.sol (solc 0.8.24, evm paris, optimizer 200).\n * Regenerate: cd contracts && forge build && node scripts/export-artifact.mjs */\n'
const body = `export const MAKOTO_PAY_REQUESTS_ABI = ${JSON.stringify(art.abi, null, 2)} as const\n\nexport const MAKOTO_PAY_REQUESTS_BYTECODE = '${art.bytecode.object}' as const\n`
fs.writeFileSync(new URL('../../frontend/src/contracts/makotoPayRequests.ts', import.meta.url), header + body)
console.log('exported', art.abi.length, 'ABI entries')
