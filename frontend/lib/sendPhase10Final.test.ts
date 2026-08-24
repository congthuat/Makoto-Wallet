import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isVerifiedArcReview } from "./transactionReview.ts";

const send = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
const chainHook = readFileSync(new URL("../hooks/useVerifiedWalletChain.tsx", import.meta.url), "utf8");

test("Arc review requires connector and provider to freshly report Arc Testnet", () => {
  assert.equal(isVerifiedArcReview(5_042_002, 5_042_002), true);
  assert.equal(isVerifiedArcReview(5_042_002, 50_350_312), false);
  assert.equal(isVerifiedArcReview(50_350_312, 5_042_002), false);
  assert.match(send, /const networkVerified = await chain\.verifyNow\(\)/);
  assert.match(send, /isArc: reviewNetworkVerified && chain\.isArc/);
});

test("open review invalidates on chain or account change and submit re-verifies", () => {
  assert.match(send, /const wrongChain = \(chain\.connectorChainId[\s\S]*setReviewing\(false\)/);
  assert.match(send, /connection\.address\?\.toLowerCase\(\) !== reviewedAccount\.toLowerCase\(\)/);
  assert.ok((send.match(/await chain\.verifyNow\(\)/g) ?? []).length >= 4);
  assert.match(chainHook, /provider\.on\?\.\("chainChanged"/);
  assert.match(chainHook, /window\.addEventListener\("focus"/);
  assert.match(chainHook, /document\.addEventListener\("visibilitychange"/);
});

test("normal and Memo sends estimate their exact contract calls", () => {
  assert.match(send, /estimateContractGas\(\{ address: ARC_MEMO_ADDRESS[\s\S]*functionName: "memo"/);
  assert.match(send, /estimateContractGas\(\{ address: asset\.address[\s\S]*functionName: "transfer"/);
  assert.match(send, /estimateFeesPerGas\(\)/);
  assert.match(send, /formatArcFeeEstimate\(feeEstimate\.rawFee\)/);
});

test("fee failure, totals, remaining balance, insufficient balance and MAX are explicit", () => {
  assert.match(send, /status: "unavailable"/);
  assert.match(send, /sendCostWithArcFee/);
  assert.match(send, /feeBlocksSend/);
  assert.match(send, /maxSendAmountAfterArcFee/);
  assert.match(send, /arcFeeMateriallyChanged/);
  for (const text of ["Estimated network fee", "Estimated total", "Estimated remaining balance", "Fee estimate unavailable", "Switch to Arc Testnet", "Phí mạng ước tính", "Tổng ước tính", "Chuyển sang Arc Testnet"]) assert.ok(send.includes(text));
});

test("wallet rejection remains pre-submission and creates no transaction", () => {
  assert.match(send, /rejected:[\s\S]*No transaction was submitted/);
  assert.match(send, /if \(!submittedHash\) submittingRef\.current = false/);
});
