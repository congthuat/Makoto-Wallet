import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createSwapFeeEnvelope, selectSwapGasLimit } from "./swapFeeEnvelope.ts";

const flow = readFileSync(new URL("../components/RealSwapFlow.tsx", import.meta.url), "utf8");
test("wallet-provider gas wins when larger", () => assert.equal(selectSwapGasLimit(100n, 120n).gasLimit, 120n));
test("public RPC gas wins when larger", () => assert.equal(selectSwapGasLimit(120n, 100n).gasLimit, 120n));
test("wallet-provider unavailable uses deterministic gas-unit headroom", () => assert.equal(selectSwapGasLimit(100n).gasLimit, 110n));
test("maximum envelope is gas limit times max fee per gas", () => assert.equal(createSwapFeeEnvelope(100n, 120n, 7n).rawMaxFee18, 840n));
test("envelope converts to USDC6 exactly once", () => assert.equal(createSwapFeeEnvelope(100_000n, undefined, 40_000_000_000n).feeUsdc6, 4_400n));
test("explicit EIP-1559 fields reach submitted request", () => { assert.match(flow, /gas: freshEnvelope\.gasLimit/); assert.match(flow, /maxFeePerGas: freshEnvelope\.maxFeePerGas/); assert.match(flow, /maxPriorityFeePerGas: freshEnvelope\.maxPriorityFeePerGas/); });
test("wallet estimation is read-only", () => { assert.match(flow, /method: "eth_estimateGas"/); assert.doesNotMatch(flow.slice(flow.indexOf("async function solveSafeMax"), flow.indexOf("async function chooseQuickAmount")), /writeContract/); });
test("final MAX check runs before wallet submission", () => { assert.ok(flow.indexOf("freshEnvelope.feeUsdc6 > freshBalance") < flow.indexOf("writer.writeContractAsync(simulation.request)")); });
test("no fixed USDC reserve", () => assert.doesNotMatch(readFileSync(new URL("./swapFeeEnvelope.ts", import.meta.url), "utf8"), /0\.01|10_000n \/ 1_000_000n/));
