"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { usePublicClient } from "wagmi";
import { AppShell } from "./AppShell";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useWalletReadContext } from "@/hooks/useWalletAccount";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { createAgentContextSnapshot } from "@/lib/agent/context";
import { handoffUrl, prepareAgentActionHandoff, storeAgentHandoff, validateAgentActionDraft, type AgentActionHandoff } from "@/lib/agent/actions";
import type { AgentActionDraft, AgentDraftContext } from "@/lib/agent/types";
import { assessAgentDraftContext } from "@/lib/agent/draftContext";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import { useMakotoAgent, type AgentMessage } from "@/hooks/useMakotoAgent";
import { agentWorkspaceMode } from "@/lib/agent/workspace";
import { blockingExplanation } from "@/lib/agent/planning";
import { createAgentReadServices, createQuoteServices } from "@/lib/agent/quoteProviders";
import { createOnchainIntelligenceServices } from "@/lib/agent/intelligence/onchain";
import type { AgentIntelligenceResult } from "@/lib/agent/intelligence/types";
import { arcTestnet } from "viem/chains";
import { translate, type Locale, type TranslationKey } from "@/i18n";
import { agentSuggestionGroups } from "@/lib/agent/suggestionCatalog";
import styles from "./MakotoAgentPage.module.css";
import { PolicyDecisionNotice } from "./PolicyDecisionNotice";

export function MakotoAgentPage() {
  const { locale } = usePreferences(), wallet = useWalletReadContext();
  const publicClient = usePublicClient({ chainId: arcTestnet.id });
  const canonicalServices = useMemo(() => publicClient ? { reads: createAgentReadServices(publicClient), services: createQuoteServices(publicClient) } : undefined, [publicClient]);
  const onchainServices = useMemo(() => createOnchainIntelligenceServices(publicClient), [publicClient]);
  const canRead = wallet.status === "connected" && wallet.isArc, balances = useWalletBalances(wallet.address, canRead), activity = useWalletActivity(wallet.address, canRead, true), ownerJars = useOwnerJars(canRead ? wallet.address : undefined), savings = summarizeSavingsJars(ownerJars.jars);
  const snapshot = useMemo(() => createAgentContextSnapshot({ connected: wallet.status === "connected", account: wallet.address, walletType: wallet.providerName, accountKind: wallet.kind, walletStatus: wallet.status, verifiedChainId: wallet.providerChainId, isArc: wallet.isArc, balances: { usdc: balances.usdc.data, eurc: balances.eurc.data, cirbtc: balances.cirbtc.data }, activity: activity.data, activityLoadState: activity.loadState, activityPartial: activity.partial, activityUnavailable: activity.unavailable, vault: { available: canRead && !ownerJars.isLoading && !ownerJars.error, total: canRead ? savings.totalSaved : undefined, goalCount: canRead ? ownerJars.jars.length : undefined, activeCount: canRead ? savings.active : undefined } }), [activity.data, activity.loadState, activity.partial, activity.unavailable, balances.cirbtc.data, balances.eurc.data, balances.usdc.data, canRead, ownerJars.error, ownerJars.isLoading, ownerJars.jars.length, savings.active, savings.totalSaved, wallet.address, wallet.isArc, wallet.kind, wallet.providerChainId, wallet.providerName, wallet.status]);
  const { messages, hasSessionContext, clearConversation, input, setInput, inputRef, submit } = useMakotoAgent(snapshot, locale, wallet.address, onchainServices, canonicalServices);
  return <AppShell><AgentWorkspace locale={locale} account={wallet.address} chainId={wallet.providerChainId} messages={messages} hasSessionContext={hasSessionContext} clearConversation={clearConversation} input={input} setInput={setInput} inputRef={inputRef} submit={submit} /></AppShell>;
}

/** Presentation seam shared by the live page and isolated browser fixtures. */
export function AgentWorkspace({ locale, account, chainId, messages, hasSessionContext, clearConversation, input, setInput, inputRef, submit }: {
  locale: Locale; account?: AgentDraftContext["account"]; chainId?: number;
  messages: AgentMessage[]; hasSessionContext: boolean; clearConversation: () => void;
  input: string; setInput: (value: string) => void; inputRef: React.RefObject<HTMLInputElement | null>;
  submit: (event: React.FormEvent) => void;
}) {
  const t = (key: TranslationKey) => translate(locale, key);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const suggestionWrapRef = useRef<HTMLDivElement>(null);
  const suggestionTriggerRef = useRef<HTMLButtonElement>(null);
  const replies = messages.filter((message) => message.role === "agent");
  const latest = replies.at(-1);
  const current = { account, chainId };
  const allSuggestions = agentSuggestionGroups.reduce<Array<{ id: string; promptKey: TranslationKey }>>((items, group) => [...items, ...group.suggestions], []);
  const starterSuggestionIds = ["wallet-balances", "activity-recent", "prepare-send-small", "explain-bridge-status"];
  const starterSuggestions = starterSuggestionIds.map((id) => allSuggestions.find((suggestion) => suggestion.id === id)).filter((suggestion): suggestion is { id: string; promptKey: TranslationKey } => Boolean(suggestion));
  const networkLabel = chainId === arcTestnet.id ? "Arc Testnet" : chainId === 84532 ? "Base Sepolia" : chainId ?? t("agent.value.unavailable");
  const accountLabel = account ? `${account.slice(0, 6)}…${account.slice(-4)}` : t("agent.page.disconnected");

  useEffect(() => {
    if (!suggestionsOpen) return;
    function dismiss(event: PointerEvent) {
      if (!suggestionWrapRef.current?.contains(event.target as Node)) setSuggestionsOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setSuggestionsOpen(false);
      suggestionTriggerRef.current?.focus({ preventScroll: true });
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [suggestionsOpen]);

  function selectSuggestion(promptKey: TranslationKey) {
    setInput(t(promptKey));
    setSuggestionsOpen(false);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  return <div className={`${styles.workspace} ${locale === "vi" ? styles.vietnameseWorkspace : ""}`}>
    <header className={styles.contextHeader}>
      <div className={styles.heroCopy}><h1>{t("agent.workspace.title")}</h1><p>{t("agent.workspace.subtitle")}</p></div>
    </header>
    <div className={styles.workspaceGrid}>
      <section className={styles.conversation} aria-labelledby="agent-conversation-title">
        <h2 id="agent-conversation-title" className={styles.conversationTitle}>{t("agent.page.conversation")}</h2>
        <div className={styles.conversationFeed} aria-live="polite" aria-relevant="additions text">
          {latest ? <AgentOperation key={latest.id} message={latest} locale={locale} current={current} /> : <section className={styles.empty}><h2>{t("agent.workspace.emptyTitle")}</h2><p>{t("agent.workspace.emptyCopy")}</p><div className={styles.starterPrompts}>{starterSuggestions.map((suggestion) => <button key={suggestion.id} type="button" onClick={() => selectSuggestion(suggestion.promptKey)}>{t(suggestion.promptKey)}</button>)}</div></section>}
        </div>
        <form className={styles.composer} onSubmit={submit}>
          <label className={styles.srOnly} htmlFor="agent-question">{t("agent.page.inputLabel")}</label>
          <div className={styles.composerRow}>
            <div className={styles.suggestionWrap} ref={suggestionWrapRef}>
              <button ref={suggestionTriggerRef} className={styles.suggestionTrigger} type="button" aria-expanded={suggestionsOpen} aria-haspopup="dialog" aria-controls="agent-suggestion-panel" onClick={() => setSuggestionsOpen((open) => !open)}>{t("agent.page.suggestions")}</button>
              {suggestionsOpen && <div id="agent-suggestion-panel" className={styles.suggestionPanel} role="dialog" aria-label={t("agent.page.suggestions")}>
                <div className={styles.suggestionPanelHeader}><strong>{t("agent.page.suggestions")}</strong><span>{allSuggestions.length}</span></div>
                <div className={styles.suggestionList}>{agentSuggestionGroups.map((group) => <section key={group.id}><h3>{t(group.labelKey)}</h3><div>{group.suggestions.map((suggestion) => <button key={suggestion.id} type="button" onClick={() => selectSuggestion(suggestion.promptKey)}>{t(suggestion.promptKey)}</button>)}</div></section>)}</div>
              </div>}
            </div>
            <input ref={inputRef} id="agent-question" value={input} onChange={(event) => setInput(event.target.value)} placeholder={t("agent.page.placeholder")} autoComplete="off" />
            <button className={styles.sendButton} type="submit" disabled={!input.trim()}>{t("agent.page.send")}</button>
          </div>
        </form>
      </section>
      <aside className={styles.contextRail} aria-label={t("agent.workspace.boundary")}>
        <section className={styles.railStatus}><h2>{t("agent.workspace.wallet")}</h2><dl><div><dt>{t("agent.workspace.wallet")}</dt><dd className={styles.accountValue} title={account}>{accountLabel}</dd></div><div><dt>{t("agent.draft.network")}</dt><dd>{networkLabel}</dd></div><div><dt>{t("agent.workspace.mode")}</dt><dd className={styles.modeValue}>{t("agent.workspace.prepareOnly")}</dd></div></dl></section>
        <section className={styles.boundary}><h2>{t("agent.workspace.boundary")}</h2><ol className={styles.boundarySteps}><li><strong>{t("agent.workspace.agentPrepares")}</strong></li><li><strong>{t("agent.workspace.reviewChecks")}</strong></li><li><strong>{t("agent.workspace.walletConfirms")}</strong></li></ol><p>{t("agent.page.disclosure")}</p></section>
        <details className={styles.history}><summary><span>{t("agent.workspace.history")}</span><small>{replies.length}</small></summary><div className={styles.historyBody}><button type="button" onClick={clearConversation} disabled={!messages.length && !hasSessionContext}>{t("agent.page.clear")}</button>{replies.length > 1 ? <details><summary>{t("agent.workspace.previous")} ({replies.length - 1})</summary>{replies.slice(0, -1).map((message) => <AgentOperation key={message.id} message={message} locale={locale} current={current} />)}</details> : <p>{t("agent.workspace.historyEmpty")}</p>}</div></details>
      </aside>
    </div>
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
    {(mode === "action" || planning || message.intelligence || message.quote || message.prepared || message.policy) && <section className={styles.operationEvidence}><h3>{t("agent.workspace.evidence")}</h3>
      <p>{t("agent.workspace.capturedEvidence")}</p>
      {message.policy && <PolicyDecisionNotice result={message.policy} locale={locale} />}
      {planning && <dl><div><dt>{t("agent.workspace.planningData")}</dt><dd>{t(planning.status === "unavailable" ? "agent.workspace.unavailable" : "agent.workspace.estimated")}{" · "}{t(planning.completeness === "complete" ? "agent.workspace.complete" : "agent.workspace.incomplete")}</dd></div><div><dt>{t("agent.workspace.asOf")}</dt><dd><time dateTime={new Date(planning.dataTimestamp).toISOString()}>{new Date(planning.dataTimestamp).toLocaleString(vi ? "vi-VN" : "en-US")}</time></dd></div></dl>}
      {message.quote && <dl><div><dt>{t("agent.workspace.quoteEvidence")}</dt><dd>{message.quote.provider} · {message.quote.status}</dd></div><div><dt>{t("agent.workspace.asOf")}</dt><dd><time dateTime={new Date(message.quote.observedAt).toISOString()}>{new Date(message.quote.observedAt).toLocaleString(vi ? "vi-VN" : "en-US")}</time></dd></div></dl>}
      {message.prepared?.status === "PREPARED" && <dl><div><dt>{t("agent.workspace.preparedEvidence")}</dt><dd>{message.prepared.data.provider}</dd></div><div><dt>{t("agent.workspace.expiresAt")}</dt><dd><time dateTime={new Date(message.prepared.data.expiresAt).toISOString()}>{new Date(message.prepared.data.expiresAt).toLocaleString(vi ? "vi-VN" : "en-US")}</time></dd></div></dl>}
      {!planning && !message.intelligence && !message.quote && !message.prepared && <p>{t("agent.workspace.noEvidence")}</p>}
      {planning && planning.blockingReasons.length > 0 && <ul>{planning.blockingReasons.map((reason) => <li key={reason}>{blockingExplanation(reason, vi)}</li>)}</ul>}
      {planning?.refreshRequired && <p>{t("agent.workspace.refreshRequired")}</p>}
      {message.intelligence && <EvidenceBlock value={message.intelligence} locale={locale} />}
    </section>}
    {message.draft && <ActionDraftCard draft={message.draft} draftContext={message.draftContext} handoff={message.prepared?.status === "PREPARED" ? message.prepared.data.handoff : undefined} vi={vi} />}
    {mode === "action" && !message.draft && <p className={styles.historicalContext}>{t("agent.workspace.noDraft")}</p>}
    {mode === "result" && <p className={styles.resultBoundary}>{t("agent.workspace.resultBoundary")}</p>}
  </article>;
}
export function EvidenceBlock({ value, locale }: { value: AgentIntelligenceResult; locale: Locale }) {
  const statusLabel = value.status === "SOURCE_ERROR" ? "agent.intelligence.attemptedCheck" : value.status === "UNVERIFIED" ? "agent.intelligence.sourceStatus" : "agent.intelligence.checked";
  return <section className={styles.evidence} aria-label={translate(locale, "agent.intelligence.sources")}><div><strong>{translate(locale, statusLabel)}</strong><time dateTime={new Date(value.fetchedAt).toISOString()}>{new Date(value.fetchedAt).toLocaleString(locale === "vi" ? "vi-VN" : "en-US")}</time></div><p>{translate(locale, `agent.workspace.evidence.${value.status}`)}</p><strong>{translate(locale, "agent.intelligence.sources")}</strong><ul>{value.sources.map((source) => <li key={source.id}><a href={source.canonicalUrl} target="_blank" rel="noreferrer">{source.title}</a><small>{source.publisher} · {translate(locale, `agent.intelligence.trust.${source.sourceType}` as TranslationKey)}</small></li>)}</ul>{value.limitations.length > 0 && <p><strong>{translate(locale, "agent.intelligence.limitation")}</strong> {translate(locale, "agent.intelligence.limitCopy")}</p>}</section>;
}
export function ActionDraftCard({ draft, draftContext, handoff, vi }: { draft: AgentActionDraft; draftContext?: AgentDraftContext; handoff?: AgentActionHandoff; vi: boolean }) {
  const locale: Locale = vi ? "vi" : "en";
  const wallet = useWalletReadContext();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [preparing, setPreparing] = useState(false);
  const [handoffRequestId, setHandoffRequestId] = useState<string>();
  const progressRef = useRef<HTMLParagraphElement>(null);
  const validation = validateAgentActionDraft(draft), context = assessAgentDraftContext(draftContext, { account: wallet.address, chainId: wallet.providerChainId }), labelKeys: Record<AgentActionDraft["kind"], TranslationKey> = { send: "agent.draft.send", swap: "agent.draft.swap", bridge: "agent.draft.bridge", "vault-deposit": "agent.draft.vaultDeposit", "vault-withdraw": "agent.draft.vaultWithdraw" };
  const asset = draft.kind === "swap" ? draft.inputAsset : draft.asset;
  const outputAsset = draft.kind === "swap" ? draft.outputAsset : undefined;
  const recipient = draft.kind === "send" || draft.kind === "bridge" ? draft.recipient : undefined;
  const sourceChain = draft.kind === "send" || draft.kind === "swap" || draft.kind === "bridge" ? draft.sourceChain : "Arc Testnet";
  const destinationChain = draft.kind === "bridge" ? draft.destinationChain : undefined;
  const helpId = `agent-draft-help-${draft.rawUserText.length}`;
  // The URL query is the completion signal for same-path handoff navigation.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (preparing && handoffRequestId && searchParams.get("agentHandoff") === handoffRequestId) setPreparing(false); }, [handoffRequestId, preparing, searchParams]);
  function prepare() { const selected = handoff ?? prepareAgentActionHandoff(draft, wallet.address).handoff; if (selected && selected.expiresAt > Date.now() && selected.account.toLowerCase() === wallet.address?.toLowerCase()) { setPreparing(true); setHandoffRequestId(selected.id); storeAgentHandoff(window.sessionStorage, selected); window.requestAnimationFrame(() => { progressRef.current?.focus(); router.push(handoffUrl(selected)); }); } }
  if (preparing) return <section className={styles.draft}><header><strong>{translate(locale, "agent.draft.preparing")}</strong><span>{translate(locale, "agent.draft.openingReview")}</span></header><p ref={progressRef} tabIndex={-1} role="status" aria-live="polite">{translate(locale, "agent.draft.openingReview")}</p></section>;
  const missingLabels = validation.missingFields.map((field) => validationFieldLabel(field, locale));
  const errorLabels = validation.errors.map((error) => error.startsWith("MAX") ? translate(locale, "agent.draft.maxBlocked") : validationFieldLabel(error, locale));
  const contextKey = context.status === "current" ? "agent.draft.ready" : context.status === "historical" ? "agent.draft.historical" : "agent.draft.contextUnknown";
  const contextHelpKey = context.status === "current" ? undefined : context.status === "historical" ? "agent.draft.historicalHelp" : "agent.draft.contextUnknownHelp";
  const statusKey = validation.valid ? contextKey : validation.missingFields.length ? "agent.draft.missing" : "agent.draft.blocked";
  const localActionSupported = wallet.kind !== "local" || draft.kind === "send" || draft.kind === "swap";
  const canPrepare = validation.valid && wallet.address !== undefined && localActionSupported;
  const prepareKey = context.status === "current" ? "agent.draft.review" : "agent.draft.prepareCurrent";
  const contextHelpId = `${helpId}-context`;
  const describedBy = [!validation.valid ? helpId : undefined, contextHelpKey ? contextHelpId : undefined].filter(Boolean).join(" ") || undefined;
  return <section className={styles.draft} data-context-status={context.status} aria-label={translate(locale, "agent.draft.aria")}><header><strong>{translate(locale, "agent.draft.title")}</strong><span className={context.status !== "current" && validation.valid ? styles.historicalStatus : undefined}>{translate(locale, statusKey)}</span></header><dl><div><dt>{translate(locale, "agent.draft.action")}</dt><dd>{translate(locale, labelKeys[draft.kind])}</dd></div><div><dt>{translate(locale, "agent.draft.amount")}</dt><dd>{`${draft.amount} ${asset}`}{outputAsset ? ` → ${outputAsset}` : ""}</dd></div>{recipient && <div><dt>{translate(locale, "agent.draft.recipient")}</dt><dd className={styles.longValue}>{recipient}</dd></div>}<div><dt>{translate(locale, "agent.draft.network")}</dt><dd>{sourceChain}{destinationChain ? ` → ${destinationChain}` : ""}</dd></div><div><dt>{translate(locale, "agent.workspace.originAccount")}</dt><dd className={styles.longValue}>{draftContext?.account ?? translate(locale, "agent.value.unavailable")}</dd></div><div><dt>{translate(locale, "agent.workspace.originNetwork")}</dt><dd>{draftContext?.chainId ?? translate(locale, "agent.value.unavailable")}</dd></div>{missingLabels.length > 0 && <div><dt>{translate(locale, "agent.draft.missingLabel")}</dt><dd>{missingLabels.join(", ")}</dd></div>}{errorLabels.length > 0 && <div><dt>{translate(locale, "agent.draft.blockedLabel")}</dt><dd>{errorLabels.join(", ")}</dd></div>}</dl><div className={styles.draftBoundary}><strong>{translate(locale, "agent.workspace.safety")}</strong><p>{translate(locale, "agent.workspace.draftBoundary")}</p></div><p>{translate(locale, "agent.draft.helper")}</p>{!localActionSupported && <p className={styles.historicalContext} role="status">{vi ? "Ví cục bộ chưa hỗ trợ chuyển tiếp Bridge từ Agent." : "Local wallet Bridge handoff is unavailable."}</p>}{contextHelpKey && <p id={contextHelpId} className={styles.historicalContext} role="status">{translate(locale, contextHelpKey)}</p>}<button type="button" className={styles.prepareButton} onClick={prepare} disabled={!canPrepare} aria-describedby={describedBy}>{translate(locale, prepareKey)}</button>{!validation.valid && <small id={helpId}>{translate(locale, "agent.draft.disabled")}</small>}{validation.valid && !wallet.address && <small id={helpId}>{translate(locale, "agent.draft.waitingForWallet")}</small>}</section>;
}

function validationFieldLabel(field: string, locale: Locale) { const keys: Record<string, TranslationKey> = { draft: "agent.field.draft", amount: "agent.field.amount", asset: "agent.field.asset", outputAsset: "agent.field.outputAsset", recipient: "agent.field.recipient", sourceChain: "agent.field.sourceChain", destinationChain: "agent.field.destinationChain" }; return keys[field] ? translate(locale, keys[field]) : field; }
