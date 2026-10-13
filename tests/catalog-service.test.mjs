import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { catalogService } from "../lib/catalog/service.ts";

// Execute the real repository SQL with SQLite, matching the D1 statement contract.
function setup() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(
    readFileSync(
      new URL("../drizzle/0001_outstanding_the_professor.sql", import.meta.url),
      "utf8",
    ),
  );
  const db = {
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let args = [];
      const wrapper = {
        bind(...values) {
          args = values;
          return wrapper;
        },
        async first() {
          return statement.get(...args) || null;
        },
        async all() {
          return { results: statement.all(...args) };
        },
        async run() {
          return { meta: { changes: Number(statement.run(...args).changes) } };
        },
      };
      return wrapper;
    },
  };
  const service = catalogService(db);
  const now = new Date("2026-10-13T08:00:00Z");
  const call = async (user, input, query = "", headers = {}) => {
    const request = new Request(
      `http://localhost/api/catalog${query}`,
      input
        ? {
            method: "POST",
            headers: { "Content-Type": "application/json", ...headers },
            body: JSON.stringify(input),
          }
        : { headers },
    );
    const result = await service.handle(request, user, now);
    return { status: result.status, body: await result.json() };
  };
  return { call, sqlite };
}
const create = {
  action: "createWorkspace",
  name: "测试供货空间",
  priceBasis: "统一人民币供货价",
};
const application = {
  name: "测试商户",
  contact: "测试联系人",
  location: "测试档口",
  categories: "日用品",
};
const cmd = (workspace, action, payload) => ({
  workspaceId: workspace.id,
  revision: workspace.revision,
  action,
  payload,
});

test("未登录拒绝访问；运营空间不自动创建且从空数据开始", async () => {
  const { call, sqlite } = setup();
  assert.equal((await call(null)).status, 401);
  assert.deepEqual((await call("owner")).body.workspaces, []);
  const created = await call("owner", create);
  assert.equal(created.status, 201);
  assert.equal(created.body.workspace.data.skus.length, 0);
  assert.equal(created.body.workspace.data.access.role, "operations");
  const row = sqlite
    .prepare("SELECT invite_hash FROM catalog_workspaces")
    .get();
  assert.notEqual(
    row.invite_hash,
    created.body.invitationCode,
    "invitation secret is hashed at rest",
  );
  const saved = await call("owner");
  assert.equal(saved.body.workspace.id, created.body.workspace.id);
  assert.equal(saved.body.invitationCode, undefined);
  sqlite.close();
});
test("持久化入驻、运营审核与成员隔离，邀请码不授予运营身份", async () => {
  const { call, sqlite } = setup();
  const created = await call("owner", create);
  const id = created.body.workspace.id;
  assert.equal(
    (await call("outsider", null, `?workspaceId=${id}`)).status,
    403,
  );
  const joined = await call("merchantA", {
    action: "applyMerchant",
    invitationCode: created.body.invitationCode,
    payload: application,
  });
  assert.equal(joined.status, 201);
  assert.equal(joined.body.workspace.data.access.role, "merchant");
  const merchant = joined.body.workspace.data.merchants[0];
  assert.equal(
    (
      await call(
        "merchantA",
        cmd(joined.body.workspace, "reviewMerchant", {
          id: merchant.id,
          status: "active",
          note: "越权",
        }),
      )
    ).status,
    403,
  );
  const owner = await call("owner");
  assert.equal(
    (
      await call(
        "owner",
        cmd(owner.body.workspace, "reviewMerchant", {
          id: merchant.id,
          status: "active",
          note: "已核实",
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("merchantA")).body.workspace.data.merchants[0].status,
    "active",
  );
  assert.equal((await call("outsider")).body.workspaces.length, 0);
  sqlite.close();
});
test("陈旧修订及并发写入不覆盖新数据", async () => {
  const { call, sqlite } = setup();
  const created = await call("owner", create);
  const w = created.body.workspace;
  const attempts = await Promise.all([
    call("owner", cmd(w, "registerMerchant", application)),
    call(
      "owner",
      cmd(w, "registerMerchant", { ...application, name: "另一商户" }),
    ),
  ]);
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
  const saved = await call("owner");
  assert.equal(saved.body.workspace.data.merchants.length, 1);
  assert.equal(
    (
      await call(
        "owner",
        cmd(w, "registerMerchant", { ...application, name: "陈旧提交" }),
      )
    ).status,
    409,
  );
  sqlite.close();
});
test("客户端伪造角色、跨站写入、错误邀请码被拒绝", async () => {
  const { call, sqlite } = setup();
  const created = await call("owner", create);
  assert.equal(
    (
      await call("owner", {
        ...cmd(created.body.workspace, "registerMerchant", application),
        actor: { role: "operations" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "owner",
        cmd(created.body.workspace, "registerMerchant", application),
        "",
        { Origin: "https://untrusted.example" },
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("other", {
        action: "applyMerchant",
        invitationCode: "a".repeat(64),
        payload: application,
      })
    ).status,
    400,
  );
  sqlite.close();
});
test("更新邀请码使旧代码失效，已入驻成员不受影响", async () => {
  const { call, sqlite } = setup();
  const created = await call("owner", create);
  await call("a", {
    action: "applyMerchant",
    invitationCode: created.body.invitationCode,
    payload: application,
  });
  const current = await call("owner");
  const rotated = await call(
    "owner",
    cmd(current.body.workspace, "rotateInvitation", {}),
  );
  assert.equal(rotated.status, 200);
  assert.equal(
    (
      await call("b", {
        action: "applyMerchant",
        invitationCode: created.body.invitationCode,
        payload: { ...application, name: "商户B" },
      })
    ).status,
    400,
  );
  assert.equal((await call("a")).body.workspaces.length, 1);
  sqlite.close();
});
