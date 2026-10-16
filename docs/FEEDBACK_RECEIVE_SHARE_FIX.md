# Feedback and Receive Share — 2026-10-16

## Production audit

The change starts from production `c1fb2fdf0123f6a3abdfce5ebe4e08349bbb701a`
on `fix/feedback-receive-share-2026-10-16`. The tracked worktree was clean;
existing untracked QA artifacts were preserved. PR #8's branch is untouched.

`App.tsx` had a `FeedbackModal`, and `Settings.tsx` had a separate composer.
Both wrote `mk.feedback` in localStorage without any delivery to the team.
`ReceiveModal` called `navigator.share({text: full})` from the main Share button,
or copied only the address if the API was absent. Native errors were swallowed.

The original Google Form URL was found independently in both historical entries:

- [AppHeader, 0d75297, line 115](https://github.com/congthuat/Makoto-Wallet/blob/0d75297d2f43fe91fce9ffb921042a07d0acb8e4/frontend/components/AppHeader.tsx#L115)
- [SettingsPage, 33a9e11, line 67](https://github.com/congthuat/Makoto-Wallet/blob/33a9e1142e47a50ae84555aca2d2fbb545f27ffe/frontend/components/SettingsPage.tsx#L67)
- The retained reference test `brain-donor-reference/frontend/tests/agentCenteredDashboard.test.ts:123` also asserts the exact same URL.

Verified historical URL:
`https://docs.google.com/forms/d/e/1FAIpQLSfH_cQv0Gkxy604YcpVHpitSfoWbF5_ud3f5WG_Jc4d7A6nVg/viewform`.
It was not invented or replaced. A read-only HTTP request received a Google
Forms HTTP 401 sign-in/cookie page. The owner must confirm responder access and
the destination for responses using their account; no form response was submitted
during QA. This is not `FORM_URL_MISSING` and is not proof that a response was delivered.

## Resulting behavior

Both Feedback entries render the same `FeedbackLink` backed by `FEEDBACK_FORM_URL`.
It is a direct keyboard-accessible anchor with `_blank` and `noopener noreferrer`,
including a localized new-tab label. It leaves the current page and its state intact.
The mobile drawer closes normally. Local composers and their save/success messages
are removed. Existing `mk.feedback` data is never read, rewritten, deleted, or sent.
The relevant privacy copy now describes the external form and retained old notes.

Receive Share stays within the existing Receive modal as an internal choice panel:

- Copy address: only the validated current public address.
- Copy receive details: selected asset, address, Arc Testnet, and chain ID 5042002.
- X (Twitter), Telegram, WhatsApp: encoded direct compose/share links.
- Download QR: locally generated SVG with a quiet zone, current-address check,
  and a filename containing the asset, Arc Testnet, and address.
- More options: the native share API, only when supported and explicitly selected.

There are no automatic posts, messages, external QR services, or programmatic popup
windows. Social choices remain normal visible links, so the user can open them
directly or through the browser's link menu even when popup scripts are blocked.
Clipboard success is reported only after its promise resolves; rejection and missing
support report failure. Native cancellation reports no false success, and other
native failures leave the alternative choices available. Late clipboard results
from a previous wallet/token/view are not reported as current success.

Sharing and QR generation require live watch/connected mode, a valid nonzero address,
and an allowlisted receive asset. Demo, empty, truncated, invalid, and zero addresses
cannot be shared. A wallet/token change updates the current choice panel and QR.
Receive destination remains Arc Testnet regardless of the connected provider's
currently selected network. Connection, Send, Swap, Bridge and transaction code
remain unchanged.

The panel uses existing surfaces, typography and theme classes, with EN/VI copy,
visible focus, large controls, narrow-screen wrapping, and existing modal scrolling.
Tab/Shift+Tab stays inside Receive. The first Escape from any share-stage control
returns to Receive and restores Share focus; another Escape closes Receive and
returns focus to its desktop/mobile trigger. Share view changes reset the scroll
position so the modal header remains visible.

## Regression and evidence

`test:sharing` runs real Shell/Sidebar/Settings/Receive components in an isolated
Chrome browser. Wallet state, clipboard, native sharing, downloads and external
navigation are controlled test boundaries. The application provider, real wallets,
Google Forms submission and social services are never called by these tests.

The same selected assertions run against production source through read-only
`git show` failed 8/8 for the original defects: missing external Feedback anchors
and direct native sharing. The corrected source passes 12/12 new tests covering:

- EN/VI at desktop 1440 and mobile 390 widths, both Feedback entries and old notes.
- Internal Share without a native call, exact copies, decoded social URL parameters.
- Actual downloaded SVG modules matched to an independently rendered expected
  QR for the current address, quiet zone and current asset/address filename.
- Unsupported/rejected clipboard, unsupported/cancelled/failed native sharing.
- Invalid/disconnected/demo/zero addresses, changed wallets, token changes,
  stale pending copy completion, focus, two-stage Escape, and preserved navigation.

The new command is included in the existing frontend GitHub Actions job. Local
screenshots additionally inspect the actual styled app at 375x812, in light/dark
themes, with a public deterministic watch address in an isolated browser.

Local Node 24.16.0 verification completed with all 14 frontend commands passing:
545/545 tests (the existing 533 plus 12 new browser regressions), TypeScript,
ESLint and client/SSR build. The backend passed 116/116. Diff check is clean.
The 12 pre-existing lint warnings and existing Vite import/chunk warnings remain;
this correction does not claim a warning-free build or dependency audit.
Source fingerprints before/after the full validation match.

Detailed command logs, screenshots, source fingerprints, URL provenance, negative
controls, final test manifests, and subsequent CI/Preview results are retained in
`validation-qa/feedback-receive-share/`. Evaluate checks on the new PR's exact head.
The owner still needs to confirm the form's access/response settings. No merge,
production branch push, production deployment, or blockchain transaction is part
of this correction.
