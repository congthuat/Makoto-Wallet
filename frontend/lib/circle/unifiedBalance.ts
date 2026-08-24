import { formatUnits, getAddress, parseUnits, type Address } from "viem";
import type { GetBalancesResult, EstimateSpendResult, SpendResult, DepositResult } from "@circle-fin/app-kit";
import type { UnifiedBalance } from "./types.ts";

export function normalizeUnifiedBalance(input: { available: bigint; pending: bigint; sources: UnifiedBalance["sources"] }): UnifiedBalance {
  if (input.available < 0n || input.pending < 0n || input.sources.some((source) => source.amount < 0n)) throw new RangeError("Gateway balances cannot be negative");
  return { ...input, total: input.available + input.pending };
}

export type UnifiedBalanceState = { status: "ready"; balance: UnifiedBalance } | { status: "unavailable" | "disconnected"; reason: string };

export function normalizeCircleBalances(result: GetBalancesResult, account: string): UnifiedBalance {
  const entry = result.breakdown.find((item) => item.depositor.toLowerCase() === account.toLowerCase());
  const available = parseUnits(result.totalConfirmedBalance, 6);
  const pending = parseUnits(result.totalPendingBalance ?? "0", 6);
  return { available, pending, total: available + pending, sources: (entry?.breakdown ?? []).map((item) => ({ domain: 0, chain: String(item.chain), amount: parseUnits(item.confirmedBalance, 6) })) };
}
export function parsePositiveUsdc(value: string): bigint | undefined {
  try {
    const amount = parseUnits(value.trim(), 6);
    return amount > 0n ? amount : undefined;
  } catch {
    return undefined;
  }
}
export const normalizeSpendFees = (estimate: EstimateSpendResult) => estimate.fees.map((fee) => ({ type: fee.type, token: fee.token, amount: fee.amount, allocations: fee.allocations?.map((item) => ({ chain: String(item.chain), amount: item.amount })) ?? [] }));
export type NormalizedSpendFee = ReturnType<typeof normalizeSpendFees>[number];
export type SpendAllocation = { chain: "Arc_Testnet" | "Base_Sepolia"; amount: string };
export type ReviewedSpend = { account: Address; recipient: Address; amount: string; destination: "Arc_Testnet"; useForwarder: true; allocations: SpendAllocation[]; quotedAt: number; fees: NormalizedSpendFee[] };
export function selectSpendAllocations(balance: UnifiedBalance, amount: string): SpendAllocation[] { const needed=parsePositiveUsdc(amount);if(!needed||needed>balance.available)throw new RangeError("Unified Balance is insufficient");const available=new Map<SpendAllocation["chain"],bigint>();for(const source of balance.sources){if(source.chain!=="Arc_Testnet"&&source.chain!=="Base_Sepolia")continue;available.set(source.chain,(available.get(source.chain)??0n)+source.amount)}const single=[...available].find(([,value])=>value>=needed);if(single)return[{chain:single[0],amount:formatUnits(needed,6)}];let remaining=needed;const allocations:SpendAllocation[]=[];for(const [chain,value] of [...available].sort((a,b)=>a[1]>b[1]?-1:1)){const draw=value<remaining?value:remaining;if(draw>0n)allocations.push({chain,amount:formatUnits(draw,6)});remaining-=draw;if(remaining===0n)break}if(remaining!==0n)throw new RangeError("Supported source balances are insufficient");return allocations}
export function feeFingerprint(fees:NormalizedSpendFee[]){return JSON.stringify(fees.map(fee=>({...fee,allocations:[...fee.allocations].sort((a,b)=>a.chain.localeCompare(b.chain))})).sort((a,b)=>`${a.type}:${a.token}`.localeCompare(`${b.type}:${b.token}`)))}
export const spendFeesChanged=(reviewed:NormalizedSpendFee[],fresh:NormalizedSpendFee[])=>feeFingerprint(reviewed)!==feeFingerprint(fresh);
export function createReviewedSpend(input:Omit<ReviewedSpend,"account"|"recipient">&{account:string;recipient:string}):ReviewedSpend{return{...input,account:getAddress(input.account),recipient:getAddress(input.recipient)}}
export function reviewedSpendMatches(review:ReviewedSpend,input:{account?:string;recipient:string;amount:string;destination:string;useForwarder:boolean}){try{return Boolean(input.account)&&review.account===getAddress(input.account!)&&review.recipient===getAddress(input.recipient)&&review.amount===input.amount&&review.destination===input.destination&&review.useForwarder===input.useForwarder}catch{return false}}
export function spendFeeTotalUsdc(fees:NormalizedSpendFee[]){return fees.filter(fee=>fee.token.toUpperCase()==="USDC").reduce((sum,fee)=>sum+parseUnits(fee.amount,6),0n)}
export const spendFeeLabel=(type:NormalizedSpendFee["type"],vi:boolean)=>({provider:vi?"Phí nhà cung cấp":"Provider fee",gasFee:vi?"Gas ước tính":"Estimated gas",forwarder:vi?"Phí chuyển tiếp":"Forwarding fee",kit:vi?"Phí tích hợp":"Integration fee"})[type];
export function sanitizeSpendError(error:unknown,vi=false){const message=error instanceof Error?error.message:"Circle Gateway request failed";if(/insufficient total maxfee|maxfee.*forward|forwarding fee.*(cover|insufficient)/i.test(message))return vi?"Phí chuyển tiếp đã thay đổi trước khi gửi. Vui lòng ước tính lại.":"Forwarding fee changed before submission. Please estimate again.";return sanitizeCircleError(error)}
export function sanitizeCircleError(error: unknown) { const message = error instanceof Error ? error.message : "Circle Gateway request failed"; return /reject|denied|cancel/i.test(message) ? "Transaction cancelled in wallet." : message.slice(0, 240); }
export type CircleDepositResult = DepositResult;
export type CircleSpendResult = SpendResult;
