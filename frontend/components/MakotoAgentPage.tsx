"use client";

import { useMemo, useRef, useState, type FormEvent } from "react";
import { useConnection } from "wagmi";
import { AppHeader } from "./AppHeader";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { createAgentContextSnapshot } from "@/lib/agent/context";
import { answerAgentRequest } from "@/lib/agent/planner";
import type { AgentActionDraft, AgentResponse } from "@/lib/agent/types";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import styles from "./MakotoAgentPage.module.css";

type Message = { id: number; role: "user" | "agent"; text: string; draft?: AgentActionDraft };

export function MakotoAgentPage() {
  const { locale } = usePreferences(), vi = locale === "vi", connection = useConnection(), chain = useVerifiedWalletChain();
  const canRead = connection.isConnected && chain.isArc;
  const balances = useWalletBalances(connection.address, canRead);
  const activity = useWalletActivity(connection.address, canRead, true);
  const ownerJars = useOwnerJars(canRead ? connection.address : undefined);
  const savings = summarizeSavingsJars(ownerJars.jars);
  const [messages, setMessages] = useState<Message[]>([]), [input, setInput] = useState("");
  const nextId = useRef(0), inputRef = useRef<HTMLInputElement>(null);
  const snapshot = useMemo(() => createAgentContextSnapshot({
    connected: connection.isConnected, account: connection.address, walletType: connection.connector?.name,
    verifiedChainId: chain.providerChainId, isArc: chain.isArc,
    balances: { usdc: balances.usdc.data, eurc: balances.eurc.data },
    activity: activity.data, activityPartial: activity.partial, activityUnavailable: activity.unavailable,
    vault: { available: canRead && !ownerJars.isLoading && !ownerJars.error, total: canRead && !ownerJars.isLoading && !ownerJars.error ? savings.totalSaved : undefined, goalCount: canRead && !ownerJars.isLoading && !ownerJars.error ? ownerJars.jars.length : undefined, activeCount: canRead && !ownerJars.isLoading && !ownerJars.error ? savings.active : undefined },
  }), [activity.data, activity.partial, activity.unavailable, balances.eurc.data, balances.usdc.data, canRead, chain.isArc, chain.providerChainId, connection.address, connection.connector?.name, connection.isConnected, ownerJars.error, ownerJars.isLoading, ownerJars.jars, savings.active, savings.totalSaved]);
  const prompts = vi ? ["Số dư của mình bao nhiêu?", "Cho mình xem giao dịch swap gần đây", "Trong Makoto Vault có gì?", "Giải thích giao dịch gần nhất"] : ["What's my balance?", "Show recent swaps", "What's in my Vault?", "Explain my last transaction"];

  function ask(text: string) {
    const value = text.trim(); if (!value) return;
    const response: AgentResponse = answerAgentRequest(snapshot, { text: value, locale });
    setMessages((current) => [...current, { id: nextId.current++, role: "user", text: value }, { id: nextId.current++, role: "agent", text: response.text, draft: response.actionDraft }]);
    setInput(""); window.requestAnimationFrame(() => inputRef.current?.focus());
  }
  function submit(event: FormEvent) { event.preventDefault(); ask(input); }

  return <main className={styles.page}><div className={styles.shell}><AppHeader />
    <section className={styles.hero}><div><span>{vi ? "MAKOTO AGENT" : "MAKOTO AGENT"}</span><h1>{vi ? "Makoto Agent — Bản xem trước chỉ đọc" : "Makoto Agent — Read-only Preview"}</h1><p>{vi ? "Hỏi về dữ liệu ví đã có trong Makoto bằng tiếng Việt hoặc tiếng Anh." : "Ask about wallet data already available in Makoto, in English or Vietnamese."}</p></div><strong>{vi ? "Chỉ đọc" : "Read-only preview"}</strong></section>
    <section className={styles.disclosure} role="note">{vi ? "Bản xem trước chỉ đọc. Makoto Agent có thể xem dữ liệu đã có trong giao diện ví. Agent không thể ký hoặc gửi giao dịch. Dữ liệu và cuộc trò chuyện ở lại trong ứng dụng và không được gửi tới nhà cung cấp AI bên ngoài." : "Read-only preview. Makoto Agent can inspect data already available in your wallet interface. It cannot sign or submit transactions. Wallet context and this conversation stay in the app and are not sent to an external AI provider."}</section>
    <section className={styles.chat} aria-labelledby="agent-conversation"><header><div><h2 id="agent-conversation">{vi ? "Cuộc trò chuyện" : "Conversation"}</h2><span>{connection.isConnected ? (chain.isArc ? "Arc Testnet" : vi ? "Sai mạng" : "Wrong network") : vi ? "Chưa kết nối ví" : "Wallet disconnected"}</span></div><button type="button" onClick={() => { setMessages([]); inputRef.current?.focus(); }} disabled={!messages.length}>{vi ? "Xóa cuộc trò chuyện" : "Clear conversation"}</button></header>
      <div className={styles.messages} aria-live="polite" aria-relevant="additions text">{messages.length === 0 ? <div className={styles.empty}><strong>{vi ? "Bạn muốn kiểm tra gì?" : "What would you like to inspect?"}</strong><p>{vi ? "Makoto chỉ trả lời từ dữ liệu hiện đang tải và sẽ nói rõ khi dữ liệu không khả dụng hoặc chỉ có một phần." : "Makoto answers only from currently loaded data and says when information is unavailable or partial."}</p></div> : messages.map((message) => <article key={message.id} className={message.role === "user" ? styles.userMessage : styles.agentMessage}><span>{message.role === "user" ? (vi ? "Bạn" : "You") : "Makoto Agent"}</span><p>{message.text}</p>{message.draft && <ActionDraftCard draft={message.draft} vi={vi} />}</article>)}</div>
      <div className={styles.prompts} aria-label={vi ? "Câu hỏi gợi ý" : "Suggested prompts"}>{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>)}</div>
      <form className={styles.composer} onSubmit={submit}><label htmlFor="agent-question">{vi ? "Câu hỏi cho Makoto Agent" : "Question for Makoto Agent"}</label><div><input ref={inputRef} id="agent-question" value={input} onChange={(event) => setInput(event.target.value)} placeholder={vi ? "Hỏi về số dư, hoạt động, Vault hoặc mạng…" : "Ask about balances, activity, Vault, or network…"} autoComplete="off" /><button type="submit" disabled={!input.trim()}>{vi ? "Gửi" : "Send"}</button></div></form>
    </section>
  </div></main>;
}

function ActionDraftCard({ draft, vi }: { draft: AgentActionDraft; vi: boolean }) { const labels: Record<AgentActionDraft["kind"], string> = { send: vi ? "Gửi" : "Send", swap: vi ? "Hoán đổi" : "Swap", bridge: "Bridge", "vault-deposit": vi ? "Nạp Vault" : "Vault deposit", "vault-withdraw": vi ? "Rút Vault" : "Vault withdraw" }; return <section className={styles.draft}><header><strong>{vi ? "Bản nháp hành động" : "Action draft"}</strong><span>{vi ? "Chỉ xem trước" : "Preview only"}</span></header><dl><div><dt>{vi ? "Hành động" : "Action"}</dt><dd>{labels[draft.kind]}</dd></div><div><dt>{vi ? "Số tiền" : "Amount"}</dt><dd>{draft.amount ? `${draft.amount} ${draft.asset ?? ""}` : vi ? "Chưa có" : "Missing"}{draft.outputAsset ? ` → ${draft.outputAsset}` : ""}</dd></div>{draft.recipient && <div><dt>{vi ? "Người nhận" : "Recipient"}</dt><dd>{draft.recipient}</dd></div>}<div><dt>{vi ? "Mạng" : "Network"}</dt><dd>{draft.sourceChain}{draft.destinationChain ? ` → ${draft.destinationChain}` : ""}</dd></div>{draft.missingFields.length > 0 && <div><dt>{vi ? "Còn thiếu" : "Missing"}</dt><dd>{draft.missingFields.join(", ")}</dd></div>}</dl><p>{vi ? "Không có nút thực thi. Hãy dùng luồng thủ công của Makoto để xem xét và xác nhận giao dịch." : "There is no execute control. Use Makoto's manual flow to review and confirm a transaction."}</p></section>; }
