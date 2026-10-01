# Receive navigation browser verification

Final run: 12/12 passed at http://localhost:5173, using installed Playwright with headless Chrome.

Matrix: 1440, 1280 and 390 CSS pixels; Vietnamese and English; dark and light. Each case uses only watch address `0x16299b74c616994eaecb9b20e37d369d5d62586b`, with no injected wallet provider.

Verified in the actual browser:

- Desktop sidebar and mobile drawer order is Send, Receive, Swap, Bridge, Faucet.
- Receive has a visible keyboard focus ring and Enter opens the existing Receive dialog. The mobile drawer closes on selection.
- The Receive button reports `aria-pressed=true` while the modal is open. Faucet does not report an active route until the modal closes; the underlying Faucet page and document title remain intact.
- Closing the modal restores the underlying active route. Home's Receive quick action renders the same dialog content. Mobile More actions retains Receive and the existing five bottom tabs.
- Watch address, 188px QR, Arc Testnet warning/Chain ID 5042002, USDC/EURC/cirBTC controls and enabled copy-address control are present.
- No horizontal overflow in the main page or Receive modal at any tested width. Watch mode, address, locale and theme persist.
- Faucet remains the separate Testnet faucet route. No external faucet control was activated.

Results: 0 console errors, 0 page errors, 0 API writes, 0 external navigations. No wallet connection, signatures, signing requests or blockchain writes were performed. Clipboard and share actions were deliberately not invoked; this verification checks their existing controls and enabled state.

Evidence: `receive-browser-results.json`, `receive-browser-qa.cjs`, and 24 `receive-*-navigation.png` / `receive-*-modal.png` screenshots. Representative images are `receive-1280-en-dark-navigation.png` and `receive-390-vi-light-modal.png`.

The runner waits for the current route to settle before keyboard activation. Underlying headings are checked with `includeHidden` because the existing accessible modal hides background content; token names account for their visible icon glyph. These are harness accommodations, not product changes.

No production files or services were changed during this independent verification. It does not repeat the long-scroll checks owned by the root agent.
