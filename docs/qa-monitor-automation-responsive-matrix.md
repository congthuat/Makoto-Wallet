# Monitor and automation responsive QA

Date: 2026-09-30. EN viewports: 1440×900, 1280×900, 390×900. VI viewports: 1440×900, 1280×800, 390×844. Account: watch-only `0x1111111111111111111111111111111111111111` on Arc Testnet. The seeded active USDC monitor and its alert were used throughout. No task was created, edited, paused, run, or deleted; no wallet transaction was attempted.

Each ✓ records an actual check of that surface in the stated combination. EN review used the Agent task review; VI review used the Tasks composer review. Browser sessions were isolated.

| Width | Language | Theme | Home | Monitor | Automate | Task review | Tasks and controls | Notifications | Edit modal |
|---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1440 | EN | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1440 | EN | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1280 | EN | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1280 | EN | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 390 | EN | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 390 | EN | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1440 | VI | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1440 | VI | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1280 | VI | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 1280 | VI | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 390 | VI | Light | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| 390 | VI | Dark | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

Result: **84/84 surface checks passed**. All 12 cells measured **0 px document overflow**, showed one seeded task card and one task alert in the notification popover, and exposed enabled Pause, Run now, Edit, and Delete controls. The review create action became available after its asynchronous parse. No surface remained loading. Browser page errors were empty; console had no error messages. The review was inspected only; its create action was never used.

The Tasks inactive Automation tab had near-white text on a pale background in light mode before the style fix, visible in [before screenshot](qa-responsive-mobile-vi-light-tasks.png). After the fix it measured `rgb(74, 74, 87)` at all three light widths in both languages; [after screenshot](qa-responsive-mobile-vi-light-controls.png). Dark mode measured `rgb(163, 163, 173)` at all three widths in both languages. A further 390px EN/light browser recheck after the hover-state adjustment kept the dark text at `rgb(74, 74, 87)` when hovered, with opacity `0.8`.

The Home balance card displayed a pricing-unavailable alert in the six VI checks. It did not block the monitor and automation surfaces. The seeded task data, controls, notification, and review loaded normally.

Detailed VI measurements, including per-surface overflow, counts, loading state, and diagnostics: [VI matrix JSON](qa-responsive-vi-matrix.json). Representative mobile states: [Tasks dark](qa-responsive-390-VI-dark-tasks.png), [notifications after animation](qa-responsive-390-VI-dark-notifications-stable.png), [edit modal](qa-responsive-390-VI-dark-edit.png). EN measurements were reported by the parallel EN browser QA session.
