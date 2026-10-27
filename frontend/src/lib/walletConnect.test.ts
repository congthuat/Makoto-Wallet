import test from 'node:test'
import assert from 'node:assert/strict'
import { WC_WALLETS, wcNativeLink } from './walletConnect.ts'

const uri = 'wc:abc123@2?relay-protocol=irn&symKey=xyz'
const enc = encodeURIComponent(uri)

test('WalletConnect deep links target each specific app (AppKit native format)', () => {
  const links = Object.fromEntries(WC_WALLETS.map((wallet) => [wallet.native, wcNativeLink(wallet.native, uri)]))
  assert.equal(links['okex://main'], `okex://main/wc?uri=${enc}`)
  assert.equal(links['okxwallet://main'], `okxwallet://main/wc?uri=${enc}`)
  assert.equal(links['bnc://app.binance.com/cedefi/'], `bnc://app.binance.com/cedefi/wc?uri=${enc}`)
  assert.equal(links['metamask://'], `metamask://wc?uri=${enc}`)
  assert.equal(links['trust://'], `trust://wc?uri=${enc}`)
  assert.equal(links['bitkeep://'], `bitkeep://wc?uri=${enc}`)
  for (const link of Object.values(links)) assert.doesNotMatch(link, /^wc:/, 'never hand the pairing to the system default wallet')
})
