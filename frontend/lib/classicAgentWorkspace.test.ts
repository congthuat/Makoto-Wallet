import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AGENT_SUGGESTION_COUNT } from "./agent/suggestionCatalog.ts";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";

const page = readFileSync(new URL("../components/MakotoAgentPage.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../components/MakotoAgentPage.module.css", import.meta.url), "utf8");

test("dedicated Agent workspace is conversation-first with a compact safety rail", () => {
  assert.equal(AGENT_SUGGESTION_COUNT, 30);
  assert.match(page, /workspaceGrid[\s\S]*conversation[\s\S]*contextRail/);
  assert.match(css, /\.workspaceGrid \{[^}]*minmax\(0, 7fr\)[^}]*minmax\(300px, 3fr\)/);
  assert.doesNotMatch(page, /className=\{styles\.compactStatus\}/);
  assert.doesNotMatch(page, /agent\.workspace\.eyebrow/);
  assert.match(page, /className=\{styles\.boundarySteps\}/);
  assert.match(page, /<details className=\{styles\.history\}>/);
  assert.doesNotMatch(en["agent.workspace.title"], /operations/i);
  assert.equal(en["agent.workspace.title"], "Agent");
  assert.equal(vi["agent.workspace.title"], "Trợ lý");
  assert.equal(en["agent.workspace.wallet"], "Wallet");
  assert.equal(vi["agent.workspace.wallet"], "Ví");
});

test("dedicated Agent suggestions reuse the shared catalog and fill only the composer", () => {
  assert.match(page, /import \{ agentSuggestionGroups \} from "@\/lib\/agent\/suggestionCatalog"/);
  assert.match(page, /agentSuggestionGroups\.reduce/);
  assert.match(page, /setInput\(t\(promptKey\)\)/);
  assert.match(page, /inputRef\.current\?\.focus\(\)/);
  const select = page.slice(page.indexOf("function selectSuggestion"), page.indexOf("return <div", page.indexOf("function selectSuggestion")));
  assert.doesNotMatch(select, /submit\(|ask\(|sendTransaction|writeContract|sign/);
});

test("Agent composer and suggestion panel keep accessible interaction semantics", () => {
  assert.match(page, /htmlFor="agent-question"/);
  assert.match(page, /aria-expanded=\{suggestionsOpen\}/);
  assert.match(page, /aria-haspopup="dialog"/);
  assert.match(page, /event\.key !== "Escape"/);
  assert.match(page, /document\.addEventListener\("pointerdown", dismiss\)/);
  assert.match(css, /\.workspace :is\(button, input, summary, a\):focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("Agent layout stacks safely at tablet and mobile widths", () => {
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.workspaceGrid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /@media \(max-width: 620px\)[\s\S]*\.composerRow \{[^}]*grid-template-areas: "input input" "suggestions send"/);
  assert.match(css, /@media \(max-width: 1023px\)[\s\S]*\.contextRail \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(css, /\.suggestionPanel \{ position: fixed; inset: auto 12px 12px/);
  assert.doesNotMatch(css, /overflow-x:\s*(?:hidden|clip)|100vw/);
});

test("confirmation copy keeps the no-signing and no-submission boundary explicit", () => {
  assert.match(en["agent.page.disclosure"], /never signs or submits/i);
  assert.match(vi["agent.page.disclosure"], /không bao giờ ký hoặc gửi/i);
  assert.match(page, /agent\.page\.disclosure/);
  assert.doesNotMatch(page, /walletClient|sendTransaction|writeContract|signMessage/);
});
