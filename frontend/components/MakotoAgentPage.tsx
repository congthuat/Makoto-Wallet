"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useConnection, usePublicClient } from "wagmi";
import { AppShell } from "./AppShell";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { createAgentContextSnapshot } from "@/lib/agent/context";
import { handoffUrl, prepareAgentActionHandoff, storeAgentHandoff, validateAgentActionDraft } from "@/lib/agent/actions";
import type { AgentActionDraft, AgentDraftContext } from "@/lib/agent/types";
import { assessAgentDraftContext } from "@/lib/agent/draftContext";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import { useMakotoAgent } from "@/hooks/useMakotoAgent";
import { createAgentPlanningServices } from "@/lib/agent/planning";
import { createOnchainIntelligenceServices } from "@/lib/agent/intelligence/onchain";
import type { AgentIntelligenceResult } from "@/lib/agent/intelligence/types";
import { arcTestnet } from "viem/chains";
import { translate, type Locale, type TranslationKey } from "@/i18n";
import styles from "./MakotoAgentPage.module.css";

export function MakotoAgentPage() {
  const { locale } = usePreferences(), vi = locale === "vi", connection = useConnection(), chain = useVerifiedWalletChain();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const planningServices = useMemo(() => createAgentPlanningServices(publicClient), [publicClient]);
  const onchainServices = useMemo(() => createOnchainIntelligenceServices(publicClient), [publicClient]);
  const canRead = connection.isConnected && chain.isArc, balances = useWalletBalances(connection.address, canRead), activity = useWalletActivity(connection.address, canRead, true), ownerJars = useOwnerJars(canRead ? connection.address : undefined), savings = summarizeSavingsJars(ownerJars.jars);
  const snapshot = useMemo(() => createAgentContextSnapshot({ connected: connection.isConnected, account: connection.address, walletType: connection.connector?.name, verifiedChainId: chain.providerChainId, isArc: chain.isArc, balances: { usdc: balances.usdc.data, eurc: balances.eurc.data }, activity: activity.data, activityLoadState: activity.loadState, activityPartial: activity.partial, activityUnavailable: activity.unavailable, vault: { available: canRead && !ownerJars.isLoading && !ownerJars.error, total: canRead ? savings.totalSaved : undefined, goalCount: canRead ? ownerJars.jars.length : undefined, activeCount: canRead ? savings.active : undefined } }), [activity.data, activity.loadState, activity.partial, activity.unavailable, balances.eurc.data, balances.usdc.data, canRead, chain.isArc, chain.providerChainId, connection.address, connection.connector?.name, connection.isConnected, ownerJars.error, ownerJars.isLoading, ownerJars.jars.length, savings.active, savings.totalSaved]);
  const { messages, hasSessionContext, clearConversation, input, setInput, inputRef, ask, submit } = useMakotoAgent(snapshot, locale, connection.address, planningServices, onchainServices);
  const prompts = (["agent.prompt.balance", "agent.prompt.send", "agent.prompt.swap", "agent.prompt.network"] as const).map((key) => translate(locale, key));
  return <AppShell>
    <section className={styles.hero}><div><span>MAKOTO AGENT</span><h1>{translate(locale, "agent.page.title")}</h1><p>{translate(locale, "agent.page.subtitle")}</p></div><strong>{translate(locale, "agent.page.confirmation")}</strong></section>
    <section className={styles.disclosure} role="note">{translate(locale, "agent.page.disclosure")}</section>
    <section className={styles.chat} aria-labelledby="agent-conversation"><header><div><h2 id="agent-conversation">{translate(locale, "agent.page.conversation")}</h2><span>{connection.isConnected ? (chain.isArc ? "Arc Testnet" : translate(locale, "agent.page.wrongNetwork")) : translate(locale, "agent.page.disconnected")}</span></div><button type="button" onClick={clearConversation} disabled={!messages.length && !hasSessionContext}>{translate(locale, "agent.page.clear")}</button></header>
      <div className={styles.messages} aria-live="polite" aria-relevant="additions text">{messages.length === 0 ? <div className={styles.empty}><strong>{translate(locale, "agent.page.emptyTitle")}</strong><p>{translate(locale, "agent.page.emptyCopy")}</p></div> : messages.map((message) => <article key={message.id} className={message.role === "user" ? styles.userMessage : styles.agentMessage}><span>{message.role === "user" ? translate(locale, "agent.page.you") : "Makoto Agent"}</span><p>{message.text}</p>{message.intelligence && <EvidenceBlock value={message.intelligence} locale={locale} />}{message.draft && <ActionDraftCard draft={message.draft} draftContext={message.draftContext} vi={vi} />}</article>)}</div>
      <div className={styles.prompts} role="group" aria-label={translate(locale, "agent.page.suggestions")}>{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>)}</div>
      <form className={styles.composer} onSubmit={submit}><label htmlFor="agent-question">{translate(locale, "agent.page.inputLabel")}</label><div><input ref={inputRef} id="agent-question" value={input} onChange={(event) => setInput(event.target.value)} placeholder={translate(locale, "agent.page.placeholder")} autoComplete="off" /><button type="submit" disabled={!input.trim()}>{translate(locale, "agent.page.send")}</button></div></form>
    </section>
  </AppShell>;
}
export function EvidenceBlock({ value, locale }: { value: AgentIntelligenceResult; locale: Locale }) {
  const statusLabel = value.status === "SOURCE_ERROR" ? "agent.intelligence.attemptedCheck" : value.status === "UNVERIFIED" ? "agent.intelligence.sourceStatus" : "agent.intelligence.checked";
  return <section className={styles.evidence} aria-label={translate(locale, "agent.intelligence.sources")}><div><strong>{translate(locale, statusLabel)}</strong><time dateTime={new Date(value.fetchedAt).toISOString()}>{new Date(value.fetchedAt).toLocaleString(locale === "vi" ? "vi-VN" : "en-US")}</time></div><strong>{translate(locale, "agent.intelligence.sources")}</strong><ul>{value.sources.map((source) => <li key={source.id}><a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.title}</a><small>{source.publisher} · {translate(locale, `agent.intelligence.trust.${source.sourceType}` as TranslationKey)}</small></li>)}</ul>{value.limitations.length > 0 && <p><strong>{translate(locale, "agent.intelligence.limitation")}</strong> {translate(locale, "agent.intelligence.limitCopy")}</p>}</section>;
}
export function ActionDraftCard({ draft, draftContext, vi }: { draft: AgentActionDraft; draftContext?: AgentDraftContext; vi: boolean }) {
  const locale: Locale = vi ? "vi" : "en";
  const connection = useConnection();
  const chain = useVerifiedWalletChain();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preparing, setPreparing] = useState(false);
  const [handoffRequestId, setHandoffRequestId] = useState<string>();
  const progressRef = useRef<HTMLParagraphElement>(null);
  const validation = validateAgentActionDraft(draft), context = assessAgentDraftContext(draftContext, { account: connection.address, chainId: chain.providerChainId }), labelKeys: Record<AgentActionDraft["kind"], TranslationKey> = { send: "agent.draft.send", swap: "agent.draft.swap", bridge: "agent.draft.bridge", "vault-deposit": "agent.draft.vaultDeposit", "vault-withdraw": "agent.draft.vaultWithdraw" };
  const asset = draft.kind === "swap" ? draft.inputAsset : draft.asset;
  const outputAsset = draft.kind === "swap" ? draft.outputAsset : undefined;
  const recipient = draft.kind === "send" || draft.kind === "bridge" ? draft.recipient : undefined;
  const sourceChain = draft.kind === "send" || draft.kind === "swap" || draft.kind === "bridge" ? draft.sourceChain : "Arc Testnet";
  const destinationChain = draft.kind === "bridge" ? draft.destinationChain : undefined;
  const helpId = `agent-draft-help-${draft.rawUserText.length}`;
  // The URL query is the completion signal for same-path handoff navigation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (preparing && handoffRequestId && searchParams.get("agentHandoff") === handoffRequestId) setPreparing(false); }, [handoffRequestId, preparing, searchParams]);
  function prepare() { const prepared = prepareAgentActionHandoff(draft, connection.address); if (prepared.handoff) { setPreparing(true); setHandoffRequestId(prepared.handoff.id); storeAgentHandoff(window.sessionStorage, prepared.handoff); window.requestAnimationFrame(() => { progressRef.current?.focus(); router.push(handoffUrl(prepared.handoff!)); }); } }
  if (preparing) return <section className={styles.draft}><header><strong>{translate(locale, "agent.draft.preparing")}</strong><span>{translate(locale, "agent.draft.openingReview")}</span></header><p ref={progressRef} tabIndex={-1} role="status" aria-live="polite">{translate(locale, "agent.draft.openingReview")}</p></section>;
  const missingLabels = validation.missingFields.map((field) => validationFieldLabel(field, locale));
  const errorLabels = validation.errors.map((error) => error.startsWith("MAX") ? translate(locale, "agent.draft.maxBlocked") : validationFieldLabel(error, locale));
  const contextKey = context.status === "current" ? "agent.draft.ready" : context.status === "historical" ? "agent.draft.historical" : "agent.draft.contextUnknown";
  const contextHelpKey = context.status === "current" ? undefined : context.status === "historical" ? "agent.draft.historicalHelp" : "agent.draft.contextUnknownHelp";
  const statusKey = validation.valid ? contextKey : validation.missingFields.length ? "agent.draft.missing" : "agent.draft.blocked";
  const canPrepare = validation.valid && connection.address !== undefined;
  const prepareKey = context.status === "current" ? "agent.draft.review" : "agent.draft.prepareCurrent";
  const contextHelpId = `${helpId}-context`;
  const describedBy = [!validation.valid ? helpId : undefined, contextHelpKey ? contextHelpId : undefined].filter(Boolean).join(" ") || undefined;
  return <section className={styles.draft} data-context-status={context.status} aria-label={translate(locale, "agent.draft.aria")}><header><strong>{translate(locale, "agent.draft.title")}</strong><span className={context.status !== "current" && validation.valid ? styles.historicalStatus : undefined}>{translate(locale, statusKey)}</span></header><dl><div><dt>{translate(locale, "agent.draft.action")}</dt><dd>{translate(locale, labelKeys[draft.kind])}</dd></div><div><dt>{translate(locale, "agent.draft.amount")}</dt><dd>{`${draft.amount} ${asset}`}{outputAsset ? ` → ${outputAsset}` : ""}</dd></div>{recipient && <div><dt>{translate(locale, "agent.draft.recipient")}</dt><dd className={styles.longValue}>{recipient}</dd></div>}<div><dt>{translate(locale, "agent.draft.network")}</dt><dd>{sourceChain}{destinationChain ? ` → ${destinationChain}` : ""}</dd></div>{missingLabels.length > 0 && <div><dt>{translate(locale, "agent.draft.missingLabel")}</dt><dd>{missingLabels.join(", ")}</dd></div>}{errorLabels.length > 0 && <div><dt>{translate(locale, "agent.draft.blockedLabel")}</dt><dd>{errorLabels.join(", ")}</dd></div>}</dl><p>{translate(locale, "agent.draft.helper")}</p>{contextHelpKey && <p id={contextHelpId} className={styles.historicalContext} role="status">{translate(locale, contextHelpKey)}</p>}<button type="button" className={styles.prepareButton} onClick={prepare} disabled={!canPrepare} aria-describedby={describedBy}>{translate(locale, prepareKey)}</button>{!validation.valid && <small id={helpId}>{translate(locale, "agent.draft.disabled")}</small>}{validation.valid && !connection.address && <small id={helpId}>{translate(locale, "agent.draft.waitingForWallet")}</small>}</section>;
}

function validationFieldLabel(field: string, locale: Locale) { const keys: Record<string, TranslationKey> = { draft: "agent.field.draft", amount: "agent.field.amount", asset: "agent.field.asset", outputAsset: "agent.field.outputAsset", recipient: "agent.field.recipient", sourceChain: "agent.field.sourceChain", destinationChain: "agent.field.destinationChain" }; return keys[field] ? translate(locale, keys[field]) : field; }
