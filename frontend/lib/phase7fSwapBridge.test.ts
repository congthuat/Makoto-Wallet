import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error Test-only renderer extracts production JSX without wallet execution.
import { renderExchange, hash, account } from "../scripts/phase7f-fixture.mjs";

for (const locale of ["en", "vi"]) {
  const vi = locale === "vi";
  test(`7F ${locale}: Swap follows source, balance, amount, destination hierarchy`, () => {
    const html = renderExchange("swap", {locale, state:"form"});
    const positions = [vi ? "Từ tài sản" : "From asset", 'id="swap-available"', 'value="1.234567"', vi ? "Sang tài sản" : "To asset"].map(x=>html.indexOf(x));
    assert.ok(positions.every(x=>x>=0)); assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
    assert.match(html,/aria-describedby="swap-available"/); assert.match(html,/value="eurc" selected/);
    assert.match(renderExchange("swap",{locale,state:"form",asset:"eurc"}),/value="usdc" selected/);
  });
  test(`7F ${locale}: expected and minimum have distinct visible qualifications`, () => {
    const html=renderExchange("swap",{locale,state:"review"});
    const visible=html.slice(0,html.indexOf('<details'));
    for(const label of vi ? ["Dự kiến nhận · báo giá","Tối thiểu nhận · bảo vệ thực thi","Phí mạng ước tính"] : ["Expected receive · quote","Minimum receive · execution protection","Estimated network fee"]) assert.ok(visible.includes(label),label);
    assert.match(visible,/1.123456/); assert.match(visible,/1.117838/);
    assert.equal((html.match(/compact-transaction-review/g)??[]).length,1);
  });
  test(`7F ${locale}: unavailable gas and expired quote block continue`,()=>{
    for(const state of ["unavailable","expired"]) assert.match(renderExchange("swap",{locale,state}),/class="primary-action" disabled/);
  });
  test(`7F ${locale}: preflight, wallet handoff and pending preserve disabled lifecycle controls`,()=>{
    for(const state of ["preflight","awaiting","pending"]) {
      const html=renderExchange("swap",{locale,state});
      assert.match(html,/class="secondary-action" disabled/);assert.match(html,/class="primary-action" disabled/);assert.match(html,/role="status"/);
    }
  });
  test(`7F ${locale}: unknown retains hash and has no retry; failure has explicit retry`,()=>{
    const unknown=renderExchange("swap",{locale,state:"unknown"});
    assert.ok(unknown.includes(hash));assert.doesNotMatch(unknown,/standalone-action/);assert.match(unknown,/submitted-unknown/);
    const failed=renderExchange("swap",{locale,state:"failure"});
    assert.ok(failed.includes(hash));assert.match(failed,/confirmed-failure/);assert.match(failed,/standalone-action/);
  });
  test(`7F ${locale}: success distinguishes receipt amount from quote and unavailable actual`,()=>{
    const html=renderExchange("swap",{locale,state:"success"});
    assert.match(html,/1.123456/);assert.match(html,/1.111111/);assert.ok(html.includes(hash));
    const missing=renderExchange("swap",{locale,state:"success-unavailable"});
    assert.ok(missing.includes(vi ? "chưa xác định" : "unavailable"));assert.doesNotMatch(missing,/1.111111/);
  });
  test(`7F ${locale}: Bridge source, asset, amount and destination are ordered`,()=>{
    const html=renderExchange("bridge",{locale,state:"form"});
    const positions=(vi?["Mạng nguồn","Tài sản nguồn",'value="1.234567"',"Mạng đích","Tài sản đích"]:["From network","Source asset",'value="1.234567"',"To network","Destination asset"]).map(x=>html.indexOf(x));
    assert.ok(positions.every(x=>x>=0));assert.deepEqual(positions,[...positions].sort((a,b)=>a-b));
  });
  test(`7F ${locale}: Bridge exact fees and full recipient stay visible`,()=>{
    const html=renderExchange("bridge",{locale,state:"review"}),visible=html.slice(0,html.indexOf('<details'));
    assert.ok(visible.includes(account));assert.match(visible,/0.000000123456789 ETH/);assert.match(visible,/0.004567 USDC/);
    assert.match(visible,/compact-review-cost/);assert.equal((html.match(/compact-transaction-review/g)??[]).length,1);
    assert.ok(html.includes(vi ? "Ước tính nhận không phải số thực nhận" : "Estimated receive is not actual received"));
  });
  test(`7F ${locale}: Bridge unavailable costs are explicit and observed stages have text`,()=>{
    assert.ok(renderExchange("bridge",{locale,state:"unavailable"}).includes(vi ? "Không khả dụng" : "Unavailable"));
    const html=renderExchange("bridge",{locale,state:"executing"});
    assert.match(html,/class="secondary-action" disabled/);assert.match(html,/role="status"/);assert.ok(html.includes(vi ? "Đã ghi nhận" : "Observed"));
  });
  test(`7F ${locale}: Bridge terminal result replaces review and retains explorer context`,()=>{
    const html=renderExchange("bridge",{locale,state:"success"});
    assert.match(html,/data-status="completed"/);assert.doesNotMatch(html,/compact-transaction-review/);assert.ok(html.includes(account));
    assert.ok(html.includes(vi ? "Giao dịch nguồn" : "Source transaction"));assert.ok(html.includes(vi ? "Giao dịch đích" : "Destination transaction"));
  });
}
