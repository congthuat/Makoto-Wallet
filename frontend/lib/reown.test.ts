import assert from "node:assert/strict";
import test from "node:test";
import { REOWN_METADATA, resolveReownProjectId } from "./reown.ts";

test("Reown metadata uses the canonical Makoto production identity", () => {
  assert.deepEqual(REOWN_METADATA, {
    name: "Makoto Wallet",
    description: "A non-custodial wallet built for Arc.",
    url: "https://makotowallet.xyz",
    icons: ["https://makotowallet.xyz/makoto/logo-pro-v2.png"],
  });
});

test("missing or blank Reown project IDs fail closed", () => {
  assert.equal(resolveReownProjectId(undefined), undefined);
  assert.equal(resolveReownProjectId("   "), undefined);
  assert.equal(resolveReownProjectId(" public-id "), "public-id");
});
