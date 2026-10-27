import test from 'node:test'
import assert from 'node:assert/strict'
import { addressFromPhrase, createRecoveryPhrase, decryptPhrase, encryptPhrase, isValidPhrase, normalizePhrase, passwordProblem } from './embeddedVault.ts'

const KNOWN = 'test test test test test test test test test test test junk'

test('recovery phrases are standard BIP39 (12 or 24 words) and derive the same address as other wallets', () => {
  const twelve = createRecoveryPhrase(12); const twentyFour = createRecoveryPhrase(24)
  assert.equal(twelve.split(' ').length, 12); assert.equal(twentyFour.split(' ').length, 24)
  assert.ok(isValidPhrase(twelve) && isValidPhrase(twentyFour))
  assert.notEqual(createRecoveryPhrase(12), twelve, 'fresh randomness each time')
  // Well-known Hardhat/Foundry phrase → m/44'/60'/0'/0/0 (same path OKX/MetaMask use).
  assert.equal(addressFromPhrase(KNOWN), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  assert.equal(addressFromPhrase(`  ${KNOWN.toUpperCase().replace(/ /g, '   ')} `), '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  assert.equal(isValidPhrase('test test test test test test test test test test test test'), false, 'checksum enforced')
  assert.equal(normalizePhrase(' A  b '), 'a b')
})

test('vault encryption round-trips only with the right password and the same Google account', async () => {
  const vault = await encryptPhrase(KNOWN, 'correct horse 42', 'sub-1', 1000)
  assert.equal(vault.words, 12); assert.ok(!JSON.stringify(vault).includes('junk'), 'ciphertext never contains the phrase')
  assert.equal(await decryptPhrase(vault, 'correct horse 42', 'sub-1'), KNOWN)
  await assert.rejects(decryptPhrase(vault, 'wrong password', 'sub-1'), /Wrong wallet password/)
  await assert.rejects(decryptPhrase(vault, 'correct horse 42', 'sub-2'), /Wrong wallet password/, 'bound to the account')
  const again = await encryptPhrase(KNOWN, 'correct horse 42', 'sub-1', 1000)
  assert.notEqual(again.ciphertext, vault.ciphertext, 'random salt + iv every time')
})

test('weak wallet passwords are refused', () => {
  assert.ok(passwordProblem('short'))
  assert.ok(passwordProblem('aaaaaaaaaa'))
  assert.ok(passwordProblem('12345678'))
  assert.equal(passwordProblem('Makoto-2026!'), null)
})
