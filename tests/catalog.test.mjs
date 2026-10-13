import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyCatalog,
  applyApplication,
  applyCatalogCommand,
  offerAvailability,
  viewCatalog,
} from "../lib/catalog/domain.ts";

const now = new Date("2026-10-13T08:00:00Z");
const merchant = {
  name: "示例云禾",
  contact: "测试联系人",
  location: "示例档口",
  categories: "家居日用",
};
const sku = {
  code: "HOME-001",
  name: "示例收纳篮",
  category: "家居日用",
  origin: "示例工厂",
  model: "B-1",
  material: "PP",
  specification: "白色32×24×18cm",
  quality: "样品编号 SAMPLE-01 标准",
  unit: "件",
  packaging: "单件袋装，20件/箱",
  imageUrl: "",
};
const act = (s, action, payload, user = "owner") =>
  applyCatalogCommand(s, user, action, payload, now);
export function fixture() {
  let s = emptyCatalog("owner", "人民币含税商品供货价，运费另计");
  s = applyApplication(s, "merchantA", merchant, now);
  s = applyApplication(
    s,
    "merchantB",
    { ...merchant, name: "示例织物里" },
    now,
  );
  for (const m of s.merchants)
    s = act(s, "reviewMerchant", {
      id: m.id,
      status: "active",
      note: "已核实示例资料",
    });
  s = act(s, "submitSku", sku);
  s = act(s, "reviewSku", {
    id: s.skus[0].id,
    status: "active",
    note: "示例标准一致",
  });
  return s;
}
export function offerFor(s, i = 0) {
  return {
    skuId: s.skus[0].id,
    merchantId: s.merchants[i].id,
    merchantCode: `TEST-${i}`,
    unitPrice: 920,
    availableQuantity: 400,
    minimumQuantity: 100,
    quantityStep: 20,
    leadDays: 3,
    deliveryLocation: "示例昆明仓",
    validUntil: "2026-10-20",
  };
}

test("商户申请到准入，未准入不能提交商品；身份由账号确定", () => {
  const s = applyApplication(
    emptyCatalog("owner", "统一价"),
    "merchantA",
    merchant,
    now,
  );
  assert.equal(viewCatalog(s, "merchantA").access.role, "merchant");
  assert.throws(() => act(s, "submitSku", sku, "merchantA"), /准入/);
  assert.throws(
    () =>
      act(
        s,
        "reviewMerchant",
        { id: s.merchants[0].id, status: "active", note: "冒充运营" },
        "merchantA",
      ),
    /只有运营/,
  );
  assert.throws(() => viewCatalog(s, "outsider"), /访问权限/);
});
test("同一 SKU 支持两家供应商，商品身份不包含供货价或库存", () => {
  let s = fixture();
  s = act(s, "saveOffer", offerFor(s), "merchantA");
  s = act(s, "saveOffer", { ...offerFor(s, 1), unitPrice: 890 }, "merchantB");
  assert.equal(s.skus.length, 1);
  assert.equal(s.offers.length, 2);
  assert.ok(!("unitPrice" in s.skus[0]));
  assert.ok(!("availableQuantity" in s.skus[0]));
  assert.equal(s.offers[1].unitPrice, 890);
});
test("商户只能修改自己的报价，接口投影不包含其他商户底价或账号", () => {
  let s = fixture();
  s = act(s, "saveOffer", offerFor(s), "merchantA");
  s = act(s, "saveOffer", offerFor(s, 1), "merchantB");
  const visible = viewCatalog(s, "merchantA");
  assert.equal(visible.offers.length, 1);
  assert.equal(visible.merchants.length, 1);
  assert.equal(visible.merchants[0].userId, "[已绑定]");
  assert.ok(!JSON.stringify(visible).includes("merchantB"));
  assert.throws(
    () => act(s, "saveOffer", offerFor(s, 1), "merchantA"),
    /其他商户/,
  );
  assert.throws(
    () =>
      act(
        s,
        "pauseOffer",
        { id: s.offers[1].id, expectedVersion: 1 },
        "merchantA",
      ),
    /其他商户/,
  );
});
test("同商户同 SKU 禁止重复挂价，不同品牌或规格保持独立身份", () => {
  let s = fixture();
  s = act(s, "saveOffer", offerFor(s));
  assert.throws(() => act(s, "saveOffer", offerFor(s)), /已为此 SKU/);
  assert.throws(
    () => act(s, "submitSku", { ...sku, code: "HOME-OTHER", name: "换了名字" }),
    /相同商品身份/,
  );
  assert.throws(
    () => act(s, "submitSku", { ...sku, code: "home-001" }),
    /编码已存在/,
  );
  s = act(s, "submitSku", {
    ...sku,
    code: "HOME-002",
    specification: "蓝色32×24×18cm",
  });
  assert.equal(s.skus.length, 2);
  assert.notEqual(s.skus[0].fingerprint, s.skus[1].fingerprint);
});
test("未审核 SKU 与未审核供货关联不能作为有效货源", () => {
  let s = fixture();
  s = act(s, "submitSku", { ...sku, code: "HOME-003", model: "B-3" });
  assert.throws(
    () => act(s, "saveOffer", { ...offerFor(s), skuId: s.skus[1].id }),
    /审核通过/,
  );
  s = act(s, "saveOffer", offerFor(s));
  assert.equal(offerAvailability(s, s.offers[0], now), "供货关联待审核");
});
test("报价审核后更新产生新版本；陈旧编辑及审核被拒绝", () => {
  let s = fixture();
  s = act(s, "saveOffer", offerFor(s));
  const oid = s.offers[0].id;
  s = act(s, "reviewOffer", {
    id: oid,
    expectedVersion: 1,
    status: "active",
    note: "样品与SKU一致",
  });
  s = act(
    s,
    "saveOffer",
    { ...offerFor(s), id: oid, expectedVersion: 2, unitPrice: 950 },
    "merchantA",
  );
  assert.equal(s.offers[0].status, "active");
  assert.equal(s.offers[0].version, 3);
  assert.throws(
    () => act(s, "saveOffer", { ...offerFor(s), id: oid, expectedVersion: 2 }),
    /已更新/,
  );
  assert.throws(
    () =>
      act(s, "reviewOffer", {
        id: oid,
        expectedVersion: 1,
        status: "active",
        note: "旧版本",
      }),
    /已更新/,
  );
  assert.equal(s.events.filter((e) => e.targetId === oid).length, 3);
});
test("过期、下架、数量不满足包装倍数、暂停商户均不能作为有效供给", () => {
  let s = fixture();
  s = act(s, "saveOffer", offerFor(s));
  s = act(s, "reviewOffer", {
    id: s.offers[0].id,
    expectedVersion: 1,
    status: "active",
    note: "有效供给",
  });
  assert.equal(offerAvailability(s, s.offers[0], now), "可参与匹配");
  assert.equal(
    offerAvailability(s, { ...s.offers[0], validUntil: "2026-10-12" }, now),
    "报价已过期",
  );
  assert.equal(
    offerAvailability(
      s,
      { ...s.offers[0], minimumQuantity: 101, availableQuantity: 119 },
      now,
    ),
    "可供量不足起订要求",
  );
  assert.equal(
    offerAvailability(s, { ...s.offers[0], status: "paused" }, now),
    "商户已下架",
  );
  s = act(s, "reviewMerchant", {
    id: s.merchants[0].id,
    status: "suspended",
    note: "暂停核查",
  });
  assert.equal(offerAvailability(s, s.offers[0], now), "商户未准入或已暂停");
});
test("金额必须为整数分，零库存允许保存，日期与数量严格校验", () => {
  const s = fixture();
  assert.equal(
    act(s, "saveOffer", { ...offerFor(s), availableQuantity: 0 }).offers[0]
      .availableQuantity,
    0,
  );
  for (const patch of [
    { unitPrice: 9.2 },
    { unitPrice: -1 },
    { availableQuantity: -1 },
    { quantityStep: 0 },
    { minimumQuantity: 1.5 },
    { validUntil: "2026-02-30" },
    { validUntil: "2026-10-12" },
  ]) {
    assert.throws(() => act(s, "saveOffer", { ...offerFor(s), ...patch }));
  }
});
test("拒绝失败操作不改变原状态；商户不能自动批准自己提交的 SKU", () => {
  const s = fixture();
  const before = JSON.stringify(s);
  assert.throws(() =>
    act(
      s,
      "reviewSku",
      { id: s.skus[0].id, status: "active", note: "自行审核" },
      "merchantA",
    ),
  );
  assert.equal(JSON.stringify(s), before);
  assert.throws(
    () => applyApplication(s, "merchantA", merchant, now),
    /已提交/,
  );
});

test("被驳回的 SKU 可由原提交人修改，已生效商品身份不可重写", () => {
  let s = fixture();
  s = act(
    s,
    "submitSku",
    { ...sku, code: "DRAFT-001", model: "DRAFT-1" },
    "merchantA",
  );
  const draft = s.skus.at(-1);
  s = act(s, "reviewSku", {
    id: draft.id,
    status: "rejected",
    note: "规格不完整",
  });
  assert.throws(
    () =>
      act(
        s,
        "updateSku",
        { ...sku, id: draft.id, code: "DRAFT-001", model: "DRAFT-1" },
        "merchantB",
      ),
    /其他商户/,
  );
  s = act(
    s,
    "updateSku",
    {
      ...sku,
      id: draft.id,
      code: "DRAFT-001",
      model: "DRAFT-1",
      specification: "补充规格",
    },
    "merchantA",
  );
  assert.equal(s.skus.at(-1).status, "pending");
  assert.equal(s.skus.at(-1).specification, "补充规格");
  assert.throws(
    () => act(s, "updateSku", { ...sku, id: s.skus[0].id }),
    /已生效商品身份/,
  );
});
