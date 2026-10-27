import test from 'node:test'
import assert from 'node:assert/strict'
import { walletAppLinks } from './walletAppLinks.ts'

test('wallet app links open the exact current page inside each wallet browser', () => {
  const url = 'https://makotowallet.xyz/#pay-2'
  const links = Object.fromEntries(walletAppLinks(url).map((link) => [link.kind, link.href]))
  assert.equal(links.okx, `https://www.okx.com/download?deeplink=${encodeURIComponent(`okx://wallet/dapp/url?dappUrl=${encodeURIComponent(url)}`)}`)
  assert.equal(links.metamask, 'https://metamask.app.link/dapp/makotowallet.xyz/#pay-2')
  assert.equal(links.trust, `https://link.trustwallet.com/open_url?coin_id=60&url=${encodeURIComponent(url)}`)
  assert.equal(links.coinbase, `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`)
  for (const href of Object.values(links)) assert.match(href, /^https:\/\//, 'only https universal links')
})
