import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
// @ts-expect-error Test-only renderer uses the existing TypeScript compiler for real production JSX.
import { renderSend, renderReceive, account, recipient } from "../scripts/phase7e-fixture.mjs";

for (const locale of ["en", "vi"]) {
  test(`7E ${locale}: Send input order and native asset precision`, () => {
    const html = renderSend({locale});
    const order = ['class="send-source-context"', 'id="send-asset"', 'id="send-available"', 'id="send-amount"', 'id="send-recipient"', 'class="send-network-context"'].map(s=>html.indexOf(s));
    assert.ok(order.every(n=>n>=0)); assert.deepEqual(order,[...order].sort((a,b)=>a-b));
    assert.ok(html.includes(locale === "en" ? "External Wallet" : "Ví ngoài"));
    assert.ok(html.includes("Arc Testnet"));
    assert.ok(html.includes("123.456789")); assert.ok(html.includes('value="1.234567"'));
    assert.ok(html.includes('aria-describedby="send-available"'));
    const cirbtc = renderSend({locale,assetId:"cirbtc",amount:"1.23456789",balance:123456789n});
    assert.match(cirbtc,/value="cirbtc" selected/); assert.match(cirbtc,/>1\.23456789 cirBTC</);
  });
  test(`7E ${locale}: selected EURC and zero balance stay truthful`, () => {
    const html=renderSend({locale,assetId:"eurc",balance:0n});
    assert.match(html,/value="eurc" selected/); assert.match(html,/>0 EURC</);
  });
  test(`7E ${locale}: invalid recipient is associated with descriptive feedback`, () => {
    const html=renderSend({locale,recipient:"bad"});
    assert.match(html,/id="send-recipient"[^>]*aria-invalid="true"/);
    assert.match(html,/aria-describedby="send-recipient-context"/);
    assert.ok(html.includes(locale === "en" ? "Enter a valid wallet address." : "Nhập địa chỉ ví hợp lệ."));
  });
  test(`7E ${locale}: own and valid addresses use qualified status`, () => {
    assert.ok(renderSend({locale,recipient:account}).includes(locale === "en" ? "connected wallet’s address" : "ví đang kết nối"));
    assert.ok(renderSend({locale}).includes(locale === "en" ? "Valid address format" : "Định dạng địa chỉ hợp lệ"));
  });
  test(`7E ${locale}: full recipient appears before Review disclosure`, () => {
    const html=renderSend({locale,reviewing:true});
    assert.ok(html.indexOf(recipient)<html.indexOf('<details'));
    assert.ok(html.includes(locale === "en" ? "Estimated network fee" : "Phí mạng ước tính"));
    assert.ok(html.includes(locale === "en" ? "connected external wallet will request confirmation" : "Ví ngoài đã kết nối sẽ yêu cầu xác nhận"));
    assert.ok(html.includes(locale === "en" ? "Continue to wallet" : "Tiếp tục đến ví"));
  });
  test(`7E ${locale}: unavailable fee is explicitly unavailable`, () => {
    const html=renderSend({locale,reviewing:true,fee:{status:"unavailable"}});
    assert.ok(html.includes(locale === "en" ? "Fee estimate unavailable" : "Không thể ước tính phí"));
    assert.doesNotMatch(html,/>0 USDC</);
  });
  for(const assessment of ["blocked","unknown","ready"]) test(`7E ${locale}: ${assessment} Review retains CTA eligibility`,()=>{
    const html=renderSend({locale,reviewing:true,assessment});
    const button=html.match(/<button type="button" class="primary-action"[^>]*>/)?.[0];
    assert.ok(button); assert.equal(button.includes("disabled"),assessment!=="ready");
  });
  for(const stage of ["awaiting","confirming"]) test(`7E ${locale}: ${stage} disables Back and modal close`,()=>{
    const html=renderSend({locale,reviewing:true,stage});
    assert.match(html,/<button type="button" class="secondary-action" disabled=""/);
    assert.match(html,/<button type="button" aria-label="[^"]+" disabled=""/);
  });
  test(`7E ${locale}: Receive prioritizes exact address and copy before QR/request`,()=>{
    const html=renderReceive({locale});
    assert.ok(html.indexOf(account)<html.indexOf('class="receive-qr-card"'));
    assert.ok(html.indexOf('class="receive-qr-card"')<html.indexOf('class="receive-request"'));
    assert.ok(html.includes('id="receive-asset"')); assert.ok(html.includes('aria-labelledby="receive-address-label"'));
    assert.ok(html.includes("cirBTC · Circle Wrapped Bitcoin"));
    assert.ok(html.includes(locale === "en" ? "Only send supported assets on Arc Testnet" : "Chỉ gửi tài sản được hỗ trợ trên Arc Testnet"));
    assert.ok(html.includes(locale === "en" ? "does not mean funds have been received" : "không có nghĩa là tiền đã được nhận"));
  });
}
test("7E disconnected receive remains gated by the dashboard",()=>{
  const dashboard=readFileSync(new URL("../components/WalletDashboard.tsx",import.meta.url),"utf8");
  assert.match(dashboard,/action === "receive" && wallet.address && \(\s*<ReceivePanel\s*address=\{wallet.address\}/);
});
