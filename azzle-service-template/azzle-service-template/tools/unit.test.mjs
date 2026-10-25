// Pure unit tests (no network): cost math, order schema, scope builder. Run: node --test tools/unit.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { collateralEth, collateralUsdc, azlToUsd6Ceil, checkoutTotals } from "../src/lib/cost-math.mjs";
import { validateOrderInput, publicFields, privateCanonical, privateHash, isOrderId, ORDER_PREFIX, FIELDS } from "../src/lib/order-schema.mjs";
import { buildScope, parseScope, APP_TAG } from "../src/lib/azzle-core.mjs";

// 1 ETH = $3000, 1 ETH = 6,000,000 AZL  =>  1 AZL = $0.0005
const quote = { ethUsdWad: 3000n * 10n ** 18n, azlPerEth: 6_000_000n * 10n ** 18n };
const AZL = (n) => BigInt(n) * 10n ** 18n;

test("collateralUsdc: 130% of the shortfall, rounded up to whole cents; minOut 90%", () => {
  const r = collateralUsdc(AZL(10_000), quote); // 10k AZL = $5.00 -> 130% = $6.50
  assert.equal(r.usdcIn, 6_500_000n);
  assert.equal(r.minOut, (AZL(13_000) * 90n) / 100n);
  const odd = collateralUsdc(AZL(10_001), quote); // $5.0005 * 1.3 = $6.50065 -> $6.51
  assert.equal(odd.usdcIn, 6_510_000n);
  assert.equal(collateralUsdc(0n, quote), null);
  assert.equal(collateralUsdc(AZL(1), null), null);
});

test("collateralEth: 130% in ETH (+1 wei), minOut 90% of nominal", () => {
  const r = collateralEth(AZL(6_000_000), quote); // 1 ETH worth
  assert.equal(r.ethIn, 13n * 10n ** 17n + 1n);
  assert.ok(r.minOut <= (AZL(6_000_000) * 130n * 90n) / 10000n + 10n ** 18n);
});

test("azlToUsd6Ceil rounds up to cents", () => {
  assert.equal(azlToUsd6Ceil(AZL(2_000), quote), 1_000_000n); // exactly $1
  assert.equal(azlToUsd6Ceil(AZL(2_001), quote), 1_010_000n);
  assert.equal(azlToUsd6Ceil(null, quote), null);
});

test("checkoutTotals: deposit + fee + service; refundable = deposit - fee; fee waived by credit", () => {
  const ready = { collateralShortfall: AZL(10_000), azlShortfall: AZL(10_000), quote: { accessFee: AZL(2_000) }, creditWaives: false };
  const t = checkoutTotals({ quote, ready, swapQ: { usdcIn: 5_050_000n }, usdcBal: 20_000_000n });
  assert.equal(t.depositToday, 6_500_000n);
  assert.equal(t.feeUsd6, 1_000_000n);
  assert.equal(t.refundable, 5_500_000n);
  assert.equal(t.serviceUsdc, 5_050_000n);
  assert.equal(t.total, 11_550_000n);
  assert.equal(t.shortToday, false);
  assert.equal(t.shortLater, false);
  const w = checkoutTotals({ quote, ready: { ...ready, creditWaives: true }, swapQ: { usdcIn: 5_050_000n }, usdcBal: 1n });
  assert.equal(w.feeUsd6, 0n);
  assert.equal(w.shortToday, true);
  const none = checkoutTotals({ quote, ready: { collateralShortfall: 0n, azlShortfall: 0n, quote: { accessFee: AZL(1) } }, swapQ: null });
  assert.equal(none.depositToday, 0n);
  assert.equal(none.serviceUsdc, 0n);
  assert.equal(none.total, 0n);
  assert.equal(checkoutTotals({ quote: null, ready: null, swapQ: null }).total, null);
});

test("order schema: validates, normalizes and splits public/private", () => {
  assert.ok(FIELDS.length > 0);
  const bad = validateOrderInput({ sourceUrl: "javascript:alert(1)" });
  assert.ok(bad.errors.sourceUrl);
  const creds = validateOrderInput({ sourceUrl: "https://u:p@example.com" });
  assert.ok(creds.errors.sourceUrl);
  const missing = validateOrderInput({});
  for (const f of FIELDS.filter((f) => f.required)) assert.ok(missing.errors[f.name], `${f.name} required`);
  const raw = {};
  for (const f of FIELDS) {
    if (f.type === "url") raw[f.name] = "https://example.com/x";
    else if (f.type === "select") raw[f.name] = f.options[0].value;
    else if (f.type === "colors") raw[f.name] = "#aabbcc";
    else if (f.type === "email") raw[f.name] = "a@example.com";
    else raw[f.name] = "hello";
  }
  const ok = validateOrderInput(raw);
  assert.deepEqual(ok.errors, {});
  const pub = publicFields(ok.values);
  for (const f of FIELDS) assert.equal(f.name in pub, !!f.public, `${f.name} public=${!!f.public}`);
  const priv = FIELDS.filter((f) => !f.public);
  if (priv.length) {
    assert.match(privateHash(ok.values), /^0x[0-9a-f]{64}$/);
    assert.equal(privateHash(ok.values), privateHash({ ...ok.values }));
    for (const f of priv) assert.ok(privateCanonical(ok.values).includes(f.name));
  }
  const long = validateOrderInput({ ...raw, [FIELDS.find((f) => f.type === "textarea")?.name || "x"]: "a".repeat(100_000) });
  if (FIELDS.some((f) => f.type === "textarea")) assert.ok(Object.keys(long.errors).length);
});

test("order ids", () => {
  assert.ok(isOrderId(`${ORDER_PREFIX}_abc123`));
  assert.ok(!isOrderId("../etc/passwd"));
  assert.ok(!isOrderId(`${ORDER_PREFIX}_ABC`));
});

test("scope: v1 JSON with only public fields + private hash; round-trips", () => {
  const values = validateOrderInput({ sourceUrl: "https://example.com", notes: "secret plans" }).values;
  const s = buildScope({ orderId: `${ORDER_PREFIX}_abc123`, fields: publicFields(values), privateHash: privateHash(values), siteUrl: "https://shop.example" });
  const p = parseScope(s);
  assert.equal(p.app, APP_TAG);
  assert.equal(p.v, 1);
  assert.equal(p.order, `${ORDER_PREFIX}_abc123`);
  assert.ok(!s.includes("secret plans"), "private values never enter the scope");
  assert.match(p.deliver, /review at https:\/\/shop\.example\/order\//);
  assert.throws(() => buildScope({ orderId: "x", fields: { big: "a".repeat(9000) } }));
});
