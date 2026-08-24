import { formatUnits } from "viem";
import { arcTestnet } from "viem/chains";
import type { WalletActivity } from "../wallet.ts";
import type { AgentContextSnapshot, AgentIntent, AgentResponse, AgentToolResult } from "./types.ts";

export function formatAgentResponse(snapshot: AgentContextSnapshot, intent: AgentIntent, result?: AgentToolResult): AgentResponse {
  const vi = intent.locale === "vi";
  if (intent.kind === "action-draft" && intent.actionDraft) return { intent, actionDraft: intent.actionDraft, text: vi ? "Đây là bản nháp chỉ để xem trước. Makoto Agent chưa thể thực thi giao dịch trong giai đoạn này." : "This is a preview-only draft. Transaction execution by Makoto Agent is not enabled in this phase." };
  if (intent.kind === "unknown") return { intent, text: vi ? "Mình có thể xem số dư, mạng, hoạt động gần đây, Makoto Vault, giải thích giao dịch và các biện pháp an toàn. Mình cũng có thể tạo bản nháp hành động chỉ để xem trước." : "I can show balances, network status, recent activity, Makoto Vault, transaction explanations, and safety capabilities. I can also create preview-only action drafts." };
  if (!result?.ok) return { intent, result, text: localUnavailable(result?.unavailable, vi) };
  if (intent.kind === "wallet-overview") { const b = snapshot.balances; return { intent, result, text: vi ? `Số dư Arc Testnet — USDC: ${amount(b.usdc)}; EURC: ${amount(b.eurc)}.` : `Arc Testnet balances — USDC: ${amount(b.usdc)}; EURC: ${amount(b.eurc)}.` }; }
  if (intent.kind === "network-status") return { intent, result, text: networkText(snapshot, vi) };
  if (intent.kind === "vault-summary") return { intent, result, text: vi ? `Makoto Vault: ${amount(snapshot.vault.total)} USDC trong ${snapshot.vault.goalCount ?? "không khả dụng"} mục tiêu; ${snapshot.vault.activeCount ?? "không khả dụng"} đang hoạt động.` : `Makoto Vault: ${amount(snapshot.vault.total)} USDC across ${snapshot.vault.goalCount ?? "unavailable"} goals; ${snapshot.vault.activeCount ?? "unavailable"} active.` };
  if (intent.kind === "safety-capabilities") return { intent, result, text: vi ? `Makoto hỗ trợ: ${snapshot.safetyCapabilities.join(", ")}. Các biện pháp này không phải kiểm toán và không đảm bảo không có rủi ro.` : `Makoto supports: ${snapshot.safetyCapabilities.join(", ")}. These protections are not an audit and do not guarantee zero risk.` };
  if (intent.kind === "activity-explanation") return { intent, result, text: explain(result.data as WalletActivity, vi) };
  const items = result.data as WalletActivity[]; const prefix = result.partial ? (vi ? "Lịch sử đang hiển thị một phần. " : "Activity history is partial. ") : "";
  return { intent, result, text: prefix + (items.length ? items.map((item) => explain(item, vi)).join("\n") : (vi ? "Không có hoạt động phù hợp trong lịch sử đã tải." : "No matching activity exists in the loaded history.")) };
}

export function explain(item: WalletActivity, vi: boolean) {
  const sent = `${formatUnits(item.amount, item.decimals)} ${item.assetSymbol}`; const hash = ` (${item.hash.slice(0, 10)}…)`;
  if (item.kind === "swap" && item.swapReceive) { const received = `${formatUnits(item.swapReceive.amount, item.swapReceive.decimals)} ${item.swapReceive.assetSymbol}`; return vi ? `Bạn đã hoán đổi ${sent} lấy ${received} qua XyloNet StableSwap.${hash}` : `You swapped ${sent} for ${received} through XyloNet StableSwap.${hash}`; }
  if (item.kind === "bridge") return vi ? `Đây là giao dịch bridge CCTP từ Arc với số tiền ${sent}. Giao dịch phía Arc đã xác nhận; hoàn tất ở đích chỉ được xác nhận khi có bằng chứng đích.${hash}` : `This is an Arc-origin CCTP bridge for ${sent}. The Arc-side transaction is confirmed; destination completion requires destination evidence.${hash}`;
  if (item.kind === "vault-deposit") return vi ? `Bạn đã nạp ${sent} vào Makoto Vault.${hash}` : `You deposited ${sent} into Makoto Vault.${hash}`;
  if (item.kind === "vault-withdraw") return vi ? `Bạn đã rút ${sent} khỏi Makoto Vault.${hash}` : `You withdrew ${sent} from Makoto Vault.${hash}`;
  return item.direction === "receive" ? (vi ? `Bạn đã nhận ${sent} từ ${item.counterparty}.${hash}` : `You received ${sent} from ${item.counterparty}.${hash}`) : (vi ? `Bạn đã gửi ${sent} đến ${item.counterparty}.${hash}` : `You sent ${sent} to ${item.counterparty}.${hash}`);
}
function amount(value?: bigint) { return value === undefined ? "unavailable" : formatUnits(value, 6); }
function localUnavailable(text: string | undefined, vi: boolean) { if (!vi) return text ?? "That information is unavailable."; if (text?.startsWith("Connect")) return "Kết nối ví để xem số dư và hoạt động."; if (text?.includes("partial")) return "Không có hoạt động phù hợp trong dữ liệu đã tải; lịch sử hiện chỉ có một phần."; return "Thông tin này hiện không khả dụng."; }
function networkText(s: AgentContextSnapshot, vi: boolean) { if (!s.connected) return vi ? `Chưa kết nối ví. Makoto cần Arc Testnet (chain ID ${arcTestnet.id}) cho các thao tác Arc.` : `Wallet disconnected. Makoto requires Arc Testnet (chain ID ${arcTestnet.id}) for Arc actions.`; return s.isArc ? (vi ? `Ví đang ở Arc Testnet (chain ID ${arcTestnet.id}). Các thao tác phụ thuộc Arc hiện khả dụng.` : `Your wallet is on Arc Testnet (chain ID ${arcTestnet.id}). Arc-dependent actions are available.`) : (vi ? `Ví đang ở chain ID ${s.verifiedChainId ?? "không xác định"}; Makoto cần Arc Testnet (${arcTestnet.id}). Agent sẽ không tự chuyển mạng.` : `Your wallet is on chain ID ${s.verifiedChainId ?? "unknown"}; Makoto requires Arc Testnet (${arcTestnet.id}). The Agent will not switch networks.`); }
