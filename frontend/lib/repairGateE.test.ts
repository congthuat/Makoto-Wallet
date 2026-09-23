import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error Test-only renderer compiles production JSX with the existing TypeScript compiler.
import { renderSend } from "../scripts/phase7e-fixture.mjs";

for (const locale of ["en", "vi"]) {
  for (const status of ["unavailable", "loading"]) {
    test(`Repair Gate E ${locale}: ${status} cost explanations opt into prose without losing text`, () => {
      const html = renderSend({ locale, reviewing: true, fee: { status } });
      const prose = [...html.matchAll(/<dd class="review-detail-prose">([^<]+)<\/dd>/g)].map(match => match[1]);
      assert.equal(prose.length, 2);
      const source = readFileSync(new URL("../components/SendFlow.tsx", import.meta.url), "utf8");
      const copy = source.match(/feeUnavailable: vi \? "([^"]+)" : "([^"]+)"/);
      assert.ok(copy);
      const unavailable = copy[locale === "vi" ? 1 : 2];
      assert.equal(prose[1], unavailable);
      if (status === "unavailable") assert.equal(prose[0], unavailable);
    });
  }
  test(`Repair Gate E ${locale}: available numeric cost rows keep compact value treatment`, () => {
    const html = renderSend({ locale, reviewing: true });
    assert.doesNotMatch(html, /class="review-detail-prose"/);
    assert.match(html, /1\.234568 USDC/);
  });
}

test("Repair Gate E: shared prose styling overrides truncation without removing compact defaults", () => {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  const prose = css.match(/\.transaction-safety-review \.wallet-review dd\.review-detail-prose\{([^}]+)\}/)?.[1];
  assert.ok(prose);
  for (const rule of ["min-width:0", "white-space:normal", "overflow-wrap:anywhere", "overflow:visible", "text-overflow:clip"]) assert.ok(prose.includes(rule), rule);
  assert.match(css, /\.compact-review-summary dd\{[^}]*overflow:hidden;text-overflow:ellipsis;white-space:nowrap/);
});
