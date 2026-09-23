// Test-only: extract production Send render branches. No Send handlers, wagmi or provider imports.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const require = createRequire(import.meta.url);
export const root = fileURLToPath(new URL("../", import.meta.url));
export const account = "0x1111111111111111111111111111111111111111";
export const recipient = "0x2222222222222222222222222222222222222222";
const source = readFileSync(path.join(root, "components/SendFlow.tsx"), "utf8");
const start = source.indexOf('  if (stage === "confirmed" && hash');
const end = source.indexOf('\nfunction sendCopy');
if (start < 0 || end < start) throw new Error("Send render seam changed; review the fixture");
export const sendSource = `
import * as React from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { WalletPanel } from "@/components/WalletPanel";
import { TransactionSafetyReview } from "@/components/TransactionSafetyReview";
import { formatAssetAmount, getAssetById, SUPPORTED_ASSETS } from "@/lib/assets";
import { shortAddress } from "@/lib/format";
import { validateAssetSend, normalizeRecipient, arcScanAddressUrl, arcScanTransactionUrl } from "@/lib/wallet";
import { formatArcFeeEstimate } from "@/lib/arcFees";
import { hasBlockingChecks } from "@/lib/transactionReview";
export function SendFixture(options = {}) {
  const {locale,t} = usePreferences();
  const copy = sendCopy(locale,t);
  const [recipient,setRecipient] = React.useState(options.recipient ?? "${recipient}");
  const [amount,setAmount] = React.useState(options.amount ?? "1.234567");
  const [assetId,selectAsset] = React.useState(options.assetId ?? "usdc");
  const [reviewing,setReviewing] = React.useState(options.reviewing ?? false);
  const [stage,setStage] = React.useState(options.stage ?? "idle");
  const [note,setNote] = React.useState("");
  const [largeAcknowledged,setLargeAcknowledged] = React.useState(false);
  const asset = getAssetById(assetId), balance = options.balance ?? 123456789n;
  const wallet = {kind:"external",status:"connected",address:"${account}",isArc:true};
  const validated = validateAssetSend(recipient,amount,balance,asset,wallet.address);
  const normalizedRecipient = normalizeRecipient(recipient);
  const pending = stage === "awaiting" || stage === "confirming";
  const contacts = [], recents = [], matchedContact = undefined, canSaveContact = false;
  const contactFormOpen = false, contactName = "", contactFeedback = undefined;
  const memoNote = {}, memoCompatibility = "none", memoVerification = "none";
  const recipientKind = options.recipientKind ?? "wallet";
  const reviewNetworkVerified = true, safetyChecks = options.checks ?? [];
  const safetyAssessment = {status:options.assessment ?? "ready", checks:[]};
  const reviewSnapshot = undefined;
  const feeEstimate = options.fee ?? {status:"ready",rawFee:1000000000000n};
  const feeCost = {totalUsdc6:1234568n, feeUsdc6:1n, remainingUsdc6:122222221n};
  const large = options.large ?? false, error = options.error;
  const hash = options.hash, confirmedActivity = undefined;
  const ARC_MEMO_ADDRESS = "0x0000000000000000000000000000000000000000";
  const onClose = options.onClose ?? (() => { if(typeof window !== "undefined") window.fixtureClosed = true; });
  const submit = options.submit ?? (() => { throw new Error("Wallet submission is forbidden in this fixture"); });
  const onViewReceipt = undefined;
  const resetSafety = () => {};
  const review = () => setReviewing(true);
  const setContactFormOpen = () => {}, setContactFeedback = () => {}, setContactName = () => {};
  const selectRecipient = setRecipient, removeSavedContact = () => {}, submitContact = () => {};
  const pasteRecipient = () => {}, applySafeMax = () => {};
  const chain = {switchToArc:() => {throw new Error("No provider in fixture");}};
${source.slice(start,end)}
${source.slice(end,source.indexOf('\nfunction memoNoteResult'))}
`;

const { translate } = require(path.join(root,"i18n/index.ts"));
let locale = "en";
const cache = new Map();
function compile(text, filename) {
  const code = ts.transpileModule(text,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const mod = {exports:{}};
  new Function("require","module","exports",code)((id) => {
    if(id.endsWith(".css")) return {};
    if(id === "@/hooks/usePreferences") return {usePreferences:()=>({locale,t:(key)=>translate(locale,key)})};
    if(id.startsWith("@/") || id.startsWith(".")) {
      let target = id.startsWith("@/") ? path.join(root,id.slice(2)) : path.resolve(path.dirname(filename),id);
      if(!path.extname(target)) target += target.includes(`${path.sep}components${path.sep}`) ? ".tsx" : ".ts";
      if(!cache.has(target)) cache.set(target,compile(readFileSync(target,"utf8"),target));
      return cache.get(target);
    }
    return require(id);
  },mod,mod.exports);
  return mod.exports;
}
export const {SendFixture} = compile(sendSource,path.join(root,"scripts/SendFixture.tsx"));
const {ReceivePanel} = compile(readFileSync(path.join(root,"components/ReceivePanel.tsx"),"utf8"),path.join(root,"components/ReceivePanel.tsx"));
export function renderSend(options = {}) { locale=options.locale ?? "en"; return renderToStaticMarkup(React.createElement(SendFixture,options)); }
export function renderReceive(options = {}) { locale=options.locale ?? "en"; return renderToStaticMarkup(React.createElement(ReceivePanel,{address:account,onClose:()=>{}})); }
export function fixtureCss() {
  return readFileSync(path.join(root,"app/globals.css"),"utf8").replace(/@import\s+["']([^"']+)["'];/g,(_,file)=>readFileSync(path.join(root,"app",file),"utf8")) + "\n" + readFileSync(path.join(root,"components/SendReceive.css"),"utf8");
}
