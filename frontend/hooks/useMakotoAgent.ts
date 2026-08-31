"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { consumeAgentResult, type AgentActionResult } from "@/lib/agent/actions";
import { answerAgentRequest } from "@/lib/agent/planner";
import { resolveAgentPlanning, type AgentPlanningServices } from "@/lib/agent/planning";
import { parseAgentRequest } from "@/lib/agent/parser";
import type { AgentActionDraft, AgentContextSnapshot, AgentLocale, AgentResponse } from "@/lib/agent/types";
import { clearAgentSessionContext, createAgentRequestGeneration, readAgentSessionContext, storeAgentSessionContext, updateAgentSessionContext, type AgentSessionContext } from "@/lib/agent/sessionContext";

export type AgentMessage = { id: number; role: "user" | "agent"; text: string; draft?: AgentActionDraft };

export function useMakotoAgent(snapshot: AgentContextSnapshot, locale: AgentLocale, account?: string, planningServices?: AgentPlanningServices) {
  const [messages, setMessages] = useState<AgentMessage[]>([]);
  const [hasSessionContext, setHasSessionContext] = useState(false);
  const [input, setInput] = useState("");
  const nextId = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousIntent = useRef<AgentResponse["intent"] | undefined>(undefined);
  const sessionContext = useRef<AgentSessionContext | undefined>(undefined);
  const previousBinding = useRef<string | undefined>(undefined);
  const requestGeneration = useRef(createAgentRequestGeneration());
  const latestBinding = useRef<string | undefined>(undefined);

  const clearConversation = useCallback(() => {
    requestGeneration.current.invalidate();
    setMessages([]);
    previousIntent.current = undefined;
    sessionContext.current = undefined;
    setHasSessionContext(false);
    clearAgentSessionContext(window.sessionStorage);
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const binding = snapshot.connected && snapshot.account && snapshot.verifiedChainId !== undefined
      ? `${snapshot.account.toLowerCase()}:${snapshot.verifiedChainId}`
      : undefined;
    latestBinding.current = binding;
    if (!binding || previousBinding.current && previousBinding.current !== binding) {
      requestGeneration.current.invalidate();
      clearAgentSessionContext(window.sessionStorage);
      sessionContext.current = undefined;
      setHasSessionContext(false);
      previousIntent.current = undefined;
    } else {
      sessionContext.current = readAgentSessionContext(window.sessionStorage, { account: snapshot.account, chainId: snapshot.verifiedChainId });
      setHasSessionContext(Boolean(sessionContext.current));
    }
    previousBinding.current = binding;
  }, [snapshot.account, snapshot.connected, snapshot.verifiedChainId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const result = consumeAgentResult(window.sessionStorage, account);
      if (result) setMessages([{ id: nextId.current++, role: "agent", text: resultText(result, locale === "vi") }]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [account, locale]);

  async function ask(text: string) {
    const value = text.trim();
    if (!value) return;
    const generation = requestGeneration.current.capture();
    const now = Date.now();
    const binding = snapshot.connected && snapshot.account && snapshot.verifiedChainId !== undefined
      ? { account: snapshot.account, chainId: snapshot.verifiedChainId }
      : undefined;
    const currentContext = binding ? readAgentSessionContext(window.sessionStorage, binding, now) : undefined;
    sessionContext.current = currentContext;
    const request = { text: value, locale, sessionContext: currentContext } as const;
    const intent = parseAgentRequest(request);
    const planning = await resolveAgentPlanning(snapshot, intent, planningServices);
    const bindingKey = binding ? `${binding.account.toLowerCase()}:${binding.chainId}` : undefined;
    if (!requestGeneration.current.isCurrent(generation) || latestBinding.current !== bindingKey) return;
    const response: AgentResponse = answerAgentRequest(snapshot, request, planning);
    if (response.intent.kind !== "unknown") previousIntent.current = response.intent;
    if (binding && previousBinding.current === `${binding.account.toLowerCase()}:${binding.chainId}`) {
      const updated = updateAgentSessionContext(currentContext, response.intent, binding, now);
      sessionContext.current = updated;
      setHasSessionContext(Boolean(updated));
      if (updated) storeAgentSessionContext(window.sessionStorage, updated);
    }
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role: "user", text: value },
      { id: nextId.current++, role: "agent", text: response.text, draft: response.actionDraft },
    ]);
    setInput("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    void ask(input);
  }

  return { messages, setMessages, hasSessionContext, clearConversation, input, setInput, inputRef, ask, submit };
}

function resultText(result: AgentActionResult, vi: boolean) {
  if (result.status === "cancelled") return vi ? "Giao dịch đã bị hủy trong ví." : "Transaction cancelled in wallet.";
  if (result.status === "failed") return vi ? "Giao dịch thất bại." : "Transaction failed.";
  if (result.status === "unknown") return vi ? "Chưa xác định được trạng thái biên nhận." : "Transaction receipt status is unknown.";
  const title = ({ send: vi ? "Gửi đã xác nhận." : "Send confirmed.", swap: vi ? "Hoán đổi đã xác nhận." : "Swap confirmed.", bridge: vi ? "Bridge đã xác nhận." : "Bridge confirmed.", "vault-deposit": vi ? "Nạp Vault đã xác nhận." : "Vault deposit confirmed.", "vault-withdraw": vi ? "Rút Vault đã xác nhận." : "Vault withdrawal confirmed." })[result.action];
  const amount = result.amount && result.asset ? `\n${result.amount} ${result.asset}${result.outputAmount && result.outputAsset ? ` → ${result.outputAmount} ${result.outputAsset}` : ""}` : "";
  return `${title}${amount}${result.transactionHash ? `\nTransaction: ${result.transactionHash}` : ""}`;
}
