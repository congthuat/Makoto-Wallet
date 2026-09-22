import assert from "node:assert/strict";
import test from "node:test";
import { formatAssetAmount, getAssetByAddress, getAssetById, parseAssetAmount, SUPPORTED_ASSETS } from "./assets.ts";

test("registry supports official Arc Testnet USDC, EURC, and cirBTC", () => {
  assert.deepEqual(SUPPORTED_ASSETS.map(({ id }) => id), ["usdc", "eurc", "cirbtc"]);
  assert.equal(getAssetById("usdc")?.address, "0x3600000000000000000000000000000000000000");
  assert.equal(getAssetById("eurc")?.address, "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a");
  assert.equal(getAssetById("cirbtc")?.address, "0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF");
  assert.equal(getAssetById("cirbtc")?.symbol, "cirBTC");
  assert.equal(getAssetById("cirbtc")?.name, "Circle Wrapped Bitcoin");
  assert.equal(getAssetById("cirbtc")?.decimals, 8);
  assert.equal(getAssetById("cirbtc")?.chainId, 5042002);
  assert.equal(getAssetById("other"), undefined);
  assert.equal(getAssetByAddress("0x0000000000000000000000000000000000000001"), undefined);
});

test("asset formatting and parsing use each token's native decimals", () => {
  const usdc = getAssetById("usdc")!;
  const cirbtc = getAssetById("cirbtc")!;
  assert.equal(formatAssetAmount(1_234_567n, usdc), "1.234567");
  assert.equal(parseAssetAmount("1.234567", usdc), 1_234_567n);
  assert.equal(parseAssetAmount("1.2345678", usdc), undefined);
  assert.equal(formatAssetAmount(123_456_789n, cirbtc), "1.23456789");
  assert.equal(parseAssetAmount("1.23456789", cirbtc), 123_456_789n);
  assert.equal(parseAssetAmount("1.234567891", cirbtc), undefined);
});
