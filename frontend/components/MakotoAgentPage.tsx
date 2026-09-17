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
import { useMakotoAgent, type AgentMessage } from "@/hooks/useMakotoAgent";
import { agentWorkspaceMode } from "@/lib/agent/workspace";
import { blockingExplanation, createAgentPlanningServices } from "@/lib/agent/planning";
import { createOnchainIntelligenceServices } from "@/lib/agent/intelligence/onchain";
import type { AgentIntelligenceResult } from "@/lib/agent/intelligence/types";
import { arcTestnet } from "viem/chains";
import { translate, type Locale, type TranslationKey } from "@/i18n";
import styles from "./MakotoAgentPage.module.css";

export function MakotoAgentPage() {
  const { locale } = usePreferences(), connection = useConnection(), chain = useVerifiedWalletChain();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const planningServices = useMemo(() => createAgentPlanningServices(publicClient), [publicClient]);
  const onchainServices = useMemo(() => createOnchainIntelligenceServices(publicClient), [publicClient]);
  const canRead = connection.isConnected && chain.isArc, balances = useWalletBalances(connection.address, canRead), activity = useWalletActivity(connection.address, canRead, true), ownerJars = useOwnerJars(canRead ? connection.address : undefined), savings = summarizeSavingsJars(ownerJars.jars);
  const snapshot = useMemo(() => createAgentContextSnapshot({ connected: connection.isConnected, account: connection.address, walletType: connection.connector?.name, verifiedChainId: chain.providerChainId, isArc: chain.isArc, balances: { usdc: balances.usdc.data, eurc: balances.eurc.data }, activity: activity.data, activityLoadState: activity.loadState, activityPartial: activity.partial, activityUnavailable: activity.unavailable, vault: { available: canRead && !ownerJars.isLoading && !ownerJars.error, total: canRead ? savings.totalSaved : undefined, goalCount: canRead ? ownerJars.jars.length : undefined, activeCount: canRead ? savings.active : undefined } }), [activity.data, activity.loadState, activity.partial, activity.unavailable, balances.eurc.data, balances.usdc.data, canRead, chain.isArc, chain.providerChainId, connection.address, connection.connector?.name, connection.isConnected, ownerJars.error, ownerJars.isLoading, ownerJars.jars.length, savings.active, savings.totalSaved]);
  const { messages, hasSessionContext, clearConversation, input, setInput, inputRef, ask, submit } = useMakotoAgent(snapshot, locale, connection.address, planningServices, onchainServices);
  return <AppShell><AgentWorkspace locale={locale} account={connection.address} chainId={chain.providerChainId} messages={messages} hasSessionContext={hasSessionContext} clearConversation={clearConversation} input={input} setInput={setInput} inputRef={inputRef} ask={ask} submit={submit} /></AppShell>;
}

/** Presentation seam shared by the live page and isolated browser fixtures. */
export function AgentWorkspace({ locale, account, chainId, messages, hasSessionContext, clearConversation, input, setInput, inputRef, ask, submit }: {
  locale: Locale; account?: AgentDraftContext["account"]; chainId?: number;
  messages: AgentMessage[]; hasSessionContext: boolean; clearConversation: () => void;
  input: string; setInput: (value: string) => void; inputRef: React.RefObject<HTMLInputElement | null>;
  ask: (value: string) => void; submit: (event: React.FormEvent) => void;
}) {
  const t = (key: TranslationKey) => translate(locale, key);
  const replies = messages.filter((message) => message.role === "agent");
  const latest = replies.at(-1);
  const current = { account, chainId };
  const showBoundary = !latest || agentWorkspaceMode(latest.presentation?.intent, Boolean(latest.draft), latest.presentation?.result) === "action";
  return <div className={styles.workspace}>
    <header className={styles.contextHeader}>
      <div><p className={styles.eyebrow}>Makoto Agent</p><h1>{t("agent.workspace.title")}</h1><p>{t("agent.workspace.subtitle")}</p></div>
      <dl><div><dt>{t("agent.workspace.account")}</dt><dd>{account ?? t("agent.page.disconnected")}</dd></div><div><dt>{t("agent.draft.network")}</dt><dd>{chainId === arcTestnet.id ? "Arc Testnet" : chainId === 84532 ? "Base Sepolia" : chainId ?? t("agent.value.unavailable")}</dd></div><div><dt>{t("agent.workspace.mode")}</dt><dd>{t("agent.workspace.prepareOnly")}</dd></div></dl>
    </header>
    <form className={styles.composer} onSubmit={submit}>
      <label htmlFor="agent-question">{t("agent.page.inputLabel")}</label>
      <div><input ref={inputRef} id="agent-question" value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("agent.page.placeholder")} autoComplete="off" /><button type="submit" disabled={!input.trim()}>{t("agent.page.send")}</button></div>
      <details className={styles.suggestions}><summary>{t("agent.page.suggestions")}</summary><div className={styles.prompts}>{(["agent.prompt.balance", "agent.prompt.send", "agent.prompt.swap", "agent.prompt.network"] as const).map((key) => <button key={key} type="button" onClick={() => ask(t(key))}>{t(key)}</button>)}</div></details>
    </form>
    <div className={showBoundary ? styles.operations : styles.readOperations}>
      <div className={styles.operationColumn} aria-live="polite" aria-relevant="additions text">
        {latest ? <AgentOperation key={latest.id} message={latest} locale={locale} current={current} /> : <section className={styles.empty}><h2>{t("agent.workspace.emptyTitle")}</h2><p>{t("agent.workspace.emptyCopy")}</p></section>}
      </div>
      {showBoundary && <aside className={styles.boundary} aria-label={t("agent.workspace.boundary")}><h2>{t("agent.workspace.boundary")}</h2><ol><li><strong>{t("agent.workspace.agentPrepares")}</strong><p>{t("agent.workspace.agentPreparesCopy")}</p></li><li><strong>{t("agent.workspace.reviewChecks")}</strong><p>{t("agent.workspace.reviewChecksCopy")}</p></li><li><strong>{t("agent.workspace.walletConfirms")}</strong><p>{t("agent.workspace.walletConfirmsCopy")}</p></li></ol><p>{t("agent.page.disclosure")}</p></aside>}
    </div>
    <section className={styles.history}><header><h2>{t("agent.workspace.history")}</h2><button type="button" onClick={clearConversation} disabled={!messages.length && !hasSessionContext}>{t("agent.page.clear")}</button></header>
      {replies.length > 1 && <details><summary>{t("agent.workspace.previous")} ({replies.length - 1})</summary>{replies.slice(0, -1).map((message) => <AgentOperation key={message.id} message={message} locale={locale} current={current} />)}</details>}
      {replies.length <= 1 && <p>{t("agent.workspace.historyEmpty")}</p>}
    </section>
  </div>;
}

export function AgentOperation({ message, locale, current }: { message: AgentMessage; locale: Locale; current: AgentDraftContext }) {
  const vi = locale === "vi", t = (key: TranslationKey) => translate(locale, key);
  const mode = agentWorkspaceMode(message.presentation?.intent, Boolean(message.draft), message.presentation?.result);
  const origin = message.draftContext ?? message.presentation?.context;
  const context = assessAgentDraftContext(origin, current);
  const planning = message.presentation?.planning;
  return <article className={styles.operation} data-operation-mode={mode}>
    <header><span className={styles.badge}>{t(`agent.workspace.${mode}`)}</span>{message.presentation?.observedAt !== undefined && <time dateTime={new Date(message.presentation.observedAt).toISOString()}>{new Date(message.presentation.observedAt).toLocaleString(vi ? "vi-VN" : "en-US")}</time>}</header>
    <h2>{t(mode === "result" ? "agent.workspace.resultTitle" : "agent.workspace.intent")}</h2>
    {message.presentation?.request && <p className={styles.request}>{message.presentation.request}</p>}
    {context.status !== "current" && <p className={styles.historicalContext} role="status">{t(context.status === "historical" ? "agent.workspace.historical" : "agent.workspace.originUnknown")}</p>}
    {mode === "action" && <section className={styles.plan}><h3>{t("agent.workspace.plan")}</h3><p>{t("agent.workspace.planCopy")}</p><ol><li>{t("agent.workspace.planIntent")}</li><li>{t("agent.workspace.planReview")}</li><li>{t("agent.workspace.planWallet")}</li></ol></section>}
    <section className={styles.answer}><h3>{t(mode === "result" ? "agent.workspace.reportedResult" : mode === "action" ? "agent.workspace.understanding" : "agent.workspace.answer")}</h3><p>{message.text}</p></section>
    {(mode === "action" || planning || message.intelligence) && <section className={styles.operationEvidence}><h3>{t("agent.workspace.evidence")}</h3>
      <p>{t("agent.workspace.capturedEvidence")}</p>
      {planning && <dl><div><dt>{t("agent.workspace.planningData")}</dt><dd>{t(planning.status === "unavailable" ? "agent.workspace.unavailable" : "agent.workspace.estimated")}{" · "}{t(planning.completeness === "complete" ? "agent.workspace.complete" : "agent.workspace.incomplete")}</dd></div><div><dt>{t("agent.workspace.asOf")}</dt><dd><time dateTime={new Date(planning.dataTimestamp).toISOString()}>{new Date(planning.dataTimestamp).toLocaleString(vi ? "vi-VN" : "en-US")}</time></dd></div></dl>}
      {!planning && !message.intelligence && <p>{t("agent.workspace.noEvidence")}</p>}
      {planning && planning.blockingReasons.length > 0 && <ul>{planning.blockingReasons.map((reason) => <li key={reason}>{blockingExplanation(reason, vi)}</li>)}</ul>}
      {planning?.refreshRequired && <p>{t("agent.workspace.refreshRequired")}</p>}
      {message.intelligence && <EvidenceBlock value={message.intelligence} locale={locale} />}
    </section>}
    {message.draft && <ActionDraftCard draft={message.draft} draftContext={message.draftContext} vi={vi} />}
    {mode === "action" && !message.draft && <p className={styles.historicalContext}>{t("agent.workspace.noDraft")}</p>}
    {mode === "result" && <p className={styles.resultBoundary}>{t("agent.workspace.resultBoundary")}</p>}
  </article>;
}
export function EvidenceBlock({ value, locale }: { value: AgentIntelligenceResult; locale: Locale }) {
  const statusLabel = value.status === "SOURCE_ERROR" ? "agent.intelligence.attemptedCheck" : value.status === "UNVERIFIED" ? "agent.intelligence.sourceStatus" : "agent.intelligence.checked";
  return <section className={styles.evidence} aria-label={translate(locale, "agent.intelligence.sources")}><div><strong>{translate(locale, statusLabel)}</strong><time dateTime={new Date(value.fetchedAt).toISOString()}>{new Date(value.fetchedAt).toLocaleString(locale === "vi" ? "vi-VN" : "en-US")}</time></div><p>{translate(locale, `agent.workspace.evidence.${value.status}`)}</p><strong>{translate(locale, "agent.intelligence.sources")}</strong><ul>{value.sources.map((source) => <li key={source.id}><a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.title}</a><small>{source.publisher} · {translate(locale, `agent.intelligence.trust.${source.sourceType}` as TranslationKey)}</small></li>)}</ul>{value.limitations.length > 0 && <p><strong>{translate(locale, "agent.intelligence.limitation")}</strong> {translate(locale, "agent.intelligence.limitCopy")}</p>}</section>;
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
  return <section className={styles.draft} data-context-status={context.status} aria-label={translate(locale, "agent.draft.aria")}><header><strong>{translate(locale, "agent.draft.title")}</strong><span className={context.status !== "current" && validation.valid ? styles.historicalStatus : undefined}>{translate(locale, statusKey)}</span></header><dl><div><dt>{translate(locale, "agent.draft.action")}</dt><dd>{translate(locale, labelKeys[draft.kind])}</dd></div><div><dt>{translate(locale, "agent.draft.amount")}</dt><dd>{`${draft.amount} ${asset}`}{outputAsset ? ` → ${outputAsset}` : ""}</dd></div>{recipient && <div><dt>{translate(locale, "agent.draft.recipient")}</dt><dd className={styles.longValue}>{recipient}</dd></div>}<div><dt>{translate(locale, "agent.draft.network")}</dt><dd>{sourceChain}{destinationChain ? ` → ${destinationChain}` : ""}</dd></div><div><dt>{translate(locale, "agent.workspace.originAccount")}</dt><dd className={styles.longValue}>{draftContext?.account ?? translate(locale, "agent.value.unavailable")}</dd></div><div><dt>{translate(locale, "agent.workspace.originNetwork")}</dt><dd>{draftContext?.chainId ?? translate(locale, "agent.value.unavailable")}</dd></div>{missingLabels.length > 0 && <div><dt>{translate(locale, "agent.draft.missingLabel")}</dt><dd>{missingLabels.join(", ")}</dd></div>}{errorLabels.length > 0 && <div><dt>{translate(locale, "agent.draft.blockedLabel")}</dt><dd>{errorLabels.join(", ")}</dd></div>}</dl><div className={styles.draftBoundary}><strong>{translate(locale, "agent.workspace.safety")}</strong><p>{translate(locale, "agent.workspace.draftBoundary")}</p></div><p>{translate(locale, "agent.draft.helper")}</p>{contextHelpKey && <p id={contextHelpId} className={styles.historicalContext} role="status">{translate(locale, contextHelpKey)}</p>}<button type="button" className={styles.prepareButton} onClick={prepare} disabled={!canPrepare} aria-describedby={describedBy}>{translate(locale, prepareKey)}</button>{!validation.valid && <small id={helpId}>{translate(locale, "agent.draft.disabled")}</small>}{validation.valid && !connection.address && <small id={helpId}>{translate(locale, "agent.draft.waitingForWallet")}</small>}</section>;
}

function validationFieldLabel(field: string, locale: Locale) { const keys: Record<string, TranslationKey> = { draft: "agent.field.draft", amount: "agent.field.amount", asset: "agent.field.asset", outputAsset: "agent.field.outputAsset", recipient: "agent.field.recipient", sourceChain: "agent.field.sourceChain", destinationChain: "agent.field.destinationChain" }; return keys[field] ? translate(locale, keys[field]) : field; }
