import assert from "node:assert/strict";
const base = "http://127.0.0.1:5178";
assert.equal((await fetch(base + "/api/catalog")).status, 401);
const login = await fetch(base + "/signin-with-chatgpt?return_to=/", {
  redirect: "manual",
});
const cookie = login.headers
  .getSetCookie()
  .map((c) => c.split(";")[0])
  .join("; ");
assert.ok(cookie);
const headers = { cookie, "Content-Type": "application/json" };
let response = await fetch(base + "/api/catalog", { headers });
assert.equal(response.status, 200);
let data = await response.json();
const post = (body, extra = {}) =>
  fetch(base + "/api/catalog", {
    method: "POST",
    headers: { ...headers, ...extra },
    body: JSON.stringify(body),
  });
if (!data.workspace) {
  response = await post({
    action: "createWorkspace",
    name: "本地接口验证空间",
    priceBasis: "示例人民币供货价",
  });
  assert.equal(response.status, 201);
  data = await response.json();
}
let w = data.workspace;
const payload = {
  name: `示例接口商户-${Date.now()}`,
  contact: "本地测试",
  location: "示例档口",
  categories: "示例品类",
};
const command = {
  action: "registerMerchant",
  payload,
  workspaceId: w.id,
  revision: w.revision,
};
response = await post(command);
assert.equal(response.status, 200);
const saved = await response.json();
response = await fetch(base + `/api/catalog?workspaceId=${w.id}`, { headers });
const persisted = await response.json();
assert.equal(persisted.workspace.revision, saved.workspace.revision);
assert.ok(
  persisted.workspace.data.merchants.some((m) => m.name === payload.name),
);
assert.equal((await post(command)).status, 409);
assert.equal(
  (
    await post({
      ...command,
      revision: saved.workspace.revision,
      actor: { role: "operations" },
    })
  ).status,
  400,
);
assert.equal(
  (
    await post(
      { ...command, revision: saved.workspace.revision },
      { Origin: "https://untrusted.example" },
    )
  ).status,
  403,
);
assert.equal((await fetch(base + "/api/workspace", { headers })).status, 404);
console.log(
  "PASS: local sign-in, real D1 persistence, revision conflicts, forged role rejection, cross-origin rejection and retired prototype route.",
);

// Use new, explicitly labeled validation records; never edit an existing merchant's goods.
w = persisted.workspace;
const apply = async (action, payload) => {
  const result = await post({
    workspaceId: w.id,
    revision: w.revision,
    action,
    payload,
  });
  const body = await result.json();
  assert.equal(result.status, 200, body.error || action);
  w = body.workspace;
  return w;
};
const merchant = w.data.merchants.find((m) => m.name === payload.name);
await apply("reviewMerchant", {
  id: merchant.id,
  status: "active",
  note: "本地维护流程验证，非真实供货商户",
});
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGaIAAAAASUVORK5CYII=",
  "base64",
);
response = await fetch(`${base}/api/catalog/images?workspaceId=${w.id}`, {
  method: "POST",
  headers: { cookie, "Content-Type": "image/png" },
  body: png,
});
assert.equal(response.status, 201, await response.clone().text());
const { imageUrl } = await response.json();
assert.equal((await fetch(base + imageUrl)).status, 401);
const imageResponse = await fetch(base + imageUrl, { headers: { cookie } });
assert.equal(imageResponse.status, 200);
assert.equal(imageResponse.headers.get("Content-Type"), "image/png");
assert.deepEqual(Buffer.from(await imageResponse.arrayBuffer()), png);
const skuCode = `API-${Date.now()}`;
await apply("submitSku", {
  code: skuCode,
  name: "示例维护验证商品",
  category: "家居日用",
  origin: "本地测试",
  model: skuCode,
  material: "测试材料",
  specification: "测试规格",
  quality: "本地验证",
  unit: "件",
  packaging: "10件/箱",
  imageUrl,
});
const sku = w.data.skus.find((s) => s.code === skuCode);
await apply("reviewSku", {
  id: sku.id,
  status: "active",
  note: "本地验证图片与商品，非正式货盘",
});
const day = (offset) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(
    new Date(Date.now() + offset * 86400000),
  );
await apply("saveOffer", {
  skuId: sku.id,
  merchantId: merchant.id,
  merchantCode: skuCode,
  unitPrice: 920,
  availableQuantity: 50,
  minimumQuantity: 10,
  quantityStep: 10,
  leadDays: 3,
  deliveryLocation: "本地验证交货点",
  validUntil: day(1),
});
let offer = w.data.offers.find((o) => o.skuId === sku.id);
await apply("reviewOffer", {
  id: offer.id,
  expectedVersion: offer.version,
  status: "active",
  note: "本地维护验证",
});
offer = w.data.offers.find((o) => o.id === offer.id);
await apply("updateOfferTerms", {
  id: offer.id,
  expectedVersion: offer.version,
  availableQuantity: 20,
  confirmationNote: "本地改量验证，无实际采购",
});
offer = w.data.offers.find((o) => o.id === offer.id);
assert.equal(offer.availableQuantity, 20);
assert.equal(offer.validUntil, day(1));
await apply("updateOfferTerms", {
  id: offer.id,
  expectedVersion: offer.version,
  validUntil: day(14),
  conditionsConfirmed: true,
  confirmationNote: "本地续期验证，已核实测试条件",
});
offer = w.data.offers.find((o) => o.id === offer.id);
assert.equal(offer.validUntil, day(14));
await apply("pauseOffer", { id: offer.id, expectedVersion: offer.version });
console.log(
  "PASS: real local R2 upload and protected read, SKU association, quick quantity update, explicit renewal and pause. Validation offer left paused.",
);

const acceptPage = await fetch(base + "/accept");
assert.equal(acceptPage.status, 200);
assert.ok((await acceptPage.text()).includes("账号邀请与商户认领"));
for (const payload of [
  { kind: "claim", merchantId: merchant.id },
  { kind: "operations", label: "本地验证运营邀请" },
]) {
  const issuedResponse = await post({
    workspaceId: w.id,
    revision: w.revision,
    action: "issueAccessInvitation",
    payload,
  });
  const issued = await issuedResponse.json();
  assert.equal(issuedResponse.status, 200, issued.error);
  w = issued.workspace;
  assert.ok(issued.accessInvitationCode);
  const preview = await post({
    action: "inspectAccessInvitation",
    invitationCode: issued.accessInvitationCode,
  });
  assert.equal(preview.status, 200);
  assert.equal((await preview.json()).invitation.kind, payload.kind);
  assert.ok(!JSON.stringify(w).includes("tokenHash"));
  const selfClaim = await post({
    action: "requestAccess",
    invitationCode: issued.accessInvitationCode,
    payload: { name: "测试负责人", contact: "本地验证" },
  });
  assert.equal(
    selfClaim.status,
    400,
    "workspace owner cannot bind a second role to their account",
  );
  await apply("revokeAccessInvitation", {
    id: w.data.accessInvitations[0].id,
    note: "本地邀请验证结束，撤销测试链接",
  });
  assert.equal(
    (
      await post({
        action: "inspectAccessInvitation",
        invitationCode: issued.accessInvitationCode,
      })
    ).status,
    410,
  );
}
console.log(
  "PASS: acceptance entry, real D1 claim/operator invitation persistence, role-conflict rejection, and revoked link rejection. Test invitations left revoked; multi-account flows covered by SQLite tests.",
);
