import type { AgentIntelligenceFact, AgentIntelligenceResult, AgentSourceTrust, OfficialResearchTopic } from "./types.ts";

export type OfficialSourceDefinition = Readonly<{ id: Exclude<OfficialResearchTopic, "arc-updates">; title: string; publisher: string; hostname: string; path: string; sourceType: AgentSourceTrust; format: "json" | "text"; ttlSeconds: number; extractor: "bounded-text" | "circle-cctp-section" | "circle-status" }>;

export const OFFICIAL_SOURCES: readonly OfficialSourceDefinition[] = Object.freeze([
  { id: "arc-docs", title: "Arc documentation", publisher: "Arc", hostname: "docs.arc.io", path: "/llms.txt", sourceType: "OFFICIAL_DOCUMENTATION", format: "text", ttlSeconds: 21_600, extractor: "bounded-text" },
  { id: "circle-cctp", title: "Circle CCTP documentation", publisher: "Circle", hostname: "developers.circle.com", path: "/llms.txt", sourceType: "OFFICIAL_DOCUMENTATION", format: "text", ttlSeconds: 86_400, extractor: "circle-cctp-section" },
  { id: "circle-status", title: "Circle system status", publisher: "Circle", hostname: "status.circle.com", path: "/api/v2/status.json", sourceType: "OFFICIAL_STATUS", format: "json", ttlSeconds: 60, extractor: "circle-status" },
]);

export function getOfficialSource(id: string) { return OFFICIAL_SOURCES.find((source) => source.id === id); }
export function officialSourceUrl(source: OfficialSourceDefinition) { return `https://${source.hostname}${source.path}`; }
export function isAllowedOfficialUrl(url: URL, source: OfficialSourceDefinition) { return url.protocol === "https:" && url.hostname === source.hostname && (url.pathname === source.path || url.pathname.startsWith(`${source.path}/`)); }

export const OFFICIAL_SOURCE_MAX_BYTES = 256 * 1024;
const SOURCE_TIMEOUT_MS = 8_000;

export async function retrieveOfficialSource(source: OfficialSourceDefinition, fetcher: typeof fetch, now: number, topic?: "bridging"): Promise<AgentIntelligenceResult> {
  const url = new URL(officialSourceUrl(source));
  if (!isAllowedOfficialUrl(url, source)) throw new Error("Source registry URL is not allowed.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), SOURCE_TIMEOUT_MS);
  try {
    const options: RequestInit = { method: "GET", redirect: "manual", signal: controller.signal, headers: { Accept: source.format === "json" ? "application/json" : "text/plain" }, cache: "no-store" };
    let response = await fetcher(url, options);
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || !isAllowedOfficialUrl(new URL(location, url), source)) throw new Error("Official source redirected outside its allowlist.");
      response = await fetcher(new URL(location, url), options);
      if (response.status >= 300 && response.status < 400) throw new Error("Official source redirected too many times.");
    }
    if (!response.ok) throw new Error("Official source unavailable.");
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (source.format === "json" ? !contentType.includes("application/json") : !contentType.includes("text/plain")) throw new Error("Official source returned an unsupported content type.");
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > OFFICIAL_SOURCE_MAX_BYTES) throw new Error("Official source response is too large.");
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > OFFICIAL_SOURCE_MAX_BYTES) throw new Error("Official source response is too large.");
    const facts = extractOfficialFacts(source, raw, topic);
    const noTopicMatch = source.id === "arc-docs" && topic === "bridging" && facts.length === 0;
    return Object.freeze({ kind: "official-research", status: noTopicMatch ? "PARTIAL" : "AVAILABLE", summary: "official", facts: Object.freeze(facts), sources: Object.freeze([sourceMetadata(source, now)]), fetchedAt: now, expiresAt: now + source.ttlSeconds * 1000, limitations: Object.freeze(noTopicMatch ? ["ARC_TOPIC_NOT_FOUND", "OFFICIAL_SOURCE_NOT_TRANSACTION_TRUTH"] : source.id === "circle-status" ? ["STATUS_NOT_ROUTE_TRUTH"] : ["OFFICIAL_SOURCE_NOT_TRANSACTION_TRUTH"]) });
  } finally { clearTimeout(timer); }
}

export function extractOfficialContent(source: OfficialSourceDefinition, raw: string) {
  if (source.extractor === "circle-status") {
    const payload = JSON.parse(raw) as { status?: { indicator?: unknown; description?: unknown } };
    if (typeof payload.status?.indicator !== "string" || typeof payload.status.description !== "string") throw new Error("Official status response is malformed.");
    return `${bounded(payload.status.indicator, 40)}: ${bounded(payload.status.description, 160)}`;
  }
  const safe = stripInstructions(raw);
  if (source.extractor === "circle-cctp-section") {
    const lines = safe.split(/\r?\n/), start = lines.findIndex((line) => /^##\s+CCTP\b.*Cross-Chain Transfer Protocol/i.test(line.trim()));
    if (start < 0) throw new Error("Official CCTP section was not found.");
    const following = lines.slice(start + 1).findIndex((line) => /^##\s+\S/.test(line.trim()));
    const section = lines.slice(start, following < 0 ? lines.length : start + 1 + following).join("\n").replace(/\s+/g, " ").trim();
    if (!section) throw new Error("Official CCTP section contained no usable text.");
    return bounded(section, 600);
  }
  const text = safe.replace(/\s+/g, " ").trim();
  if (!text) throw new Error("Official source contained no usable text.");
  return bounded(text, 600);
}

export function extractOfficialFacts(source: OfficialSourceDefinition, raw: string, topic?: "bridging"): AgentIntelligenceFact[] {
  if (source.extractor === "circle-status") return [{ label: "providerStatus", value: extractOfficialContent(source, raw), sourceIds: [source.id] }];
  const safe = stripInstructions(raw);
  if (source.extractor === "circle-cctp-section") {
    const section = extractOfficialContent(source, safe);
    const facts: AgentIntelligenceFact[] = [];
    if (/burn-and-mint|crosschain USDC|cross-chain USDC/i.test(section)) facts.push({ label: "cctpPurpose", value: "crosschain-usdc", sourceIds: [source.id] });
    if (/supported chains and domains/i.test(section)) facts.push({ label: "cctpSupportedChains", value: "documented", sourceIds: [source.id] });
    if (/\bfees\b/i.test(section)) facts.push({ label: "cctpFees", value: "documented", sourceIds: [source.id] });
    if (/fast vs standard|fast transfer/i.test(section)) facts.push({ label: "cctpTransferModes", value: "documented", sourceIds: [source.id] });
    if (/forwarding service/i.test(section)) facts.push({ label: "cctpForwarding", value: "documented", sourceIds: [source.id] });
    if (!facts.length) throw new Error("Official CCTP section contained no recognized facts.");
    return facts;
  }
  if (source.id === "arc-docs" && topic === "bridging") {
    const relevant = safe.split(/\r?\n/).filter((line) => /\b(?:bridge|bridging|cross-chain|cctp)\b/i.test(line) && !/claude code|plugin|install(?:ing)? skills?/i.test(line)).map(cleanMarkdown).filter(Boolean).slice(0, 5);
    return relevant.length ? [{ label: "arcBridging", value: bounded(relevant.join(" "), 500), sourceIds: [source.id] }] : [];
  }
  return [{ label: "officialSummary", value: extractOfficialContent(source, safe), sourceIds: [source.id] }];
}

export function sourceErrorResult(source: OfficialSourceDefinition, now: number): AgentIntelligenceResult {
  return Object.freeze({ kind: "official-research", status: "SOURCE_ERROR", summary: "official", facts: Object.freeze([]), sources: Object.freeze([sourceMetadata(source, now)]), fetchedAt: now, limitations: Object.freeze(["OFFICIAL_SOURCE_UNREACHABLE"]) });
}

export function unsupportedArcRecentResult(now: number): AgentIntelligenceResult {
  return Object.freeze({ kind: "official-research", status: "UNVERIFIED", summary: "official", facts: Object.freeze([]), sources: Object.freeze([]), fetchedAt: now, limitations: Object.freeze(["ARC_DATED_UPDATES_SOURCE_NOT_CONFIGURED"]) });
}

export async function readOfficialResearchResponse(response: Response): Promise<AgentIntelligenceResult> {
  const payload: unknown = await response.json().catch(() => undefined);
  if (isIntelligenceResult(payload)) return payload;
  throw new Error("Official research is unavailable.");
}

function sourceMetadata(source: OfficialSourceDefinition, fetchedAt: number) { return Object.freeze({ id: source.id, title: source.title, sourceType: source.sourceType, canonicalUrl: officialSourceUrl(source), publisher: source.publisher, fetchedAt }); }
function isIntelligenceResult(value: unknown): value is AgentIntelligenceResult { if (!value || typeof value !== "object") return false; const candidate = value as Partial<AgentIntelligenceResult>; return candidate.kind === "official-research" && typeof candidate.status === "string" && Array.isArray(candidate.facts) && Array.isArray(candidate.sources) && typeof candidate.fetchedAt === "number" && Array.isArray(candidate.limitations); }
function stripInstructions(value: string) { return value.replace(/ignore (?:all |any )?(?:previous|prior) instructions?/gi, "[instruction removed]").replace(/\b(?:sign|submit|approve) (?:this |the )?transaction\b/gi, "[transaction instruction removed]"); }
function cleanMarkdown(value: string) { return value.replace(/^#+\s*/, "").replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim(); }
function bounded(value: string, limit: number) { return value.length <= limit ? value : `${value.slice(0, limit - 1).trimEnd()}…`; }
