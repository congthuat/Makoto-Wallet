import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { agentWorkspaceMode } from "./agent/workspace.ts";
import { translate } from "../i18n/index.ts";
import { en } from "../i18n/en.ts";
import { vi } from "../i18n/vi.ts";
// The fixture transpiles the actual TSX components with isolated wallet hooks.
// @ts-expect-error Test-only JavaScript renderer.
import { renderWorkspace, accountA, accountB } from "../scripts/phase7g-workspace-fixture.mjs";

test("workspace distinguishes reads, incomplete actions, drafts and returned reports", () => {
  assert.equal(agentWorkspaceMode({kind:"network-status",locale:"en"}),"read");
  assert.equal(agentWorkspaceMode({kind:"swap-quote",locale:"en"}),"read");
  assert.equal(agentWorkspaceMode({kind:"clarification",locale:"en",preparation:{kind:"send",rawUserText:"Send"}}),"action");
  assert.equal(agentWorkspaceMode(undefined,true),"action");
  assert.equal(agentWorkspaceMode(undefined,true,true),"result");
  assert.equal(agentWorkspaceMode(),"answer");
});

for (const locale of ["en","vi"] as const) {
  test(`${locale}: reads render a direct answer without plan, draft or Review workflow`,()=>{
    const html=renderWorkspace({locale,scenario:"read"});
    assert.match(html,/data-operation-mode="read"/);
    assert.ok(html.includes(locale === "vi" ? "Bạn đang ở Arc Testnet." : "You are on Arc Testnet."));
    assert.doesNotMatch(html,/class="plan"|class="draft"/);
    assert.match(html,/class="boundary"/);
  });
  test(`${locale}: action scan path runs from intent through plan, evidence, draft, safety and review`,()=>{
    const html=renderWorkspace({locale,scenario:"fresh"});
    const positions=['class="request"','class="plan"','class="operationEvidence"','class="draft"','class="draftBoundary"','class="prepareButton"','class="history"'].map(token=>html.indexOf(token));
    assert.ok(positions.every(position=>position>=0));
    assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
    assert.ok(html.includes(translate(locale,"agent.workspace.noEvidence")));
    assert.match(html,/data-agent-status="UNAVAILABLE" data-historical="false"/);
    assert.ok(html.includes(translate(locale,"agent.status.detail.UNAVAILABLE")));
    assert.ok(html.includes(accountA));
    assert.match(html,/data-context-status="current"/);
  });
  for(const scenario of ["account","chain"]){
    test(`${locale}: ${scenario} change preserves historical origin and explicit preparation`,()=>{
      const html=renderWorkspace({locale,scenario});
      assert.match(html,/data-context-status="historical"/);
      assert.ok(html.includes(translate(locale,"agent.draft.prepareCurrent")));
      assert.ok(html.includes(translate(locale,"agent.draft.historicalHelp")));
      assert.ok(html.includes(accountA));
      assert.ok(html.includes(accountB));
      assert.match(html,/5042002/);
    });
  }
  test(`${locale}: unavailable and insufficient evidence cannot claim readiness`,()=>{
    for(const scenario of ["unavailable","insufficient"]){
      const html=renderWorkspace({locale,scenario});
      assert.ok(html.includes(translate(locale,"agent.workspace.noDraft")));
      assert.ok(html.includes(translate(locale,"agent.workspace.incomplete")));
      assert.doesNotMatch(html,/class="prepareButton"/);
    }
  });
  test(`${locale}: captured planning readiness remains an estimate requiring Review`,()=>{
    const html=renderWorkspace({locale,scenario:"ready"});
    assert.ok(html.includes(translate(locale,"agent.workspace.estimated")));
    assert.ok(html.includes(translate(locale,"agent.workspace.capturedEvidence")));
    assert.ok(html.includes(translate(locale,"agent.workspace.draftBoundary")));
  });
  test(`${locale}: canonical quote and preparation appear as evidence`,()=>{
    const html=renderWorkspace({locale,scenario:"canonical"});
    assert.ok(html.includes(translate(locale,"agent.workspace.quoteEvidence")));
    assert.ok(html.includes(translate(locale,"agent.workspace.preparedEvidence")));
    assert.ok(html.includes(translate(locale,"agent.workspace.expiresAt")));
    assert.ok(!html.includes(translate(locale,"agent.workspace.noEvidence")));
  });
  test(`${locale}: returned unknown result retains formatter status without a new action`,()=>{
    const html=renderWorkspace({locale,scenario:"result"});
    assert.match(html,/data-operation-mode="result"/);
    assert.ok(html.includes(translate(locale,"agent.result.unknown")));
    assert.ok(html.includes(translate(locale,"agent.workspace.reportedResult")));
    assert.doesNotMatch(html,/class="prepareButton"|class="plan"/);
  });
  test(`${locale}: invalid input remains disabled and labelled`,()=>{
    const html=renderWorkspace({locale,scenario:"invalid"});
    assert.match(html,/<button[^>]+class="prepareButton"[^>]+disabled=""/);
    assert.match(html,/aria-describedby=/);
    assert.match(html,/<label[^>]*for="agent-question">/);
  });
}

test("new EN/VI workspace dictionaries have parity and intact text",()=>{
  const keys=Object.keys(en).filter(key=>key.startsWith("agent.workspace.")) as (keyof typeof en)[];
  assert.ok(keys.length>40);
  for(const key of keys){
    assert.ok(vi[key],key);
    assert.doesNotMatch(vi[key],/[\uFFFD]|\w\?\w|\?\?/,key);
    assert.doesNotMatch(en[key],/ \? /,key);
  }
});

test("presentation metadata leaves the result formatter and request invalidation path in use",()=>{
  const hook=readFileSync(new URL("../hooks/useMakotoAgent.ts",import.meta.url),"utf8");
  assert.match(hook,/text: formatAgentActionResult\(result, locale\)/);
  assert.match(hook,/planning: response.planning, context: binding, observedAt: now/);
  assert.match(hook,/!requestGeneration.current.isCurrent\(generation\) \|\| latestBinding.current !== bindingKey/);
});
