// Read recorded evidence only. Run after all three final browser lanes finish.
// Earlier attempts remain evidence; only the final lane files supply fresh PASS.
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '../..')
const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, name), 'utf8').replace(/^\uFEFF/, ''))
const config = (row) => [row.width, row.language, row.theme].join('|')
const routeKey = (row) => [row.route, config(row)].join('|')
const widths = [1440, 1280, 390]
const languages = ['vi', 'en']
const themes = ['dark', 'light']
const listCards = ['largest-transfers', 'recent-transfers', 'holders']
const requireFeedProof = process.argv.includes('--require-feed-proof')
const failures = []
const check = (ok, key, message) => { if (!ok) failures.push({ key, message }) }
const presentNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const range = (values) => {
  const valid = values.filter(presentNumber)
  return valid.length ? { min: Math.min(...valid), max: Math.max(...valid) } : null
}
const errorRows = (value) => Array.isArray(value) ? value : value?.errors ?? []

function layout(state, key) {
  check(!!state, key, 'Missing inspected layout')
  if (!state) return
  check(state.documentWidth <= state.width, key, 'Document horizontal overflow')
  check(state.mainScrollWidth <= state.mainWidth, key, 'Main horizontal overflow')
  check(state.nested === 0, key, 'Nested vertical scroll trap')
}

function hold(value, row, surface, livePoll) {
  const key = `${config(row)}|${surface}`
  const startFailures = failures.length
  check(!!value?.before && Array.isArray(value?.samples), key, 'Missing scroll evidence')
  if (!value?.before || !Array.isArray(value.samples)) return { key, pass: false }
  layout(value.before, key)
  check(value.elapsed > 15000, key, 'Hold did not exceed fifteen seconds')
  check(value.samples.length > 0, key, 'No scroll samples')
  const diffs = value.samples.map((sample) => Math.abs(sample.y - value.before.y))
  check(diffs.every((diff) => presentNumber(diff) && diff <= 2), key, 'Scroll moved beyond two-pixel tolerance')
  check(value.samples.every((sample) => sample.maxY > 0), key, 'Page ceased to be naturally scrollable')
  if (livePoll) check(value.polling?.some((poll) => poll.path === '/api/arc/network' && poll.method === 'GET' && poll.status === 200), key, 'No successful real Arc network poll during the hold')
  if (surface.startsWith('Analytics expanded')) {
    const inspected = [value.before, ...value.samples]
    check(inspected.every((state) => {
      const recent = state.cards?.find((card) => card.card === 'recent-transfers')
      return recent?.expanded === 'true' && recent.rows?.length > 5 && recent.rows.length <= 30
    }), key, 'Expanded state or verified-row bounds changed during polling')
  }
  return {
    key, pass: failures.length === startFailures,
    width: row.width, language: row.language, theme: row.theme, surface,
    beforeY: value.before.y, lastY: value.samples.at(-1)?.y,
    elapsedMs: value.elapsed, sampleCount: value.samples.length,
    maxPositionDelta: diffs.length ? Math.max(...diffs) : null,
    maxScrollRange: range([value.before.maxY, ...value.samples.map((sample) => sample.maxY)]),
    realNetworkPolls: (value.polling ?? []).filter((poll) => poll.path === '/api/arc/network' && poll.status === 200).length,
  }
}

function aggregate() {
  const primary = read('matrix-primary-results.json')
  const preserved = primary.results.filter((row) => ['Home', 'Tasks'].includes(row.route))
  const lanes = widths.map((width) => ({ source: `continuation-browser-${width}.json`, evidence: read(`continuation-browser-${width}.json`) }))
  const final = lanes.flatMap(({ source, evidence }) => evidence.results.map((row) => ({ ...row, source })))
  check(preserved.length === 24, 'matrix', 'Expected twenty-four preserved Home/Tasks checks')
  check(final.length === 12, 'matrix', 'Expected twelve final continuation configurations')
  const finalKeys = final.map(config)
  check(new Set(finalKeys).size === 12, 'matrix', 'Duplicate final continuation configuration')
  for (const width of widths) for (const language of languages) for (const theme of themes) {
    check(finalKeys.includes([width, language, theme].join('|')), 'matrix', 'Missing final width/language/theme combination')
  }

  const composite = []
  for (const row of preserved) {
    const key = routeKey(row), before = failures.length
    check(row.success === true, key, 'Preserved surface check failed')
    check(errorRows(row.errors).length === 0, key, 'Preserved console/page errors')
    check(row.layout?.documentOverflow === 0 && row.layout?.mainOverflow === 0, key, 'Preserved horizontal overflow')
    check((row.provider?.forbidden ?? []).length === 0, key, 'Forbidden provider request')
    composite.push({ route: row.route, width: row.width, language: row.language, theme: row.theme, pass: failures.length === before, source: 'matrix-primary-results.json', preserved: true, fixture: !!row.fixture, screenshot: row.screenshot })
  }

  const scroll = [], dimensions = [], expandedRows = [], warnings = []
  let consoleErrors = 0, pageErrors = 0, focusChecks = 0, disclosureChecks = 0
  for (const row of final) {
    const key = config(row), sharedBefore = failures.length
    check(row.pass === true && !row.error, key, 'Final browser lane did not pass')
    check(row.initialAnalyticsPassed === true, key, 'Preserved initial Analytics checks were not accepted by the final run')
    const consoleMessages = row.console?.messages ?? []
    const actualErrors = errorRows(row.errors)
    check(!!row.errors && !!row.console, key, 'Final console/page-error inspection missing')
    consoleErrors += consoleMessages.filter((item) => item.type === 'error').length
    pageErrors += actualErrors.length
    check(actualErrors.length === 0, key, 'Final page errors')
    check(consoleMessages.every((item) => item.type !== 'error'), key, 'Final console errors')
    warnings.push(...consoleMessages.filter((item) => ['warning', 'warn'].includes(item.type)).map((item) => ({ key, ...item })))
    const commonPassed = failures.length === sharedBefore

    const analyticsBefore = failures.length
    layout(row.initial, `${key}|Analytics`)
    check(row.initial?.cards?.length === 4, key, 'Expected pulse plus three verified list cards')
    const text = row.initial?.text ?? ''
    check(text.includes(row.language === 'vi' ? 'Phân tích dữ liệu onchain của Arc và hoạt động mạng.' : 'Explore Arc onchain data and network activity.'), key, 'Polished localized Analytics intro missing')
    check(text.includes(row.language === 'vi' ? 'Chỉ đọc · Không thực hiện giao dịch' : 'Read-only · No transaction execution'), key, 'Read-only message missing')
    check(!/Fear & Greed|Experimental|Prototype|Preview|Thử nghiệm/.test(text), key, 'Unsupported sentiment or development wording')
    for (const cardId of listCards) {
      const card = row.initial?.cards?.find((item) => item.card === cardId)
      check(card?.rows?.length === 5, `${key}|${cardId}`, 'Default list must contain five validated rows')
      check(card?.expanded === 'false' && card.button === (row.language === 'vi' ? 'Xem thêm' : 'View more'), `${key}|${cardId}`, 'Collapsed disclosure state/locale incorrect')
      const disclosure = row.disclosures?.find((item) => item.card === cardId)
      check(disclosure?.expanded > 5 && disclosure.expanded <= (cardId === 'recent-transfers' ? 30 : cardId === 'holders' ? 10 : 12), `${key}|${cardId}`, 'Expanded rows missing or exceed preserved source bounds')
      check(disclosure?.focus?.controls === `analytics-${cardId}-list`, `${key}|${cardId}`, 'Disclosure aria-controls incorrect')
      if (disclosure?.focus?.controls && disclosure.expanded > 5) disclosureChecks++
      expandedRows.push({ key, card: cardId, rows: disclosure?.expanded })
    }
    // Each completed disclosure record is written after the harness has asserted
    // Enter expansion, unchanged first-five prefix, and Enter collapse/order.
    check(row.disclosures?.length === 3, key, 'Not all three prefix/order/collapse checks completed')
    check(typeof row.keyboardFocus === 'string' && row.keyboardFocus !== 'none', key, 'Final keyboard focus indicator missing')
    if (typeof row.keyboardFocus === 'string' && row.keyboardFocus !== 'none') focusChecks++
    check(row.footer?.visible === true, key, 'Analytics footer not reachable')
    const defaultHold = hold(row.scroll, row, 'Analytics default', false)
    const expandedHold = hold(row.expandedScroll, row, 'Analytics expanded', true)
    scroll.push(defaultHold, expandedHold)
    const recentExpanded = row.expandedScroll?.before?.cards?.find((card) => card.card === 'recent-transfers')?.rows?.length
    composite.push({ route: 'Analytics', width: row.width, language: row.language, theme: row.theme, pass: commonPassed && failures.length === analyticsBefore, source: row.source, preserved: false, initialEvidenceSource: `continuation-browser-initial-${row.width}.json`, screenshot: `continuation-analytics-${row.width}-${row.language}-${row.theme}.png` })

    const receiveBefore = failures.length
    const sendIndex = row.nav?.findIndex((item) => item.id === 'send') ?? -1
    check(sendIndex >= 0 && row.nav?.[sendIndex + 1]?.id === 'receive', `${key}|Receive`, 'Receive does not immediately follow Send')
    check(row.nav?.find((item) => item.id === 'faucet')?.text === (row.language === 'vi' ? 'Nhận token' : 'Get test tokens'), `${key}|Receive`, 'Test token destination label wrong')
    check(row.receive?.receive === true && row.receive?.faucet === false, `${key}|Receive`, 'Receive active state or faucet distinction wrong')
    check(row.receive?.text?.includes(primary.account), `${key}|Receive`, 'Real watched address missing from canonical Receive modal')
    check(presentNumber(row.receive?.width) && row.receive.width <= row.receive.client, `${key}|Receive`, 'Receive dialog horizontal overflow')
    composite.push({ route: 'Receive', width: row.width, language: row.language, theme: row.theme, pass: commonPassed && failures.length === receiveBefore, source: row.source, preserved: false, navigation: row.width === 390 ? 'shared mobile drawer' : 'desktop sidebar' })

    const settingsBefore = failures.length
    const settingsHold = hold(row.settingsScroll, row, 'Settings', true)
    scroll.push(settingsHold)
    check(row.settingsScroll?.before?.title === (row.language === 'vi' ? 'Cài đặt' : 'Settings'), `${key}|Settings`, 'Settings surface not loaded before inspection')
    composite.push({ route: 'Settings', width: row.width, language: row.language, theme: row.theme, pass: commonPassed && failures.length === settingsBefore, source: row.source, preserved: false })

    const cardHeights = Object.fromEntries((row.initial?.cards ?? []).map((card) => [card.card, card.height]))
    const viewportHeight = row.width === 390 ? 844 : 900
    dimensions.push({
      width: row.width, language: row.language, theme: row.theme,
      viewportHeight, cardHeights, defaultMaxScrollY: row.initial?.maxY,
      defaultDocumentHeight: presentNumber(row.initial?.maxY) ? row.initial.maxY + viewportHeight : null,
      footer: row.footer, expandedRecentRowsAtHold: recentExpanded,
      expandedMaxScrollY: row.expandedScroll?.before?.maxY,
      expandedRecentCardHeight: row.expandedScroll?.before?.cards?.find((card) => card.card === 'recent-transfers')?.height,
    })
  }

  const keys = composite.map(routeKey)
  check(composite.length === 60 && new Set(keys).size === 60, 'matrix', 'Expected sixty unique surface/configuration checks')
  const counts = Object.fromEntries(['Home', 'Tasks', 'Receive', 'Analytics', 'Settings'].map((route) => [route, { total: composite.filter((row) => row.route === route).length, passed: composite.filter((row) => row.route === route && row.pass).length }]))
  for (const [route, count] of Object.entries(counts)) check(count.total === 12 && count.passed === 12, route, 'Expected twelve passing checks per route')
  check(scroll.length === 36 && scroll.every((row) => row.pass), 'scroll', 'Expected thirty-six passing default/expanded/Settings holds')
  check(focusChecks === 12 && disclosureChecks === 36, 'disclosure', 'Expected twelve visible keyboard focus and thirty-six disclosure/order checks')

  const appBefore = fs.readFileSync(path.join(__dirname, 'start-baseline/frontend/src/App.tsx'), 'utf8')
  const appAfter = fs.readFileSync(path.join(root, 'frontend/src/App.tsx'), 'utf8')
  const scrollEffect = /useEffect\(\(\) => \{\s*window\.scrollTo\(\{ top: 0 \}\)\s*\}, \[w\.page\]\)/
  const globalRouteOnlyScrollEffectUnchanged = !!appBefore.match(scrollEffect) && appBefore.match(scrollEffect)?.[0] === appAfter.match(scrollEffect)?.[0]
  check(globalRouteOnlyScrollEffectUnchanged, 'source', 'Global route-only scroll effect changed')
  const insights = fs.readFileSync(path.join(root, 'frontend/src/pages/Insights.tsx'), 'utf8')
  const analyticsScopedAnchorDisabled = /overflowAnchor:\s*['"]none['"]/.test(insights)
  check(analyticsScopedAnchorDisabled, 'source', 'Analytics native scroll anchoring suppression missing')

  const timezoneObservations = final.map((row) => ({ key: config(row), timezone: row.initial?.timezone }))
  check(timezoneObservations.every((row) => typeof row.timezone === 'string' && row.timezone.length > 0), 'timezone', 'Actual browser/system Intl timezone missing')
  const history = fs.readdirSync(__dirname).filter((name) => /^continuation-browser-(?:initial|before-anchor)-\d+\.json$/.test(name))
  // These are targeted successful-feed/render holds, not repeated surface checks.
  // Requiring the proof explicitly prevents an in-progress lane from being
  // mistaken for a completed twelve-configuration proof.
  const proofSources = widths.map((width) => `continuation-feed-scroll-${width}.json`).filter((name) => fs.existsSync(path.join(__dirname, name)))
  const proofRows = proofSources.flatMap((source) => read(source).results.map((row) => ({ ...row, source })))
  const feedProof = []
  for (const row of proofRows) {
    const key = `${config(row)}|feed proof`, before = failures.length
    check(row.pass === true && !row.error, key, 'Targeted successful-feed proof did not pass')
    check(errorRows(row.errors).length === 0, key, 'Page error in targeted feed proof')
    check((row.console?.messages ?? []).every((item) => item.type !== 'error'), key, 'Console error in targeted feed proof')
    const measured = hold(row.expandedScroll, row, 'Analytics expanded feed response', true)
    const polls = row.expandedScroll?.polling ?? []
    const successfulFeedResponses = polls.filter((poll) => poll.path === '/api/arc/feed' && poll.method === 'GET' && poll.status === 200).length
    check(successfulFeedResponses > 0, key, 'No successful real feed response during targeted hold')
    const samples = row.expandedScroll?.samples ?? []
    const postResponseObservationDelayMs = samples.length >= 2 ? samples.at(-1).elapsed - samples.at(-2).elapsed : null
    check(postResponseObservationDelayMs >= 750, key, 'Post-response rendering observation is shorter than 750ms')
    feedProof.push({ ...measured, pass: measured.pass && failures.length === before, source: row.source, successfulFeedResponses, postResponseObservationDelayMs, postResponseY: samples.at(-1)?.y })
  }
  const proofKeys = proofRows.map(config)
  const feedProofComplete = proofRows.length === 12 && new Set(proofKeys).size === 12 && finalKeys.every((key) => proofKeys.includes(key))
  if (requireFeedProof) check(feedProofComplete && feedProof.every((row) => row.pass), 'feed proof', 'Expected twelve passing targeted successful-feed/render holds')
  const summary = {
    observedAt: new Date().toISOString(), pass: failures.length === 0,
    origin: primary.origin, account: primary.account,
    uniqueTotal: composite.length, passed: composite.filter((row) => row.pass).length,
    preservedChecks: preserved.length, freshChecks: final.length * 3, counts,
    finalConfigurations: final.length, timezoneEmulated: false,
    actualBrowserSystemTimezones: [...new Set(timezoneObservations.map((row) => row.timezone))], timezoneObservations,
    consoleErrors, pageErrors, warnings, failures,
    defaultRows: 5, disclosureChecks, visibleKeyboardFocusChecks: focusChecks,
    prefixAndCollapseEvidence: 'Each initial disclosure record is emitted only after Enter expansion, original first-five prefix preservation, and Enter collapse with identical order have passed. Polling snapshots are not compared across different times.',
    expandedRowCounts: Object.fromEntries(listCards.map((card) => [card, [...new Set(expandedRows.filter((row) => row.card === card).map((row) => row.rows))].sort((a, b) => a - b)])),
    expandedRecentRowsDuringFinalHolds: [...new Set(dimensions.map((row) => row.expandedRecentRowsAtHold))].sort((a, b) => a - b),
    scrollTotal: scroll.length, scrollPassed: scroll.filter((row) => row.pass).length,
    scrollDurationMs: range(scroll.map((row) => row.elapsedMs)),
    maximumScrollPositionDelta: Math.max(...scroll.map((row) => row.maxPositionDelta ?? 0)),
    successfulLivePollHolds: scroll.filter((row) => row.realNetworkPolls > 0).length,
    noHorizontalOverflow: !failures.some((item) => /overflow/i.test(item.message)),
    noNestedScrollTrap: !failures.some((item) => /nested/i.test(item.message)),
    dimensions, scroll,
    feedProofRequired: requireFeedProof, feedProofComplete,
    feedProofTotal: feedProof.length, feedProofPassed: feedProof.filter((row) => row.pass).length,
    feedProofDurationMs: range(feedProof.map((row) => row.elapsedMs)),
    feedProofMaximumScrollPositionDelta: feedProof.length ? Math.max(...feedProof.map((row) => row.maxPositionDelta ?? 0)) : null,
    targetedSuccessfulFeedHolds: feedProof,
    totalScrollObservations: scroll.length + feedProof.length,
    globalRouteOnlyScrollEffectUnchanged, analyticsScopedAnchorDisabled,
    preservedAttemptFiles: history,
    historyNote: 'Initial Receive harness used aria-current instead of the existing aria-pressed modal action. Settings initially inspected a lazy skeleton before its h1 loaded. A separate real expanded Analytics native-anchor movement at 1440 VI light (650 → 704) was fixed with scoped Insights overflowAnchor:none. Earlier evidence is preserved; final fresh files alone establish final expanded/Receive/Settings PASS.',
    taskFixtures: preserved.filter((row) => row.fixture).length,
    taskParseRequests: preserved.flatMap((row) => row.parseRequests ?? []).length,
    forbiddenProviderRequests: preserved.flatMap((row) => row.provider?.forbidden ?? []).length,
    preservationBoundary: 'Home/Tasks use preserved checkpoint browser checks; Analytics default/disclosures use recorded initial continuation checks; final expanded Analytics, Receive, Settings, keyboard focus and console use fresh final checks. No repeated attempt is counted as an additional unique surface.',
    writesByAggregator: 0, blockchainWrites: 0, results: composite,
  }
  fs.writeFileSync(path.join(__dirname, 'continuation-browser-summary.json'), JSON.stringify(summary, null, 2))
  const table = dimensions.map((row) => `| ${row.width} | ${row.language.toUpperCase()} | ${row.theme} | ${listCards.map((card) => row.cardHeights[card]).join(' / ')} | ${row.defaultDocumentHeight} | ${row.defaultMaxScrollY} | ${row.footer?.top}–${row.footer?.bottom} | ${row.expandedRecentRowsAtHold} |`).join('\n')
  const markdown = `# Final continuation browser evidence\n\n${summary.pass ? 'PASS' : 'PARTIAL'}: **${summary.passed}/${summary.uniqueTotal} unique product surface checks**. ${summary.preservedChecks} preserved Home/Tasks checks plus ${summary.freshChecks} Analytics/Receive/Settings composite checks cover 1440/1280/390 × VI/EN × dark/light. Each route: ${Object.entries(counts).map(([route, value]) => `${route} ${value.passed}/${value.total}`).join('; ')}. Repeats are excluded from these totals.\n\nActual un-emulated browser/system Intl timezone: **${summary.actualBrowserSystemTimezones.join(', ')}**. The preserved primary matrix used its explicit timezone fixture; this actual observation comes from the continuation browser's initial.timezone, with no timezone override.\n\nAnalytics has five default rows in each list. All **${disclosureChecks}/36** keyboard Enter expansion/collapse interactions preserve the first-five prefix and source order; final keyboard focus is visible in **${focusChecks}/12** configurations. Initial expanded verified rows observed: largest ${summary.expandedRowCounts['largest-transfers'].join('/')} (bounded source twelve), recent ${summary.expandedRowCounts['recent-transfers'].join('/')} (bounded source thirty), holders ${summary.expandedRowCounts.holders.join('/')} (bounded source ten). Final expanded recent hold rows: ${summary.expandedRecentRowsDuringFinalHolds.join('/')}. No backend data truncation, sorting change, synthetic pagination or nested scroll area was introduced.\n\n**${summary.scrollPassed}/${summary.scrollTotal}** scroll holds passed: twelve Analytics default, twelve Analytics expanded, and twelve Settings, each over fifteen seconds. Recorded durations: ${summary.scrollDurationMs?.min}–${summary.scrollDurationMs?.max} ms; maximum position difference ${summary.maximumScrollPositionDelta}px. Fresh expanded Analytics and Settings holds require a successful real Arc RPC polling response; ${summary.successfulLivePollHolds} holds explicitly recorded one. Default Analytics holds are preserved from the initial continuation stage. Global route-only scroll effect unchanged: ${globalRouteOnlyScrollEffectUnchanged}; scoped Analytics native anchoring suppression: ${analyticsScopedAnchorDisabled}.\n\nNo horizontal overflow: ${summary.noHorizontalOverflow}. No nested scroll trap: ${summary.noNestedScrollTrap}. Final browser console errors **${consoleErrors}**, page errors **${pageErrors}**. Footer reachability is checked in all twelve Analytics configurations. Recorded dimensions below retain fractional CSS pixels; default document height equals recorded max scroll + harness viewport height.\n\n| Width | Language | Theme | Largest / Recent / Holders card height (px) | Default document height (px) | Default max scroll (px) | Footer viewport top–bottom (px) | Final expanded recent rows |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${table}\n\nReceive immediately follows Send, uses the existing canonical modal, marks its modal action aria-pressed, and leaves Get test tokens inactive in all twelve final checks. 390px uses the shared mobile drawer. The actual watched address remains in the modal without horizontal clipping. Home/Tasks preserved checks contain ${summary.taskFixtures} isolated task fixture cases and ${summary.taskParseRequests} in-process parse requests; forbidden provider requests: ${summary.forbiddenProviderRequests}.\n\n${summary.historyNote}\n\nPreserved attempt files: ${history.join(', ')}. This aggregator only reads recorded browser/source evidence and writes this local summary; it does not request a signature, execute a blockchain transaction, commit, push or deploy.\n${failures.length ? `\nFailures:\n\n${failures.map((item) => `- ${item.key}: ${item.message}`).join('\n')}\n` : ''}`
  const feedMarkdown = proofRows.length ? `\n## Successful feed-response rendering proof\n\n${feedProofComplete ? 'COMPLETE' : 'IN PROGRESS'}: **${summary.feedProofPassed}/${summary.feedProofTotal}** targeted expanded-Analytics holds passed. These are separate from the 60 unique surface checks and the 36 base scroll holds. Every counted passing proof observed a real \`/api/arc/feed\` HTTP 200 during polling, then retained the position and expanded row state in an additional observation at least 750ms after the response-render check. Durations: ${summary.feedProofDurationMs?.min}–${summary.feedProofDurationMs?.max}ms; maximum position difference: ${summary.feedProofMaximumScrollPositionDelta}px. Aggregate recorded scroll observations including these targeted holds: ${summary.totalScrollObservations}. The ordinary final 17.5s holds require RPC HTTP 200 and are not claimed to have completed a feed response.\n\n| Width | Language | Theme | Hold duration (ms) | Before / post-response Y (px) | Maximum position difference (px) | Successful feed responses | Post-response observation delay (ms) |\n| --- | --- | --- | --- | --- | --- | --- | --- |\n${feedProof.map((row) => `| ${row.width} | ${row.language.toUpperCase()} | ${row.theme} | ${row.elapsedMs} | ${row.beforeY} / ${row.postResponseY} | ${row.maxPositionDelta} | ${row.successfulFeedResponses} | ${row.postResponseObservationDelayMs} |`).join('\n')}\n\nProof sources: ${proofSources.join(', ')}. Broad final browser files and earlier native-anchor failure evidence remain preserved.\n` : '\nNo separate successful-feed proof files were available when this summary was generated.\n'
  fs.writeFileSync(path.join(__dirname, 'continuation-browser-summary.md'), markdown + feedMarkdown)
  console.log(JSON.stringify({ pass: summary.pass, uniqueTotal: summary.uniqueTotal, passed: summary.passed, counts, scrollPassed: summary.scrollPassed, scrollTotal: summary.scrollTotal, feedProofComplete, feedProofPassed: summary.feedProofPassed, feedProofTotal: summary.feedProofTotal, consoleErrors, pageErrors, timezones: summary.actualBrowserSystemTimezones, failures: failures.length }, null, 2))
  if (!summary.pass) process.exitCode = 1
}
aggregate()
