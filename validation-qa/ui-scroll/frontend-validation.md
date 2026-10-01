# Frontend validation — Settings and scroll cleanup

Commands ran from `frontend` with `npm.cmd`; raw logs are in this directory.

| Script | Exit | Tests | Pass | Fail | Skip | Cancel |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| test:brain | 0 | 17 | 17 | 0 | 0 | 0 |
| test:agent | 0 | 11 | 11 | 0 | 0 | 0 |
| test:tasks | 0 | 10 | 10 | 0 | 0 | 0 |
| test:portfolio | 0 | 17 | 17 | 0 | 0 | 0 |
| test:migration | 0 | 82 | 82 | 0 | 0 | 0 |
| test:ui | 0 | 17 | 17 | 0 | 0 | 0 |
| **Total** | **0** | **154** | **154** | **0** | **0** | **0** |

`type-check`, `lint`, and both client/SSR `build` steps exited 0. UI, type-check, lint and build ran after the final missing Source VI localization was added. Other test suites ran after the main Settings/App/i18n edits; Source is an isolated UI translation and is covered by the final UI suite.

Lint reported 0 errors and 12 existing warnings outside the changed production files:

- ShareCard.tsx:44 — 1 `@typescript-eslint/no-unused-expressions` warning.
- badge.tsx:36, button.tsx:57, form.tsx:168, navigation-menu.tsx:119, toggle.tsx:43, wallet/shared.tsx:12 and :31, wallet/ui.tsx:5, store.tsx:51, Insights.tsx:16 and :22 — 11 `react-refresh/only-export-components` warnings.

Build warning categories:

- Dashboard.tsx is imported statically and dynamically, so dynamic import does not create another chunk.
- Insights.tsx is imported statically and dynamically, so dynamic import does not create another chunk.
- The minified next chunk is 551.24 kB, above the default 500 kB warning threshold.

The migration log includes two expected mock wallet rejection error records for rejection tests; all 82 tests passed. PowerShell records Vite's stderr warning as a NativeCommandError wrapper in build.log; npm/build exit is 0 and both bundles completed.

No backend suite was run because no backend changes were made. No production source was edited by this validation task.
