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
  const messages = cleared || scenario === "empty" ? [] : scenario === "history" ? [{...message,id:0},message] : [message];
  return <AgentWorkspace locale={locale} account={account} chainId={chainId} messages={messages} hasSessionContext={false} clearConversation={()=>{setCleared(true);inputRef.current?.focus();}} input={input} setInput={setInput} inputRef={inputRef} ask={setInput} submit={(e)=>e.preventDefault()}/>;
}
`;

const cache = new Map();
let binding = { address: accountA, chainId: arc };
function compile(source, filename) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id === "next/navigation") return { useRouter: () => ({push:()=>{throw new Error("SSR navigation forbidden");}}), useSearchParams: () => new URLSearchParams() };
    if (id === "@/hooks/useWalletAccount") return {useWalletReadContext:()=>({kind:"external",status:"connected",address:binding.address,providerChainId:binding.chainId,isArc:binding.chainId===arc})};
    if (id.startsWith("@/") || id.startsWith(".")) {
      let target = id.startsWith("@/") ? path.join(root,id.slice(2)) : path.resolve(path.dirname(filename),id);
      if (!path.extname(target)) target = existsSync(target+".ts") ? target+".ts" : path.join(target,"index.ts");
      if (!cache.has(target)) cache.set(target,compile(readFileSync(target,"utf8"),target));
      return cache.get(target);
    }
    return require(id);
  },mod,mod.exports);
  return mod.exports;
}
const {Fixture} = compile(fixtureSource,path.join(root,"scripts/WorkspaceFixture.tsx"));
export function renderWorkspace(options={}) {
  binding = {address:options.account ?? (["account","prepare"].includes(options.scenario) ? accountB : accountA),chainId:options.chainId ?? (options.scenario === "chain" ? 84532 : arc)};
  return renderToStaticMarkup(React.createElement(Fixture,{options}));
}
