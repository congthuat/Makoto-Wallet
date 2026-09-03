"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { consumeAgentResult } from "@/lib/agent/actions";
import { formatAgentActionResult } from "@/lib/agent/resultFormatter";
import { answerAgentRequest } from "@/lib/agent/planner";
import type { AgentPlanningServices } from "@/lib/agent/planning";
import { parseAgentRequest } from "@/lib/agent/parser";
import { routeAgentRequest } from "@/lib/agent/orchestration";
import { runAgentCapability, type AgentCapabilityOutput } from "@/lib/agent/tools";
import type { AgentActionDraft, AgentContextSnapshot, AgentLocale, AgentResponse } from "@/lib/agent/types";
import type { AgentIntelligenceResult } from "@/lib/agent/intelligence/types";
import type { OnchainIntelligenceServices } from "@/lib/agent/intelligence/onchain";
import { readOfficialResearchResponse } from "@/lib/agent/intelligence/officialSources";
import { clearAgentSessionContext, createAgentRequestGeneration, readAgentSessionContext, storeAgentSessionContext, updateAgentSessionContext, type AgentSessionContext } from "@/lib/agent/sessionContext";

export type AgentMessage = { id: number; role: "user" | "agent"; text: string; draft?: AgentActionDraft; intelligence?: AgentIntelligenceResult };

export function useMakotoAgent(snapshot: AgentContextSnapshot, locale: AgentLocale, account?: string, planningServices?: AgentPlanningServices, onchainServices?: OnchainIntelligenceServices) {
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
  const latestLocale = useRef(locale);

  useEffect(() => {
    latestLocale.current = locale;
  }, [locale]);

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
      if (result) setMessages([{ id: nextId.current++, role: "agent", text: formatAgentActionResult(result, locale) }]);
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
    const requestLocale = latestLocale.current;
    const request = { text: value, locale: requestLocale, account: snapshot.account, sessionContext: currentContext } as const;
    const intent = parseAgentRequest(request);
    const decision = routeAgentRequest(intent);
    const output: AgentCapabilityOutput = decision.mode === "clarification"
      ? Object.freeze({})
      : await runAgentCapability({ snapshot, planningServices, onchainServices, research: fetchOfficialResearch, now, binding: { generation, account: binding?.account, chainId: binding?.chainId } }, intent, decision);
    const bindingKey = binding ? `${binding.account.toLowerCase()}:${binding.chainId}` : undefined;
    if (!requestGeneration.current.isCurrent(generation) || latestBinding.current !== bindingKey) return;
    const response: AgentResponse = answerAgentRequest(snapshot, intent, decision, output);
    if (response.intent.kind !== "unknown") previousIntent.current = response.intent;
    if (binding && previousBinding.current === `${binding.account.toLowerCase()}:${binding.chainId}`) {
      const updated = updateAgentSessionContext(currentContext, response.intent, binding, now);
      sessionContext.current = updated;
      setHasSessionContext(Boolean(updated));
      if (updated) storeAgentSessionContext(window.sessionStorage, updated);
      else clearAgentSessionContext(window.sessionStorage);
    }
    setMessages((current) => [
      ...current,
      { id: nextId.current++, role: "user", text: value },
      { id: nextId.current++, role: "agent", text: response.text, draft: response.actionDraft, intelligence: response.intelligence },
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

async function fetchOfficialResearch(sourceId: string, subject?: "bridging"): Promise<AgentIntelligenceResult> {
  const query = new URLSearchParams({ source: sourceId });
  if (subject) query.set("topic", subject);
  const response = await fetch(`/api/agent-research?${query}`, { cache: "no-store" });
  return readOfficialResearchResponse(response);
}
