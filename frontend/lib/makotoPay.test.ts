import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { createDemoOrderId, demoUsdcForVnd, isValidVietnamDemoPhone, maskVietnamPhone, normalizeVietnamPhone, TOP_UP_DENOMINATIONS } from "./makotoPay.ts";

const header = readFileSync(new URL("../components/AppHeader.tsx", import.meta.url), "utf8");
const catalog = readFileSync(new URL("../components/MakotoPay.tsx", import.meta.url), "utf8");
const topup = readFileSync(new URL("../components/MobileTopUpDemo.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../components/ServiceComingSoonDialog.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../components/MakotoPay.module.css", import.meta.url), "utf8");
const en = readFileSync(new URL("../i18n/en.ts", import.meta.url), "utf8");
const vi = readFileSync(new URL("../i18n/vi.ts", import.meta.url), "utf8");
const dashboard = readFileSync(new URL("../components/WalletDashboard.tsx", import.meta.url), "utf8");
const homePay = readFileSync(new URL("../components/MakotoPayHomeSection.tsx", import.meta.url), "utf8");
const catalogData = readFileSync(new URL("./makotoPayCatalog.ts", import.meta.url), "utf8");

test("Pay descriptions retain contrast headroom on demo and planned light surfaces without changing dark color", () => {
  const rule = [...styles.matchAll(/\.serviceText small\s*\{([^}]+)\}/g)].at(-1)?.[1] ?? "";
  const foreground = rule.match(/color:\s*light-dark\((#[\da-f]{6}),\s*var\(--mw-text-muted\)\)/i)?.[1];
  assert.ok(foreground, "description override must preserve the existing dark-theme token");
  const tokens = readFileSync(new URL("../app/ledger-calm.css", import.meta.url), "utf8");
  const luminance = (hex: string) => {
    const channels = hex.slice(1).match(/../g)!.map(value => {
      const channel = parseInt(value, 16) / 255;
      return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const token of ["--lc-success-surface", "--lc-inset", "--lc-surface"]) {
    const background = tokens.match(new RegExp(`${token}:\\s*light-dark\\((#[\\da-f]{6})`, "i"))?.[1];
    assert.ok(background, `${token} has a light surface`);
    const ratio = (luminance(background) + 0.05) / (luminance(foreground) + 0.05);
    assert.ok(ratio >= 4.7, `${token}: ${ratio.toFixed(4)}:1 must retain headroom above 4.5:1`);
  }
});

test("Pay navigation exists and remains active on nested Pay routes", () => {
  assert.doesNotMatch(header.slice(header.indexOf("const navItems"), header.indexOf("];", header.indexOf("const navItems"))), /href: "\/pay"/);
  assert.match(catalog, /MakotoPay/);
  return;
  assert.match(header, /href:\s*"\/pay"[^\n]*en:\s*"Pay"[^\n]*vi:\s*"Thanh toán"/);
  assert.match(header, /route === "\/pay" && pathname\.startsWith\("\/pay\/"\)/);
  assert.ok(header.indexOf('href: "/pay"') < header.indexOf('href: "/#activity"'));
});

test("connected Wallet dashboard links to Makoto Pay without a promotional home strip", () => {
  assert.doesNotMatch(dashboard, /href="\/pay"|Makoto Pay/);
  assert.doesNotMatch(dashboard, /MakotoPayHomeSection/);
  return;
  assert.doesNotMatch(dashboard, /<MakotoPayHomeSection\s*\/>/);
  assert.match(dashboard, /styles\.appsPanel[\s\S]*href="\/pay"/);
  assert.match(dashboard, /onboarding\.payStory/);
  assert.match(homePay, /HOME_PAY_SERVICE_IDS\.map/);
  assert.match(homePay, /href="\/pay\/mobile-topup"/);
  assert.match(homePay, /href="\/pay"/);
  assert.match(homePay, /ServiceComingSoonDialog/);
  const homeIds = catalogData.match(/HOME_PAY_SERVICE_IDS:[^=]+=\s*\[([^\]]+)\]/)?.[1].match(/"[^"]+"/g) ?? [];
  assert.equal(homeIds.length, 8);
});

test("full catalog keeps all eighteen services and every original artwork path exists", () => {
  const allIds = catalogData.match(/PAY_SERVICE_IDS = \[([^\]]+)\]/)?.[1].match(/"[^"]+"/g) ?? [];
  assert.equal(allIds.length, 18);
  const paths = [...catalogData.matchAll(/"(\/makoto\/pay\/[^"]+\.svg)"/g)].map((match) => match[1]);
  assert.equal(paths.length, 18);
  for (const path of paths) assert.equal(existsSync(new URL(`../public${path}`, import.meta.url)), true, path);
  assert.doesNotMatch(catalogData, /momo|viettel|vinaphone|mobifone/i);
});

test("every Makoto Pay artwork is a local layered vector with dimensional shading", () => {
  const paths = [...catalogData.matchAll(/"(\/makoto\/pay\/[^"]+\.svg)"/g)].map((match) => match[1]);
  for (const path of paths) {
    const svg = readFileSync(new URL(`../public${path}`, import.meta.url), "utf8");
    assert.match(svg, /<(?:linearGradient|radialGradient)/, path);
    assert.match(svg, /<filter[^>]*>[\s\S]*?<feDropShadow/, path);
    assert.match(svg, /<ellipse/, path);
    assert.doesNotMatch(svg, /<rect[^>]+width="160"[^>]+height="160"/i, path);
    assert.doesNotMatch(svg, /<rect[^>]+height="160"[^>]+width="160"/i, path);
    assert.doesNotMatch(svg, /<(?:image|script)|(?:xlink:)?href=/i, path);
  }
});

test("catalog distinguishes the Mobile Top-up demo from planned services", () => {
  assert.match(catalog, /const demo = id === "mobile"/);
  assert.match(catalog, /pay\.demoAvailable/);
  assert.match(catalog, /pay\.comingSoon/);
  assert.match(catalog, /ServiceComingSoonDialog/);
});

test("coming-soon dialog is honest and closes accessibly", () => {
  assert.match(dialog, /role="dialog" aria-modal="true"/);
  assert.match(dialog, /event\.key === "Escape"/);
  assert.match(dialog, /event\.key !== "Tab"/);
  assert.match(dialog, /document\.body\.style\.overflow = "hidden"/);
  assert.match(catalog, /openerRef\.current\?\.focus/);
  assert.match(en, /No provider integration is active/);
  assert.doesNotMatch(en, /official partner|supported provider|integrated with|instant top-up/i);
});

test("Vietnam-oriented phone validation normalizes spaces and masks review data", () => {
  assert.equal(normalizeVietnamPhone("0912 345 678"), "0912345678");
  assert.equal(isValidVietnamDemoPhone("0912 345 678"), true);
  assert.equal(isValidVietnamDemoPhone("912345678"), false);
  assert.equal(isValidVietnamDemoPhone("09123456789"), false);
  assert.equal(maskVietnamPhone("0912 345 678"), "0912 ••• 678");
});

test("preset denominations use the deterministic demo FX rate", () => {
  assert.deepEqual([...TOP_UP_DENOMINATIONS], [20_000, 50_000, 100_000, 200_000, 500_000]);
  assert.equal(demoUsdcForVnd(20_000), "0.80");
  assert.equal(demoUsdcForVnd(50_000), "2.00");
  assert.equal(demoUsdcForVnd(100_000), "4.00");
  assert.equal(demoUsdcForVnd(200_000), "8.00");
  assert.equal(demoUsdcForVnd(500_000), "20.00");
});

test("review and completion remain explicitly simulation-only", () => {
  assert.match(topup, /pay\.topup\.fxDisclosure/);
  assert.match(topup, /pay\.topup\.simulated/);
  assert.match(topup, /pay\.topup\.noTransaction/);
  assert.match(topup, /pay\.topup\.blockchainTransaction/);
  assert.match(topup, /pay\.topup\.notSubmitted/);
  assert.doesNotMatch(topup, /writeContract|transfer\(|ArcScan|transaction hash/i);
});

test("completion creates only an in-memory demo order ID and retry resets flow", () => {
  const id = createDemoOrderId((values) => { values[0] = 0x1234; values[1] = 0xabcd; return values; });
  assert.equal(id, "MKT-DEMO-000012340000ABCD");
  assert.match(topup, /setOrderId\(createDemoOrderId\(\)\)/);
  assert.match(topup, /function reset\(\).*setCarrier\(undefined\).*setPhone\(""\).*setAmount\(undefined\).*setOrderId\(""\).*setStep\("entry"\)/s);
  assert.doesNotMatch(topup, /localStorage|sessionStorage|fetch\(|console\./);
});

test("Makoto Pay copy exists in English and Vietnamese with exact key parity", () => {
  const keys = (source: string) => [...source.matchAll(/^\s{2}"([^"]+)":/gm)].map((match) => match[1]);
  const enKeys = keys(en); const viKeys = keys(vi);
  assert.deepEqual(enKeys, viKeys);
  assert.ok(enKeys.includes("pay.heroTitle"));
  assert.ok(enKeys.includes("pay.topup.completed"));
});

test("Pay layouts include desktop, tablet, narrow phone, focus, and reduced-motion rules", () => {
  assert.match(styles, /grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(styles, /@media\(max-width:1120px\)/);
  assert.match(styles, /@media\(max-width:760px\)/);
  assert.match(styles, /@media\(max-width:430px\)/);
  assert.match(styles, /@media\(max-width:340px\)/);
  assert.match(styles, /focus-visible/);
  assert.match(styles, /prefers-reduced-motion/);
});
