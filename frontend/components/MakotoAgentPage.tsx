"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useConnection } from "wagmi";
import { AppHeader } from "./AppHeader";
import { useOwnerJars } from "@/hooks/useOwnerJars";
import { usePreferences } from "@/hooks/usePreferences";
import { useVerifiedWalletChain } from "@/hooks/useVerifiedWalletChain";
import { useWalletActivity } from "@/hooks/useWalletActivity";
import { useWalletBalances } from "@/hooks/useWalletBalances";
import { createAgentContextSnapshot } from "@/lib/agent/context";
import { answerAgentRequest } from "@/lib/agent/planner";
import { consumeAgentResult, handoffUrl, prepareAgentActionHandoff, storeAgentHandoff, validateAgentActionDraft, type AgentActionResult } from "@/lib/agent/actions";
import type { AgentActionDraft, AgentResponse } from "@/lib/agent/types";
import { summarizeSavingsJars } from "@/lib/savingsSummary";
import styles from "./MakotoAgentPage.module.css";

type Message = { id: number; role: "user" | "agent"; text: string; draft?: AgentActionDraft };

export function MakotoAgentPage() {
  const { locale } = usePreferences(), vi = locale === "vi", connection = useConnection(), chain = useVerifiedWalletChain();
  const canRead = connection.isConnected && chain.isArc, balances = useWalletBalances(connection.address, canRead), activity = useWalletActivity(connection.address, canRead, true), ownerJars = useOwnerJars(canRead ? connection.address : undefined), savings = summarizeSavingsJars(ownerJars.jars);
  const [messages, setMessages] = useState<Message[]>([]), [input, setInput] = useState("");
  const nextId = useRef(0), inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { const timer = window.setTimeout(() => { const result = consumeAgentResult(window.sessionStorage, connection.address); if (result) setMessages([{ id: nextId.current++, role: "agent", text: resultText(result, vi) }]); }, 0); return () => window.clearTimeout(timer); }, [connection.address, vi]);
  const snapshot = useMemo(() => createAgentContextSnapshot({ connected: connection.isConnected, account: connection.address, walletType: connection.connector?.name, verifiedChainId: chain.providerChainId, isArc: chain.isArc, balances: { usdc: balances.usdc.data, eurc: balances.eurc.data }, activity: activity.data, activityPartial: activity.partial, activityUnavailable: activity.unavailable, vault: { available: canRead && !ownerJars.isLoading && !ownerJars.error, total: canRead ? savings.totalSaved : undefined, goalCount: canRead ? ownerJars.jars.length : undefined, activeCount: canRead ? savings.active : undefined } }), [activity.data, activity.partial, activity.unavailable, balances.eurc.data, balances.usdc.data, canRead, chain.isArc, chain.providerChainId, connection.address, connection.connector?.name, connection.isConnected, ownerJars.error, ownerJars.isLoading, ownerJars.jars.length, savings.active, savings.totalSaved]);
  const prompts = vi ? ["Số dư của mình bao nhiêu?", "Gửi 5 USDC cho 0x…", "Đổi 5 USDC sang EURC", "Trong Makoto Vault có gì?"] : ["What's my balance?", "Send 5 USDC to 0x…", "Swap 5 USDC to EURC", "What's in my Vault?"];
  function ask(text: string) { const value = text.trim(); if (!value) return; const response: AgentResponse = answerAgentRequest(snapshot, { text: value, locale }); setMessages((current) => [...current, { id: nextId.current++, role: "user", text: value }, { id: nextId.current++, role: "agent", text: response.text, draft: response.actionDraft }]); setInput(""); window.requestAnimationFrame(() => inputRef.current?.focus()); }
  function submit(event: FormEvent) { event.preventDefault(); ask(input); }
  return <main className={styles.page}><div className={styles.shell}><AppHeader />
    <section className={styles.hero}><div><span>MAKOTO AGENT</span><h1>{vi ? "Makoto Agent — hành động an toàn" : "Makoto Agent — Safe Actions"}</h1><p>{vi ? "Hỏi về ví hoặc chuẩn bị giao dịch bằng tiếng Việt hay tiếng Anh." : "Ask about your wallet or prepare a transaction in English or Vietnamese."}</p></div><strong>{vi ? "Ví luôn xác nhận" : "Wallet confirmation required"}</strong></section>
    <section className={styles.disclosure} role="note">{vi ? "Agent có thể chuẩn bị hành động được hỗ trợ qua cùng quy trình kiểm tra an toàn của Makoto. Agent không thể ký, bỏ qua bước xem xét, tự xác nhận ví hoặc thực hiện yêu cầu thiếu/không rõ ràng. An toàn giao thức không được đảm bảo." : "The Agent can prepare supported actions through Makoto's shared transaction safety review. It cannot sign, bypass review, confirm the wallet, or execute missing or ambiguous requests. Protocol safety is not guaranteed."}</section>
    <section className={styles.chat} aria-labelledby="agent-conversation"><header><div><h2 id="agent-conversation">{vi ? "Cuộc trò chuyện" : "Conversation"}</h2><span>{connection.isConnected ? (chain.isArc ? "Arc Testnet" : vi ? "Sai mạng" : "Wrong network") : vi ? "Chưa kết nối ví" : "Wallet disconnected"}</span></div><button type="button" onClick={() => { setMessages([]); inputRef.current?.focus(); }} disabled={!messages.length}>{vi ? "Xóa cuộc trò chuyện" : "Clear conversation"}</button></header>
      <div className={styles.messages} aria-live="polite" aria-relevant="additions text">{messages.length === 0 ? <div className={styles.empty}><strong>{vi ? "Bạn muốn làm gì?" : "What would you like to do?"}</strong><p>{vi ? "Makoto chỉ dùng dữ liệu đang tải và không bao giờ ký thay bạn." : "Makoto uses only currently loaded data and never signs for you."}</p></div> : messages.map((message) => <article key={message.id} className={message.role === "user" ? styles.userMessage : styles.agentMessage}><span>{message.role === "user" ? (vi ? "Bạn" : "You") : "Makoto Agent"}</span><p>{message.text}</p>{message.draft && <ActionDraftCard draft={message.draft} vi={vi} />}</article>)}</div>
      <div className={styles.prompts} aria-label={vi ? "Câu hỏi gợi ý" : "Suggested prompts"}>{prompts.map((prompt) => <button key={prompt} type="button" onClick={() => ask(prompt)}>{prompt}</button>)}</div>
      <form className={styles.composer} onSubmit={submit}><label htmlFor="agent-question">{vi ? "Yêu cầu cho Makoto Agent" : "Request for Makoto Agent"}</label><div><input ref={inputRef} id="agent-question" value={input} onChange={(event) => setInput(event.target.value)} placeholder={vi ? "Hỏi hoặc chuẩn bị một hành động…" : "Ask or prepare an action…"} autoComplete="off" /><button type="submit" disabled={!input.trim()}>{vi ? "Gửi" : "Send"}</button></div></form>
    </section>
  </div></main>;
}

function ActionDraftCard({ draft, vi }: { draft: AgentActionDraft; vi: boolean }) {
  const connection = useConnection();
  const router = useRouter();
  const [preparing, setPreparing] = useState(false);
  const progressRef = useRef<HTMLParagraphElement>(null);
  const validation = validateAgentActionDraft(draft), labels: Record<AgentActionDraft["kind"], string> = { send: vi ? "Gửi" : "Send", swap: vi ? "Hoán đổi" : "Swap", bridge: "Bridge", "vault-deposit": vi ? "Nạp Vault" : "Vault deposit", "vault-withdraw": vi ? "Rút Vault" : "Vault withdraw" };
  const helpId = `agent-draft-help-${draft.rawUserText.length}`;
  function prepare() { const prepared = prepareAgentActionHandoff(draft, connection.address); if (prepared.handoff) { setPreparing(true); storeAgentHandoff(window.sessionStorage, prepared.handoff); window.requestAnimationFrame(() => { progressRef.current?.focus(); router.push(handoffUrl(prepared.handoff!)); }); } }
  if (preparing) return <section className={styles.draft}><header><strong>{vi ? "Đang chuẩn bị" : "Preparing"}</strong><span>{vi ? "Đang mở bước xem xét" : "Opening review"}</span></header><p ref={progressRef} tabIndex={-1} role="status" aria-live="polite">{vi ? "Đang chuẩn bị giao dịch…" : "Preparing transaction…"}</p></section>;
  return <section className={styles.draft} aria-label={vi ? "Bản nháp hành động" : "Action draft"}><header><strong>{vi ? "Bản nháp hành động" : "Action draft"}</strong><span>{validation.valid ? (vi ? "Sẵn sàng chuẩn bị" : "Ready to prepare") : validation.missingFields.length ? (vi ? "Thiếu thông tin" : "Missing information") : (vi ? "Đã chặn" : "Blocked")}</span></header><dl><div><dt>{vi ? "Hành động" : "Action"}</dt><dd>{labels[draft.kind]}</dd></div><div><dt>{vi ? "Số tiền" : "Amount"}</dt><dd>{draft.amount ? `${draft.amount} ${draft.asset ?? ""}` : vi ? "Chưa có" : "Missing"}{draft.outputAsset ? ` → ${draft.outputAsset}` : ""}</dd></div>{draft.recipient && <div><dt>{vi ? "Người nhận" : "Recipient"}</dt><dd className={styles.longValue}>{draft.recipient}</dd></div>}<div><dt>{vi ? "Mạng" : "Network"}</dt><dd>{draft.sourceChain}{draft.destinationChain ? ` → ${draft.destinationChain}` : ""}</dd></div>{validation.missingFields.length > 0 && <div><dt>{vi ? "Còn thiếu" : "Missing"}</dt><dd>{validation.missingFields.join(", ")}</dd></div>}{validation.errors.length > 0 && <div><dt>{vi ? "Đã chặn" : "Blocked"}</dt><dd>{validation.errors.some((value) => value.startsWith("MAX")) ? (vi ? "Hành động MAX cần dùng luồng thủ công." : "MAX actions require the manual flow.") : validation.errors.join(", ")}</dd></div>}</dl><p>{vi ? "Chuẩn bị không mở ví. Sau đó bạn vẫn phải xem xét an toàn và chọn Tiếp tục đến ví." : "Preparing does not open your wallet. You must still review safety and choose Continue to wallet."}</p><button type="button" className={styles.prepareButton} onClick={prepare} disabled={!validation.valid} aria-describedby={!validation.valid ? helpId : undefined}>{vi ? "Chuẩn bị an toàn" : "Prepare safely"}</button>{!validation.valid && <small id={helpId}>{vi ? "Hoàn tất hoặc sửa thông tin bị chặn trước." : "Complete or correct the blocked information first."}</small>}</section>;
}

function resultText(result: AgentActionResult, vi: boolean) {
  if (result.status === "cancelled") return vi ? "Giao dịch đã bị hủy trong ví." : "Transaction cancelled in wallet.";
  if (result.status === "failed") return vi ? "Giao dịch thất bại." : "Transaction failed.";
  if (result.status === "unknown") return vi ? "Chưa xác định được trạng thái biên nhận." : "Transaction receipt status is unknown.";
  const title = ({ send: vi ? "Gửi đã xác nhận." : "Send confirmed.", swap: vi ? "Hoán đổi đã xác nhận." : "Swap confirmed.", bridge: vi ? "Bridge đã xác nhận." : "Bridge confirmed.", "vault-deposit": vi ? "Nạp Vault đã xác nhận." : "Vault deposit confirmed.", "vault-withdraw": vi ? "Rút Vault đã xác nhận." : "Vault withdrawal confirmed." })[result.action];
  const amount = result.amount && result.asset ? `\n${result.amount} ${result.asset}${result.outputAmount && result.outputAsset ? ` → ${result.outputAmount} ${result.outputAsset}` : ""}` : "";
  return `${title}${amount}${result.transactionHash ? `\nTransaction: ${result.transactionHash}` : ""}`;
}
