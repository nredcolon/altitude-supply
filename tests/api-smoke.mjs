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
const w = data.workspace;
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
