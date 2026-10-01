import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ARC, TOKENS } from './wallet.ts'

test('Arc faucet uses the three canonical token entries and existing icons', () => {
  assert.equal(ARC.name, 'Arc Testnet')
  assert.equal(ARC.faucet, 'https://faucet.circle.com')
  assert.deepEqual(TOKENS.map((token) => [token.sym, token.address.toLowerCase(), token.decimals, token.glyph]), [
    ['USDC', '0x3600000000000000000000000000000000000000', 6, '$'],
    ['EURC', '0x89b50855aa3be2f677cd6303cec089b5f319d72a', 6, '€'],
    ['cirBTC', '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf', 8, '₿'],
  ])
})
