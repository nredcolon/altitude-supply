import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyCatalog,
  applyApplication,
  applyCatalogCommand,
  offerAvailability,
  viewCatalog,
} from "../lib/catalog/domain.ts";
import {
  supplyHealth,
  matchesSupplyFilter,
} from "../lib/catalog/maintenance.ts";
import {
  applyMembershipCommand,
  requestMembership,
} from "../lib/catalog/membership.ts";

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

function activeOffer() {
  let s = fixture();
  s = act(s, "saveOffer", offerFor(s));
  return act(s, "reviewOffer", {
    id: s.offers[0].id,
    expectedVersion: 1,
    status: "active",
    note: "已核实",
  });
}

test("快捷改价改量保留商品约束，校验账号与版本，运营代录留下核实依据", () => {
  const s = activeOffer();
  const o = s.offers[0];
  const payload = {
    id: o.id,
    expectedVersion: o.version,
    availableQuantity: 260,
  };
  const changed = act(s, "updateOfferTerms", payload, "merchantA");
  assert.equal(changed.offers[0].availableQuantity, 260);
  assert.equal(changed.offers[0].minimumQuantity, o.minimumQuantity);
  assert.equal(changed.offers[0].validUntil, o.validUntil);
  assert.equal(changed.offers[0].version, o.version + 1);
  assert.throws(
    () => act(changed, "updateOfferTerms", payload, "merchantA"),
    /已更新/,
  );
  assert.throws(
    () => act(s, "updateOfferTerms", payload, "merchantB"),
    /其他商户/,
  );
  assert.throws(() => act(s, "updateOfferTerms", payload), /核实/);
  assert.throws(() =>
    act(
      s,
      "updateOfferTerms",
      { ...payload, merchantId: s.merchants[1].id },
      "merchantA",
    ),
  );
  const assisted = act(s, "updateOfferTerms", {
    ...payload,
    confirmationNote: "电话与店主核实",
  });
  assert.match(assisted.events[0].detail, /电话与店主核实/);
  assert.equal(s.offers[0].availableQuantity, 400);
});

test("续期必须确认条件且延长有效期；改价不能隐式续期或恢复已暂停关联", () => {
  let s = activeOffer();
  s.offers[0].validUntil = "2026-10-12";
  const o = s.offers[0];
  const renew = {
    id: o.id,
    expectedVersion: o.version,
    validUntil: "2026-10-27",
  };
  assert.throws(() => act(s, "updateOfferTerms", renew, "merchantA"), /确认/);
  const changed = act(
    s,
    "updateOfferTerms",
    { id: o.id, expectedVersion: o.version, unitPrice: 980 },
    "merchantA",
  );
  assert.equal(
    offerAvailability(changed, changed.offers[0], now),
    "报价已过期",
  );
  const renewed = act(
    s,
    "updateOfferTerms",
    { ...renew, conditionsConfirmed: true },
    "merchantA",
  );
  assert.equal(
    offerAvailability(renewed, renewed.offers[0], now),
    "可参与匹配",
  );
  assert.throws(
    () =>
      act(
        renewed,
        "updateOfferTerms",
        {
          ...renew,
          expectedVersion: renewed.offers[0].version,
          conditionsConfirmed: true,
        },
        "merchantA",
      ),
    /晚于/,
  );
  s = act(s, "pauseOffer", { id: o.id, expectedVersion: o.version });
  assert.throws(
    () =>
      act(
        s,
        "updateOfferTerms",
        {
          ...renew,
          expectedVersion: s.offers[0].version,
          conditionsConfirmed: true,
        },
        "merchantA",
      ),
    /未生效或已暂停/,
  );
});

test("到期提醒按北京时间自然日，低于整箱起订及暂停货源不会显示为可续期有效货源", () => {
  const s = activeOffer();
  const o = { ...s.offers[0], validUntil: "2026-10-14" };
  const beforeMidnight = new Date("2026-10-14T15:59:59Z");
  assert.equal(supplyHealth(s, o, beforeMidnight).daysLeft, 0);
  assert.equal(matchesSupplyFilter(s, o, "expiring", beforeMidnight), true);
  assert.equal(
    matchesSupplyFilter(s, o, "expired", new Date("2026-10-14T16:00:00Z")),
    true,
  );
  assert.equal(
    matchesSupplyFilter(
      s,
      { ...o, availableQuantity: 0 },
      "expiring",
      beforeMidnight,
    ),
    false,
  );
  assert.equal(
    matchesSupplyFilter(
      s,
      { ...o, status: "paused" },
      "expired",
      new Date("2026-10-15"),
    ),
    false,
  );
});

test("商户资料修改重新审核，不能借编辑恢复准入或改他人档案", () => {
  const s = activeOffer();
  const m = s.merchants[0];
  const payload = { ...merchant, id: m.id, contact: "新联系人" };
  const changed = act(s, "updateMerchant", payload, "merchantA");
  assert.equal(changed.merchants[0].status, "pending");
  assert.equal(changed.merchants[0].userId, "merchantA");
  assert.equal(
    offerAvailability(changed, changed.offers[0], now),
    "商户未准入或已暂停",
  );
  assert.throws(
    () => act(s, "updateMerchant", payload, "merchantB"),
    /其他商户/,
  );
});

test("生效 SKU 只有运营可维护图片且不改商品身份", () => {
  const s = activeOffer();
  const payload = {
    id: s.skus[0].id,
    imageUrl: "https://example.com/product.png",
  };
  assert.throws(
    () => act(s, "updateSkuImage", payload, "merchantA"),
    /只有运营/,
  );
  const changed = act(s, "updateSkuImage", payload);
  assert.equal(changed.skus[0].fingerprint, s.skus[0].fingerprint);
  assert.equal(changed.skus[0].status, "active");
  assert.equal(changed.skus[0].imageUrl, payload.imageUrl);
});

test("认领已准入档案完整保留有效供货，绑定后商户只能维护自己的原报价", () => {
  const original = activeOffer();
  // Simulate an operations-entered merchant with existing approved supply.
  original.merchants[0].userId = null;
  const tokenHash = "a".repeat(64);
  const invited = applyMembershipCommand(
    original,
    "owner",
    "issueAccessInvitation",
    { kind: "claim", merchantId: original.merchants[0].id },
    now,
    tokenHash,
  );
  const requested = requestMembership(
    invited,
    tokenHash,
    "newMerchant",
    { name: "档口本人", contact: "测试电话" },
    now,
  );
  const bound = applyMembershipCommand(
    requested,
    "owner",
    "reviewAccessRequest",
    {
      id: requested.accessInvitations[0].id,
      approve: true,
      note: "原联系人当面核实",
    },
    now,
  );
  assert.deepEqual(bound.offers, original.offers);
  assert.deepEqual(bound.skus, original.skus);
  assert.equal(bound.merchants.length, original.merchants.length);
  assert.equal(bound.merchants[0].status, "active");
  assert.equal(offerAvailability(bound, bound.offers[0], now), "可参与匹配");
  const updated = act(
    bound,
    "updateOfferTerms",
    {
      id: bound.offers[0].id,
      expectedVersion: bound.offers[0].version,
      unitPrice: 1080,
    },
    "newMerchant",
  );
  assert.equal(updated.offers[0].unitPrice, 1080);
  assert.equal(updated.offers[0].id, original.offers[0].id);
  assert.throws(
    () => act(bound, "saveOffer", offerFor(bound, 1), "newMerchant"),
    /其他商户/,
  );
  assert.equal(
    original.merchants[0].userId,
    null,
    "original aggregate is immutable",
  );
});

test("绑定确认时再次核实账号状态，拒绝双重身份且失败不污染原记录", () => {
  let s = applyCatalogCommand(
    emptyCatalog("owner", "人民币供货价"),
    "owner",
    "registerMerchant",
    merchant,
    now,
  );
  const tokenHash = "b".repeat(64);
  s = applyMembershipCommand(
    s,
    "owner",
    "issueAccessInvitation",
    { kind: "claim", merchantId: s.merchants[0].id },
    now,
    tokenHash,
  );
  s = requestMembership(
    s,
    tokenHash,
    "applicant",
    { name: "申请人", contact: "测试电话" },
    now,
  );
  s = applyApplication(
    s,
    "applicant",
    { ...merchant, name: "申请期间另行入驻" },
    now,
  );
  const before = structuredClone(s);
  assert.throws(
    () =>
      applyMembershipCommand(
        s,
        "owner",
        "reviewAccessRequest",
        { id: s.accessInvitations[0].id, approve: true, note: "尝试重复绑定" },
        now,
      ),
    /已绑定/,
  );
  assert.deepEqual(s, before);
  const member = {
    id: "member_test",
    userId: "staff",
    name: "停用同事",
    contact: "测试",
    status: "disabled",
    joinedAt: now.toISOString(),
  };
  s.members = [member];
  assert.throws(
    () =>
      applyApplication(s, "staff", { ...merchant, name: "换个身份入驻" }, now),
    /运营账号/,
  );
  assert.throws(
    () =>
      requestMembership(
        s,
        tokenHash,
        "staff",
        { name: "换个身份", contact: "测试电话" },
        now,
      ),
    /其他账号/,
  );
});
