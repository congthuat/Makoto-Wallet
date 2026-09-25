import { validateAgentState, type AgentState } from "./agentState.ts";
import type { AgentSessionBinding } from "./agent/sessionContext.ts";

export const AGENT_STATE_STORAGE_PREFIX = "makoto.agent.state.v2";

/** A restored record is historical application data, never current execution evidence. */
export type AgentStateRestoreResult =
  | Readonly<{ status: "HISTORICAL"; state: AgentState }>
  | Readonly<{ status: "ABSENT" | "INVALID" }>;

type ReadStore = Pick<Storage, "getItem">;
type WriteStore = Pick<Storage, "setItem">;
type BoundContext = Readonly<{ account: string; chainId: number }>;
type StoredAgentState = Readonly<{ version: 2; account: string; chainId: number; state: AgentState }>;

const account = (value: unknown): value is string => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value);
const chain = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0;
const validSession = (value: unknown): value is string => validateAgentState({ version: 2, sessionId: value, stateId: "identity-check", kind: "REQUESTED" }).valid;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const exact = (value: Record<string, unknown>, fields: readonly string[]) => Reflect.ownKeys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field) && Object.getOwnPropertyDescriptor(value, field)?.enumerable === true && Object.hasOwn(Object.getOwnPropertyDescriptor(value, field)!, "value"));

function normalized(binding: AgentSessionBinding): BoundContext | undefined {
  if (!binding || !account(binding.account) || !chain(binding.chainId)) return undefined;
  return { account: binding.account.toLowerCase(), chainId: binding.chainId };
}

/** Uses the existing Makoto Web Storage naming and account/chain binding convention. */
export function agentStateStorageKey(sessionId: unknown, binding: AgentSessionBinding): string | undefined {
  try {
    const context = normalized(binding);
    return context && validSession(sessionId) ? `${AGENT_STATE_STORAGE_PREFIX}:${context.account}:${context.chainId}:${sessionId}` : undefined;
  } catch { return undefined; }
}

/** Writes only canonical 12A data. The caller supplies a browser Storage implementation. */
export function storeAgentState(store: WriteStore, state: unknown, binding: AgentSessionBinding): boolean {
  try {
    const checked = validateAgentState(state);
    if (!checked.valid) return false;
    const context = normalized(binding), key = agentStateStorageKey(checked.value.sessionId, binding);
    if (!context || !key || !matchesContext(checked.value, context)) return false;
    const record: StoredAgentState = { version: 2, ...context, state: checked.value };
    store.setItem(key, JSON.stringify(record));
    return true;
  } catch { return false; }
}

/** Parses and validates untrusted storage; it never evaluates 12B or acquires external evidence. */
export function restoreAgentState(store: ReadStore, sessionId: unknown, binding: AgentSessionBinding): AgentStateRestoreResult {
  const key = agentStateStorageKey(sessionId, binding);
  if (!key) return { status: "INVALID" };
  try {
    const raw = store.getItem(key);
    if (raw === null) return { status: "ABSENT" };
    const parsed: unknown = JSON.parse(raw);
    if (!object(parsed) || !exact(parsed, ["version", "account", "chainId", "state"]) || parsed.version !== 2) return { status: "INVALID" };
    const context = normalized(binding);
    if (!context || parsed.account !== context.account || parsed.chainId !== context.chainId) return { status: "INVALID" };
    const checked = validateAgentState(parsed.state);
    if (!checked.valid || checked.value.sessionId !== sessionId || !matchesContext(checked.value, context)) return { status: "INVALID" };
    return { status: "HISTORICAL", state: checked.value };
  } catch { return { status: "INVALID" }; }
}

const matchesContext = (state: AgentState, context: BoundContext) => state.kind !== "TRANSACTION" || state.binding.account.toLowerCase() === context.account && state.binding.chainId === context.chainId;
