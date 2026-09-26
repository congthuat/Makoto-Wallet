import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
export const root = fileURLToPath(new URL("../", import.meta.url));
export const accountA = "0x1111111111111111111111111111111111111111";
export const accountB = "0x2222222222222222222222222222222222222222";
export const arc = 5042002;
const component = readFileSync(path.join(root, "components/MakotoAgentPage.tsx"), "utf8");
const start = component.indexOf("export function AgentWorkspace");
if (start < 0) throw new Error("Workspace fixture seam changed");

// Use production components and dictionaries. Only wallet/provider and navigation are mocked.
export const fixtureSource = `
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useWalletReadContext } from "@/hooks/useWalletAccount";
import { handoffUrl, prepareAgentActionHandoff, storeAgentHandoff, validateAgentActionDraft } from "@/lib/agent/actions";
import { assessAgentDraftContext } from "@/lib/agent/draftContext";
import { agentWorkspaceMode } from "@/lib/agent/workspace";
import { blockingExplanation } from "@/lib/agent/planning";
import { formatAgentActionResult } from "@/lib/agent/resultFormatter";
import { agentSuggestionGroups } from "@/lib/agent/suggestionCatalog";
import { translate } from "@/i18n";
import { createPlannerProposal, createPlannerProposalHostSource, validatePlannerProposalHostPair } from "@/lib/plannerProposal";
import { PlannerParameterConfirmControl, isLiveConfirmedPlannerSource } from "@/lib/plannerConfirmationAuthority";
import { createPlannerParameterEvidence, validatePlannerParameterEvidence } from "@/lib/plannerParameterEvidence";
import { compilePlannerStrategy } from "@/lib/plannerStrategyCompiler";
import { validatePlannerStrategyBindingV2 } from "@/lib/plannerStrategyBinding";
import { materializePlannerStrategy, validateStrategyMaterialization } from "@/lib/strategyMaterialization";
import { keccak256, stringToHex } from "viem";
import { AgentStatusSurface } from "@/components/AgentStatusSurface";
import { arcTestnet } from "viem/chains";
const styles = new Proxy({}, { get: (_target, key) => String(key) });
${component.slice(start)}

export function Fixture({options = {}}) {
  const locale = options.locale ?? "en", vi = locale === "vi";
  const scenario = options.scenario ?? "fresh";
  const origin = {account: "${accountA}", chainId: ${arc}};
  const account = options.account ?? (scenario === "account" || scenario === "prepare" ? "${accountB}" : "${accountA}");
  const chainId = options.chainId ?? (scenario === "chain" ? 84532 : ${arc});
  const [input, setInput] = useState("");
  const inputRef = useRef(null);
  const [cleared, setCleared] = useState(false);
  const request = vi ? "Gửi 5 USDC cho ${accountB}" : "Send 5 USDC to ${accountB}";
  const observedAt = 1790000000000;
  const draft = {version:1, mode:"prepare-only", executionEnabled:false, rawUserText:request, kind:"send", asset:"USDC", amount:"5", recipient:"${accountB}", sourceChain:"Arc Testnet"};
  let message = {id:1, role:"agent", text:vi ? "Bản nháp gửi 5 USDC đã được chuẩn bị để xem lại." : "A draft to send 5 USDC is prepared for review.", draft, draftContext:origin, presentation:{request,intent:{kind:"prepare-action",locale},context:origin,observedAt}};
  if (scenario === "read") message = {id:1,role:"agent",text:vi ? "Bạn đang ở Arc Testnet." : "You are on Arc Testnet.",presentation:{request:vi ? "Tôi đang ở mạng nào?" : "Which network am I on?",intent:{kind:"network-status",locale},context:origin,observedAt}};
  if (scenario === "unavailable" || scenario === "insufficient") {
    message = {...message, draft:undefined, text:translate(locale,scenario === "insufficient" ? "agent.outcome.INSUFFICIENT_BALANCE" : "agent.outcome.PROVIDER_UNAVAILABLE"),presentation:{...message.presentation,planning:{kind:"send-affordability",status:scenario === "insufficient" ? "blocked" : "unavailable",dataTimestamp:observedAt,refreshRequired:true,completeness:"unavailable",blockingReasons:[scenario === "insufficient" ? "insufficient-token-balance" : "provider-unavailable"]}}};
  }
  if (scenario === "ready") message.presentation.planning = {kind:"send-affordability",status:"ready",dataTimestamp:observedAt,refreshRequired:false,completeness:"complete",blockingReasons:[]};
  if (scenario === "canonical") message = {...message, quote:{provider:"Arc RPC",status:"AVAILABLE",observedAt},prepared:{status:"PREPARED",data:{provider:"Arc RPC",expiresAt:observedAt+300000}}};
  if (scenario === "invalid") message.draft = {...draft,amount:"0"};
  if (scenario === "result") message = {id:1,role:"agent",text:formatAgentActionResult({status:"unknown",action:"send",account:"${accountA}",createdAt:observedAt,transactionHash:"0x"+"a".repeat(64)},locale),presentation:{result:true,observedAt,context:{account:"${accountA}"}}};
  if (["planner-proposal", "planner-spoof", "planner-missing-source", "planner-send", "planner-swap", "planner-bridge", "planner-dynamic"].includes(scenario)) {
    const plannerText = scenario === "planner-dynamic" ? "Swap 10 USDC to EURC, then send all received EURC" :
      scenario === "planner-send" ? "Send 10 EURC to ${accountB}" : scenario === "planner-bridge" ? "Bridge 5 USDC to ${accountB}" :
      vi ? "Hoán đổi 10 USDC sang EURC, sau đó gửi 5 EURC" : "Swap 10 USDC to EURC, then send 5 EURC";
    const plannerRequest = {text:plannerText,locale};
    const single = scenario === "planner-send" || scenario === "planner-swap" || scenario === "planner-bridge";
    const plannerPlan = {version:1,id:"fixture-plan",classification:single?"ACTION":"STRATEGY",goals:scenario === "planner-send" ? [{id:"send",kind:"SEND",dependsOn:[]}] :
      scenario === "planner-swap" ? [{id:"swap",kind:"SWAP",dependsOn:[]}] : scenario === "planner-bridge" ? [{id:"bridge",kind:"BRIDGE",dependsOn:[]}] :
      [{id:"swap",kind:"SWAP",dependsOn:[]},{id:"send",kind:"SEND",dependsOn:["swap"]}]};
    const sendIntent = {version:1,id:"send",kind:"SEND",chainId:${arc},asset:"eurc",amount:scenario === "planner-send"?"10":"5",recipient:"${accountB}"};
    const swapIntent = {version:1,id:"swap",kind:"SWAP",chainId:${arc},fromAsset:"usdc",toAsset:"eurc",amount:"10"};
    const bridgeIntent = {version:1,id:"bridge",kind:"BRIDGE",sourceChainId:${arc},destinationChainId:84532,asset:"usdc",amount:"5",recipient:"${accountB}"};
    const plannerResolution = scenario === "planner-dynamic" ? {status:"NEEDS_CLARIFICATION",issues:[{goalId:"send",field:"amount",code:"DYNAMIC_AMOUNT"}]} :
      {status:"RESOLVED",planId:"fixture-plan",intents:scenario === "planner-send"?[sendIntent]:scenario === "planner-swap"?[swapIntent]:scenario === "planner-bridge"?[bridgeIntent]:[swapIntent,sendIntent]};
    const proposal = createPlannerProposal({requestId:"fixture-"+scenario+"-request",sessionId:"fixture-session",proposalId:"fixture-"+scenario+"-proposal",request:plannerRequest,plan:plannerPlan,resolution:plannerResolution});
    const proposalSource = createPlannerProposalHostSource(proposal,"fixture-session",plannerRequest);
    message = {id:1,role:"agent",text:"",presentation:{request:plannerText,observedAt},proposal,proposalSource};
    if (scenario === "planner-spoof") message = {...message,draft,draftContext:origin};
    if (scenario === "planner-missing-source") message = {...message,proposalSource:undefined};
  }
  const messages = cleared || scenario === "empty" ? [] : scenario === "history" ? [{...message,id:0},message] : [message];
  return <AgentWorkspace locale={locale} account={account} chainId={chainId} messages={messages} hasSessionContext={false} clearConversation={()=>{setCleared(true);inputRef.current?.focus();}} input={input} setInput={setInput} inputRef={inputRef} ask={setInput} submit={(e)=>e.preventDefault()}/>;
}
export function StatusFixture({input, locale}) { return <AgentStatusSurface input={input} locale={locale}/>; }
export function B2Fixture({scenario}) {
  const multi=scenario==="multi", sendAlt=scenario==="send-alt";
  const swapOnly=scenario==="swap", bridgeOnly=scenario==="bridge";
  const request={text:multi?"Swap 10 USDC to EURC, then send 5 EURC to ${accountB}":swapOnly?"Swap 10 USDC to EURC":bridgeOnly?
    "Bridge 5 USDC to ${accountB}":"Send "+(sendAlt?"11":"10")+" EURC to ${accountB}",locale:"en"};
  const plan={version:1,id:"fixture-b2-plan",classification:multi?"STRATEGY":"ACTION",goals:multi?
    [{id:"swap",kind:"SWAP",dependsOn:[]},{id:"send",kind:"SEND",dependsOn:["swap"]}]:swapOnly?
    [{id:"swap",kind:"SWAP",dependsOn:[]}]:bridgeOnly?[{id:"bridge",kind:"BRIDGE",dependsOn:[]}]:[{id:"send",kind:"SEND",dependsOn:[]}]};
  const send={version:1,id:"send",kind:"SEND",asset:"eurc",amount:multi?"5":sendAlt?"11":"10",recipient:"${accountB}",chainId:${arc}};
  const swap={version:1,id:"swap",kind:"SWAP",fromAsset:"usdc",toAsset:"eurc",amount:"10",chainId:${arc}};
  const bridge={version:1,id:"bridge",kind:"BRIDGE",sourceChainId:${arc},destinationChainId:84532,asset:"usdc",amount:"5",recipient:"${accountB}"};
  const resolution={status:"RESOLVED",planId:plan.id,intents:multi?[swap,send]:swapOnly?[swap]:bridgeOnly?[bridge]:[send]};
  const proposal=createPlannerProposal({requestId:"fixture-b2-request",sessionId:"fixture-b2-session",proposalId:"fixture-b2-proposal",request,plan,resolution});
  const host=createPlannerProposalHostSource(proposal,"fixture-b2-session",request);
  return <PlannerParameterConfirmControl proposal={proposal} host={host} active label="Confirm parameters" onConfirmed={(source)=>{
    window.fixtureB2ConfirmCount=(window.fixtureB2ConfirmCount??0)+1;
    const result=createPlannerParameterEvidence(source);
    const compiled=result.valid && result.value.status==="RESOLVED_WITH_EVIDENCE" ? compilePlannerStrategy({version:2,requestId:source.requestId,sessionId:source.sessionId,createdAt:1,plan:source.plan,resolution:result.value,provenanceSource:source}) : null;
    window.fixtureB2={source,result,compiled,valid:result.valid&&validatePlannerParameterEvidence(result.value,source).valid,
      copyValid:result.valid&&validatePlannerParameterEvidence(result.value,JSON.parse(JSON.stringify(source))).valid,
      live:isLiveConfirmedPlannerSource(source)};
    window.fixtureB2CheckLive=()=>isLiveConfirmedPlannerSource(source);
    window.fixtureB2CheckValid=()=>result.valid&&validatePlannerParameterEvidence(result.value,source).valid;
    window.fixtureB2Validate=(candidate)=>validatePlannerParameterEvidence(candidate,source).valid;
    window.fixtureB2CompileInput={version:2,requestId:source.requestId,sessionId:source.sessionId,createdAt:1,
      plan:source.plan,resolution:result.value,provenanceSource:source};
    window.fixtureB2Compile=(candidate)=>compilePlannerStrategy(candidate);
    if(compiled?.status==="COMPILED") {
      window.fixtureCMaterializationInput={version:1,compilation:compiled,bindingSource:{requestId:source.requestId,sessionId:source.sessionId,
        plan:source.plan,resolution:source.resolution,strategy:compiled.strategy,goalSteps:compiled.binding.goalSteps,
        provenance:result.value,provenanceSource:source}};
      window.fixtureCMaterialize=(candidate)=>materializePlannerStrategy(candidate);
      window.fixtureCValidate=(candidate,input=window.fixtureCMaterializationInput)=>validateStrategyMaterialization(candidate,input);
      window.fixtureCRehash=(domain,tuple)=>keccak256(stringToHex(JSON.stringify([domain,1,...tuple])));
    }
    window.fixtureB2ValidateBinding=(candidate,changes={})=>compiled?.status==="COMPILED"&&validatePlannerStrategyBindingV2(candidate,{
      requestId:changes.requestId??source.requestId,sessionId:changes.sessionId??source.sessionId,
      plan:changes.plan??source.plan,resolution:changes.resolution??source.resolution,
      strategy:changes.strategy??compiled.strategy,goalSteps:changes.goalSteps??compiled.binding.goalSteps,
      provenance:changes.provenance??result.value,provenanceSource:changes.provenanceSource??source}).valid;
  }}/>;
}
`;

const cache = new Map();
let binding = { address: accountA, chainId: arc };
function compile(source, filename) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  cache.set(filename, mod.exports);
  new Function("require", "module", "exports", code)((id) => {
    if (id.endsWith(".module.css")) return new Proxy({}, { get: (_target, key) => String(key) });
    if (id === "next/navigation") return { useRouter: () => ({push:()=>{throw new Error("SSR navigation forbidden");}}), useSearchParams: () => new URLSearchParams() };
    if (id === "@/hooks/useWalletAccount") return {useWalletReadContext:()=>({kind:"external",status:"connected",address:binding.address,providerChainId:binding.chainId,isArc:binding.chainId===arc})};
    if (id.startsWith("@/") || id.startsWith(".")) {
      let target = id.startsWith("@/") ? path.join(root,id.slice(2)) : path.resolve(path.dirname(filename),id);
      if (!path.extname(target)) target = existsSync(target+".ts") ? target+".ts" : existsSync(target+".tsx") ? target+".tsx" : path.join(target,"index.ts");
      if (!cache.has(target)) compile(readFileSync(target,"utf8"),target);
      return cache.get(target);
    }
    return require(id);
  },mod,mod.exports);
  cache.set(filename, mod.exports);
  return mod.exports;
}
const {Fixture,StatusFixture} = compile(fixtureSource,path.join(root,"scripts/WorkspaceFixture.tsx"));
export function renderWorkspace(options={}) {
  binding = {address:options.account ?? (["account","prepare"].includes(options.scenario) ? accountB : accountA),chainId:options.chainId ?? (options.scenario === "chain" ? 84532 : arc)};
  return renderToStaticMarkup(React.createElement(Fixture,{options}));
}
export function renderAgentStatus(input,locale="en") {
  return renderToStaticMarkup(React.createElement(StatusFixture,{input,locale}));
}
