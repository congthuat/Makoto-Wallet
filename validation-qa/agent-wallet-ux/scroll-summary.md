# Live scroll verification

24 of 24 cases passed on the normal localhost:5173 app with its real API.

Matrix: Home, Agent and Settings × 1440/390 × VI/EN × dark/light. All cases used the existing public-address watch mode for `0x16299b74c616994eaecb9b20e37d369d5d62586b`. Agent content was made scrollable by six ordinary read-only portfolio questions. No provider mocks, request interception, signatures or blockchain writes were used.

Every case held Y=650 throughout the observation. The shortest measured interval was 16,253 ms. All cases kept the same mounted main element, active focus and URL; there were no programmatic scroll/focus calls, horizontal overflow or console/page errors. Every case observed at least one unchanged Arc network polling request.

Evidence: `scroll-results.json`, `scroll-qa.log` and 48 before/after screenshots. The script is `scroll-qa.cjs`. Desktop VI dark Agent and mobile VI light Agent screenshots were visually inspected: the original Vietnamese question and generated Vietnamese answer were both readable, and amounts matched the live wallet snapshot.

Instrumentation note: the initial run's optional `walletPolls` counter matched a path segment rather than the wallet endpoint's query URL, so its zero values do not establish wallet polling inactivity. The independently recorded response arrays include five wallet read responses during observation. The required network polling counter matched the actual endpoint correctly in all 24 cases. The script's wallet-counter expression has since been corrected for future runs; no runtime code changed.

## Final Agent presentation recheck

After the remaining locale presentation fix in Agent and completion of the final type-check, the eight affected Agent combinations were rerun with `scroll-qa.cjs --agent-only`. All eight passed. The minimum measured observation was 16,267 ms; every case held Y=650, observed two network polls and one wallet poll, and had no scroll/focus calls, remounts, URL/focus changes, overflow or console/page errors. The original 24-case evidence is preserved; the final run uses `final-agent-scroll.json`, `final-agent-scroll.log` and 16 `final-agent-scroll-…` screenshots.

The separate live `agent-task-locale.test.mjs` regression passed two tests. It verified task reply/link localization and retained clarification, action proposal and structured strategy row localization across VI → EN → VI. All original Vietnamese user requests stayed unchanged. The planning test recorded zero non-GET requests; neither test requested a wallet signature or executed a transaction. Its final log is `final-test-agent-locale.log`.
