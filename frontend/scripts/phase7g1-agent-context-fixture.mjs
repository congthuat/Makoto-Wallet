import { readFileSync } from "node:fs";
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
export const arc = 5_042_002;
export const otherChain = 84_532;

const component = readFileSync(path.join(root, "components/MakotoAgentPage.tsx"), "utf8");
const start = component.indexOf("export function ActionDraftCard");
const end = component.indexOf("\nfunction validationFieldLabel", start);
if (start < 0 || end < start) throw new Error("ActionDraftCard fixture seam changed");

export const fixtureSource = `
import * as React from "react";
import { useEffect, useRef, useState } from "react";
import { useConnection } from "wagmi";
import { useRouter, useSearchParams } from "next/navigation";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { handoffUrl, prepareAgentActionHandoff, storeAgentHandoff, validateAgentActionDraft } from "@/lib/agent/actions";
import { assessAgentDraftContext } from "@/lib/agent/draftContext";
import { translate, type Locale, type TranslationKey } from "@/i18n";
const styles = new Proxy({}, { get: (_target, key) => String(key) });
${component.slice(start, end)}
`;

const draft = Object.freeze({ version: 1, mode: "prepare-only", rawUserText: `send 5 USDC to ${accountB}`, executionEnabled: false, kind: "send", asset: "USDC", amount: "5", recipient: accountB, sourceChain: "Arc Testnet" });
let locale = "en";
const cache = new Map();

function compile(source, filename) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id === "wagmi") return { useConnection: () => window.fixtureConnection };
    if (id === "next/navigation") return { useRouter: () => ({ push: (url) => { window.fixturePushed = url; } }), useSearchParams: () => new URLSearchParams(window.location.search) };
    if (id === "@/hooks/useVerifiedWalletChain") return { useVerifiedWalletChain: () => ({ providerChainId: window.fixtureChain }) };
    if (id === "@/i18n") return { translate: (language, key) => ({
      "agent.draft.aria": language === "vi" ? "Bản nháp hành động" : "Action draft",
      "agent.draft.title": language === "vi" ? "Bản nháp hành động" : "Action draft",
      "agent.draft.ready": language === "vi" ? "Sẵn sàng" : "Ready",
      "agent.draft.historical": language === "vi" ? "Ngữ cảnh ví trước đó" : "Previous wallet context",
      "agent.draft.contextUnknown": language === "vi" ? "Không có ngữ cảnh" : "Context unavailable",
      "agent.draft.action": language === "vi" ? "Hành động" : "Action",
      "agent.draft.amount": language === "vi" ? "Số tiền" : "Amount",
      "agent.draft.recipient": language === "vi" ? "Người nhận" : "Recipient",
      "agent.draft.network": language === "vi" ? "Mạng" : "Network",
      "agent.draft.send": language === "vi" ? "Gửi" : "Send",
      "agent.draft.helper": language === "vi" ? "Kiểm tra bản nháp trước khi tiếp tục trong ví." : "Review this draft before continuing in your wallet.",
      "agent.draft.review": language === "vi" ? "Xem lại giao dịch" : "Review transaction",
      "agent.draft.prepareCurrent": language === "vi" ? "Chuẩn bị cho ví hiện tại" : "Prepare for current wallet",
      "agent.draft.historicalHelp": language === "vi" ? "Ý định này được chuẩn bị trong ngữ cảnh ví trước đó. Hãy chuẩn bị lại cho ví đang kết nối." : "This intention was prepared under a previous wallet context. Prepare it again for the currently connected wallet.",
      "agent.draft.contextUnknownHelp": language === "vi" ? "Không có ngữ cảnh ví ban đầu. Hãy chuẩn bị lại ý định này cho ví đang kết nối." : "The original wallet context is unavailable. Prepare this intention again for the currently connected wallet.",
      "agent.draft.waitingForWallet": language === "vi" ? "Kết nối ví để chuẩn bị ý định này." : "Connect a wallet to prepare this intention.",
      "agent.draft.missing": language === "vi" ? "Thiếu thông tin" : "Missing information",
      "agent.draft.blocked": language === "vi" ? "Đã chặn" : "Blocked",
      "agent.draft.missingLabel": language === "vi" ? "Còn thiếu" : "Missing",
      "agent.draft.blockedLabel": language === "vi" ? "Đã chặn" : "Blocked",
      "agent.draft.disabled": language === "vi" ? "Hoàn tất thông tin còn thiếu hoặc sửa mục bị chặn." : "Complete missing information or fix the blocked field.",
      "agent.field.draft": language === "vi" ? "bản nháp" : "draft",
      "agent.field.amount": language === "vi" ? "số tiền" : "amount",
      "agent.field.asset": language === "vi" ? "tài sản" : "asset",
      "agent.field.outputAsset": language === "vi" ? "tài sản nhận" : "output asset",
      "agent.field.recipient": language === "vi" ? "người nhận" : "recipient",
      "agent.field.sourceChain": language === "vi" ? "mạng nguồn" : "source network",
      "agent.field.destinationChain": language === "vi" ? "mạng đích" : "destination network",
      "agent.draft.preparing": language === "vi" ? "Đang chuẩn bị" : "Preparing",
      "agent.draft.openingReview": language === "vi" ? "Đang mở bước xem lại…" : "Opening review…",
      "agent.draft.vaultDeposit": "Vault deposit", "agent.draft.vaultWithdraw": "Vault withdrawal", "agent.draft.swap": "Swap", "agent.draft.bridge": "Bridge", "agent.draft.maxBlocked": "MAX actions require the manual flow."
    }[key] ?? key) };
    if (id.endsWith(".css")) return {};
    if (id.startsWith("@/") || id.startsWith(".")) {
      let target = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
      if (!path.extname(target)) target += target.endsWith(`${path.sep}i18n`) || target.endsWith(`${path.sep}agent`) || target.endsWith(`${path.sep}actions`) ? `${path.sep}index.ts` : ".ts";
      if (!cache.has(target)) cache.set(target, compile(readFileSync(target, "utf8"), target));
      return cache.get(target);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}

const { ActionDraftCard } = compile(fixtureSource, path.join(root, "scripts/AgentDraftFixture.tsx"));
export function renderDraft(options = {}) {
  locale = options.locale ?? "en";
  return renderToStaticMarkup(React.createElement(ActionDraftCard, { draft, draftContext: options.origin === "missing" ? undefined : { account: options.originAccount ?? accountA, chainId: options.originChain ?? arc }, vi: locale === "vi" }));
}
export { draft };
