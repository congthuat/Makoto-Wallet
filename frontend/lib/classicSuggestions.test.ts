import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";
import { AGENT_SUGGESTION_COUNT, agentSuggestionGroups } from "./agent/suggestionCatalog.ts";

const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const overview = readFileSync(new URL("../components/ConnectedOverview.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/ConnectedOverview.module.css", import.meta.url), "utf8");

test("classic suggestion catalog contains 30 localized, supported prompts", () => {
  assert.equal(AGENT_SUGGESTION_COUNT, 30);
  assert.equal(agentSuggestionGroups.length, 4);
  for (const group of agentSuggestionGroups) {
    assert.ok(en[group.labelKey]);
    assert.ok(vi[group.labelKey]);
    for (const suggestion of group.suggestions) {
      assert.ok(en[suggestion.promptKey], `Missing EN prompt: ${suggestion.promptKey}`);
      assert.ok(vi[suggestion.promptKey], `Missing VI prompt: ${suggestion.promptKey}`);
    }
  }
  const prompts = agentSuggestionGroups.flatMap((group) => group.suggestions.map((item) => en[item.promptKey])).join("\n");
  assert.doesNotMatch(prompts, /cirBTC (?:swap|bridge)|EURC bridge|Universal Local Bridge|autonomous/i);
});

test("suggestion selection fills the existing composer without submitting", () => {
  const selector = dashboard.slice(dashboard.indexOf("function selectAgentSuggestion"), dashboard.indexOf("function moveSuggestionFocus"));
  assert.match(selector, /setAgentInput\(prompt\)/);
  assert.match(selector, /setSuggestionsOpen\(false\)/);
  assert.match(selector, /agentInputRef\.current\?\.focus\(\)/);
  assert.doesNotMatch(selector, /submitAgent|askAgent|setAction|writeContract|sendTransaction|signMessage/);
});

test("suggestion popover is accessible, dismissible, and keyboard navigable", () => {
  assert.match(dashboard, /aria-expanded=\{suggestionsOpen\}/);
  assert.match(dashboard, /aria-haspopup="dialog"/);
  assert.match(dashboard, /event\.key !== "Escape"/);
  assert.match(dashboard, /"ArrowDown"[\s\S]*"ArrowUp"/);
  assert.match(dashboard, /data-suggestion-option/);
  assert.match(dashboard, /document\.addEventListener\("pointerdown", dismiss\)/);
  assert.match(css, /\.suggestionPanel \{[^}]*max-height:[^}]*100dvh[^}]*\}/);
  assert.match(css, /\.suggestionList \{[^}]*overflow-y: auto/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*\.suggestionPanel \{ position: fixed/);
});

test("classic hero rail is gone and composer owns the compact Suggestions control", () => {
  assert.doesNotMatch(dashboard, /className=\{overviewStyles\.suggestions\}/);
  assert.doesNotMatch(css, /agentSlot > \.suggestions/);
  assert.match(dashboard, /suggestionTrigger[\s\S]*dashboard-agent-question[\s\S]*composerSend/);
  assert.match(css, /\.agentAtmosphere \{ min-height: 382px; \}/);
  assert.doesNotMatch(css, /agentAtmosphere \{[^}]*translateX/);
});

test("activity status and token icons use dedicated balanced slots", () => {
  assert.match(css, /\.activity li \{[^}]*minmax\(124px, \.34fr\)[^}]*minmax\(128px, auto\)[^}]*column-gap:/);
  assert.match(css, /\.activityStatus \{[^}]*justify-self: start/);
  assert.match(css, /\.activityLinks \{[^}]*min-width: 128px[^}]*justify-content: flex-end/);
  assert.match(overview, /assetLogoArtwork/);
  assert.match(css, /\.assetLogo \{[^}]*width: 42px[^}]*height: 42px[^}]*place-items: center/);
  assert.match(css, /\.assetLogoArtwork \{ width: 42px; height: 42px/);
  assert.match(css, /\.assetLogoFallback::before \{[^}]*width: 35px[^}]*height: 35px/);
});
