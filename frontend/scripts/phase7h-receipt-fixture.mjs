import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
export const root = fileURLToPath(new URL("../", import.meta.url));
export const wallet = "0x1111111111111111111111111111111111111111";
export const other = "0x2222222222222222222222222222222222222222";
export const hash = `0x${"ab".repeat(32)}`;
export const arc = 5042002;
const component = readFileSync(path.join(root, "components/TransactionReceiptPanel.tsx"), "utf8");

export const fixtureSource = `
import * as React from "react";
import { TransactionReceiptPanel } from "@/components/TransactionReceiptPanel";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, keccak256, parseAbiParameters, stringToHex } from "viem";
import { ARC_MEMO_ADDRESS, arcMemoAbi } from "@/lib/arcMemo";
import { erc20BalanceAbi } from "@/lib/abi/erc20";
import { encodeTransferLog } from "@/lib/transactionReceipt";
import { SUPPORTED_ASSETS } from "@/lib/assets";
import { formatAgentActionResult } from "@/lib/agent/resultFormatter";
const wallet = ${JSON.stringify(wallet)}, other = ${JSON.stringify(other)}, hash = ${JSON.stringify(hash)}, hashB = "0x" + "cd".repeat(32);
const usdc = SUPPORTED_ASSETS[0], eurc = SUPPORTED_ASSETS[1];
const directActivity = {hash,logIndex:4,direction:"send",kind:"transfer",amount:5000000n,counterparty:other,confirmedAt:1766000000000,blockNumber:123n,assetId:usdc.id,assetSymbol:usdc.symbol,tokenAddress:usdc.address,decimals:usdc.decimals};
const swapActivity = {...directActivity,kind:"swap",swapReceive:{amount:4990000n,assetId:eurc.id,assetSymbol:eurc.symbol,tokenAddress:eurc.address,decimals:6,logIndex:8}};
const directTransfer = encodeTransferLog({token:usdc.address,from:wallet,to:other,value:5000000n,logIndex:4,transactionHash:hash});
const swapReceive = encodeTransferLog({token:eurc.address,from:other,to:wallet,value:4990000n,logIndex:8,transactionHash:hash});
function memoLog(note, transactionHash, logIndex = 5) {
  const callDataHash = keccak256(encodeFunctionData({abi:erc20BalanceAbi,functionName:"transfer",args:[other,5000000n]}));
  const memoId = "0x" + logIndex.toString(16).padStart(64, "0");
  return {address:ARC_MEMO_ADDRESS,...(transactionHash === undefined ? {} : {transactionHash}),logIndex,topics:encodeEventTopics({abi:arcMemoAbi,eventName:"Memo",args:{sender:wallet,target:usdc.address,memoId}}),data:encodeAbiParameters(parseAbiParameters("bytes32 callDataHash, bytes memo, uint256 memoIndex"),[callDataHash,stringToHex(note),BigInt(logIndex)])};
}
const normalizedHash = hash.toUpperCase();
function receiptFor(scenario) {
  if (scenario === "unavailable") return undefined;
  if (scenario === "failed") return {status:"reverted",transactionHash:hash,blockNumber:123n,logs:[directTransfer]};
  if (scenario === "failed-memo-mismatch") return {status:"reverted",transactionHash:hash,blockNumber:123n,logs:[directTransfer,memoLog("NOTE FROM TRANSACTION B",hashB)]};
  if (scenario === "unknown") return {status:"success",transactionHash:hash,blockNumber:123n,logs:[]};
  if (scenario === "swap-success") return {status:"success",transactionHash:hash,blockNumber:123n,logs:[directTransfer,swapReceive]};
  if (scenario === "swap-unknown") return {status:"success",transactionHash:hash,blockNumber:123n,logs:[directTransfer]};
  if (scenario === "memo-success") return {status:"success",transactionHash:hash,blockNumber:123n,logs:[directTransfer,memoLog("NOTE FROM TRANSACTION A",hash)]};
  if (scenario === "memo-mismatch") return {status:"success",transactionHash:hash,blockNumber:123n,logs:[directTransfer,memoLog("NOTE FROM TRANSACTION B",hashB)]};
  if (scenario === "memo-missing-identity") return {status:"success",transactionHash:hash,blockNumber:123n,logs:[directTransfer,memoLog("MISSING TRANSACTION IDENTITY")]};
  if (scenario === "memo-normalized") return {status:"success",transactionHash:normalizedHash,blockNumber:123n,logs:[encodeTransferLog({token:usdc.address,from:wallet,to:other,value:5000000n,logIndex:4,transactionHash:normalizedHash}),memoLog("CASE NORMALIZED MEMO",normalizedHash)]};
  return {status:"success",transactionHash:hash,blockNumber:123n,logs:[directTransfer]};
}
export function Fixture({options = {}}) {
  const scenario = options.scenario ?? "confirmed";
  if (scenario === "not-submitted") return <main style={{maxWidth:"100vw",boxSizing:"border-box",overflowWrap:"anywhere"}} data-receipt-status="not-submitted"><h1>{options.locale === "vi" ? "Chưa gửi" : "Not submitted"}</h1><p>{options.locale === "vi" ? "Chưa có giao dịch để xác minh." : "No transaction has been submitted."}</p></main>;
  if (scenario === "result-unknown") return <main style={{maxWidth:"100vw",boxSizing:"border-box",overflowWrap:"anywhere"}} data-receipt-status="submitted-unknown"><h1>{formatAgentActionResult({id:"h1",account:wallet,action:"swap",status:"unknown",createdAt:1766000000000,transactionHash:hash}, options.locale ?? "en")}</h1></main>;
  const activity = scenario.startsWith("swap-") ? swapActivity : directActivity;
  globalThis.__fixtureClient = {getTransactionReceipt: async () => { const result = receiptFor(scenario); if (!result) throw new Error("synthetic unavailable"); return result; }};
  return <TransactionReceiptPanel activity={activity} walletAddress={wallet} onClose={()=>{}}/>;
}
`;

const cache = new Map();
function compile(source, filename) {
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const mod = { exports: {} };
  new Function("require", "module", "exports", code)((id) => {
    if (id === "wagmi") return { usePublicClient: () => globalThis.__fixtureClient };
    if (id === "@/hooks/usePreferences") {
      const target = path.join(root, "i18n", "index.ts");
      if (!cache.has(target)) cache.set(target, compile(readFileSync(target, "utf8"), target));
      const { translate } = cache.get(target);
      return { usePreferences: () => ({ locale: globalThis.__fixtureLocale ?? "en", t: (key, values) => translate(globalThis.__fixtureLocale ?? "en", key, values) }) };
    }
    if (id.startsWith("@/") || id.startsWith(".")) {
      let target = id.startsWith("@/") ? path.join(root, id.slice(2)) : path.resolve(path.dirname(filename), id);
      if (!path.extname(target)) target = existsSync(target + ".ts") ? target + ".ts" : existsSync(target + ".tsx") ? target + ".tsx" : path.join(target, "index.ts");
      if (!cache.has(target)) cache.set(target, compile(readFileSync(target, "utf8"), target));
      return cache.get(target);
    }
    return require(id);
  }, mod, mod.exports);
  return mod.exports;
}
const { Fixture } = compile(fixtureSource, path.join(root, "scripts/ReceiptFixture.tsx"));
export function renderReceipt(options = {}) {
  globalThis.__fixtureLocale = options.locale ?? "en";
  globalThis.__fixtureClient = { getTransactionReceipt: async () => { throw new Error("SSR receipt unavailable"); } };
  return renderToStaticMarkup(React.createElement(Fixture, { options }));
}
