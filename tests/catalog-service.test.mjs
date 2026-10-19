import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { catalogService } from "../lib/catalog/service.ts";
import { catalogImages } from "../lib/catalog/images.ts";
import { emptyCatalog, viewCatalog } from "../lib/catalog/domain.ts";
import {
  initialPlatformSql,
  platformRow,
  sessionFor,
} from "../lib/catalog/platform.ts";

// Execute the real repository SQL with SQLite, matching the D1 statement contract.
function setup(bucket) {
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
  const options = {};
  const service = catalogService(db, bucket, options);
  const now = new Date("2026-10-13T08:00:00Z");
  const call = async (user, input, query = "", headers = {}, at = now) => {
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
    const result = await service.handle(request, user, at);
    return { status: result.status, body: await result.json() };
  };
  // Provision fixtures directly as an administrator, never through the public API.
  async function seed(userId = "owner") {
    const id = crypto.randomUUID();
    const code =
      crypto.randomUUID().replaceAll("-", "") +
      crypto.randomUUID().replaceAll("-", "");
    const digest = Buffer.from(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)),
    ).toString("hex");
    const state = emptyCatalog(userId, create.priceBasis);
    sqlite
      .prepare("INSERT INTO catalog_workspaces VALUES (?, ?, ?, ?, ?, 0, ?, ?)")
      .run(
        id,
        userId,
        create.name,
        digest,
        "2026-10-20T08:00:00.000Z",
        JSON.stringify(state),
        now.toISOString(),
      );
    options.workspaceId ||= id;
    return {
      body: {
        workspace: {
          id,
          name: create.name,
          revision: 0,
          data: viewCatalog(state, userId),
        },
        invitationCode: code,
      },
    };
  }
  return { call, seed, sqlite, db, options };
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

const claimant = { name: "认领测试本人", contact: "核实用测试电话" };
async function issued(setupResult, kind = "claim") {
  const { call, seed } = setupResult;
  let w = (await seed("owner")).body.workspace;
  if (kind === "claim")
    w = (await call("owner", cmd(w, "registerMerchant", application))).body
      .workspace;
  const result = await call(
    "owner",
    cmd(
      w,
      "issueAccessInvitation",
      kind === "claim"
        ? { kind, merchantId: w.data.merchants[0].id }
        : { kind, label: "测试运营同事" },
    ),
  );
  assert.equal(result.status, 200, result.body.error);
  return result.body;
}
const requestAccess = (invitationCode) => ({
  action: "requestAccess",
  invitationCode,
  payload: claimant,
});

test("货盘标准通过真实服务持久化，成员可读而不可越权维护，陈旧配置不覆盖新标准", async () => {
  const { call, seed, sqlite } = setup();
  const initial = await seed();
  let w = initial.body.workspace;
  const category = await call(
    "owner",
    cmd(w, "createCategoryTemplate", {
      name: "测试杯具",
      attributes: ["容量", "颜色"],
    }),
  );
  assert.equal(category.status, 200, category.body.error);
  w = category.body.workspace;
  const template = w.data.categoryTemplates[0];
  const stale = await call(
    "owner",
    cmd(initial.body.workspace, "createDeliveryPoint", {
      name: "过期提交",
      address: "不应保存",
    }),
  );
  assert.equal(stale.status, 409);
  const pointResult = await call(
    "owner",
    cmd(w, "createDeliveryPoint", { name: "测试交货点", address: "测试地址" }),
  );
  assert.equal(pointResult.status, 200);
  w = pointResult.body.workspace;
  const joined = await call("merchant", {
    action: "applyMerchant",
    invitationCode: initial.body.invitationCode,
    payload: application,
  });
  assert.equal(joined.status, 201);
  assert.deepEqual(joined.body.workspace.data.categoryTemplates[0].attributes, [
    "容量",
    "颜色",
  ]);
  assert.equal(
    (
      await call(
        "merchant",
        cmd(joined.body.workspace, "setStandardStatus", {
          kind: "category",
          id: template.id,
          active: false,
        }),
      )
    ).status,
    403,
  );
  w = (await call("owner")).body.workspace;
  w = (
    await call(
      "owner",
      cmd(w, "reviewMerchant", {
        id: w.data.merchants[0].id,
        status: "active",
        note: "测试核实",
      }),
    )
  ).body.workspace;
  const skuInput = {
    code: "SERVICE-TPL",
    name: "测试杯",
    category: template.name,
    categoryTemplateId: template.id,
    attributes: { 容量: "500ml", 颜色: "白色" },
    origin: "测试来源",
    model: "T1",
    material: "测试材质",
    specification: "测试规格",
    quality: "测试标准",
    unit: "件",
    packaging: "单件",
    imageUrl: "",
  };
  const created = await call("merchant", cmd(w, "submitSku", skuInput));
  assert.equal(created.status, 200, created.body.error);
  w = created.body.workspace;
  w = (
    await call(
      "owner",
      cmd(w, "reviewSku", {
        id: w.data.skus[0].id,
        status: "active",
        note: "已核实同款",
      }),
    )
  ).body.workspace;
  const offer = {
    skuId: w.data.skus[0].id,
    merchantId: w.data.merchants[0].id,
    merchantCode: "M1",
    unitPrice: 1200,
    availableQuantity: 40,
    minimumQuantity: 10,
    quantityStep: 10,
    leadDays: 2,
    deliveryLocation: "客户端地址",
    deliveryPointId: w.data.deliveryPoints[0].id,
    validUntil: "2026-10-20",
    conditionsConfirmed: true,
  };
  const saved = await call("merchant", cmd(w, "saveOffer", offer));
  assert.equal(saved.status, 200, saved.body.error);
  w = saved.body.workspace;
  assert.equal(w.data.offers[0].deliveryLocation, "测试交货点 · 测试地址");
  assert.equal(w.data.offers[0].quantityBasis, "free-supply-v1");
  const persisted = JSON.parse(
    sqlite.prepare("SELECT data FROM catalog_workspaces WHERE id = ?").get(w.id)
      .data,
  );
  assert.equal(persisted.skus[0].attributes.容量, "500ml");
  assert.equal(persisted.offers[0].availableQuantity, 40);
  assert.equal(persisted.categoryTemplates[0].active, true);
  assert.equal(persisted.deliveryPoints.length, 1);
  sqlite.close();
});
const inspectAccess = (invitationCode) => ({
  action: "inspectAccessInvitation",
  invitationCode,
});

test("平台只能由管理员离线初始化，重复初始化不覆盖已有账号和数据", async () => {
  const { call, sqlite, db } = setup();
  assert.equal((await call("outsider", create)).status, 403);
  sqlite.exec(
    initialPlatformSql({
      ownerId: "trusted-admin",
      name: "山海供'测试",
      priceBasis: "统一供货价",
    }),
  );
  const before = await platformRow(db);
  assert.equal(before.owner_id, "trusted-admin");
  assert.equal(before.name, "山海供'测试");
  sqlite.exec(
    initialPlatformSql({
      ownerId: "replacement",
      name: "不可覆盖",
      priceBasis: "其他口径",
    }),
  );
  assert.deepEqual(await platformRow(db), before);
  assert.equal((await call("trusted-admin", create)).status, 403);
  assert.equal(
    (await call("trusted-admin")).body.workspace.data.access.isOwner,
    true,
  );
  sqlite.close();
});

test("登录身份决定入口；错误入口不返回后台数据，停用账号不会获得商户身份", async () => {
  const { call, seed, sqlite } = setup();
  const created = await seed();
  const joined = await call("merchant", {
    action: "applyMerchant",
    invitationCode: created.body.invitationCode,
    payload: application,
  });
  const raw = JSON.parse(
    sqlite.prepare("SELECT data FROM catalog_workspaces").get().data,
  );
  assert.deepEqual(sessionFor(raw, null), { status: "anonymous" });
  assert.deepEqual(sessionFor(raw, "outsider"), { status: "unregistered" });
  assert.deepEqual(sessionFor(raw, "owner"), {
    status: "member",
    portal: "operations",
    isOwner: true,
  });
  assert.deepEqual(sessionFor(raw, "merchant"), {
    status: "member",
    portal: "merchant",
    isOwner: false,
  });
  raw.members = [{ id: "staff", userId: "staff", status: "disabled" }];
  assert.deepEqual(sessionFor(raw, "staff"), { status: "disabled" });
  assert.equal((await call("owner", null, "?portal=operations")).status, 200);
  assert.equal((await call("owner", null, "?portal=merchant")).status, 403);
  const forbidden = await call("merchant", null, "?portal=operations");
  assert.equal(forbidden.status, 403);
  assert.equal(forbidden.body.workspace, undefined);
  assert.equal((await call("merchant", null, "?portal=merchant")).status, 200);
  assert.equal((await call("merchant", create)).status, 403);
  assert.equal(
    (
      await call(
        "merchant",
        cmd(joined.body.workspace, "reviewMerchant", {
          id: joined.body.workspace.data.merchants[0].id,
          status: "active",
          note: "越权",
        }),
      )
    ).status,
    403,
  );
  sqlite.close();
});

test("仅开放服务器指定的统一货盘，历史空间、邀请码和图片不能绕过平台边界", async () => {
  const { call, seed, sqlite, db, options } = setup();
  const platform = await seed("owner");
  const legacy = await seed("legacy-owner");
  assert.equal((await call("legacy-owner")).body.workspaces.length, 0);
  assert.equal(
    (
      await call(
        "legacy-owner",
        null,
        `?workspaceId=${legacy.body.workspace.id}`,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("owner", null, `?workspaceId=${legacy.body.workspace.id}`))
      .status,
    403,
  );
  assert.equal(
    (
      await call("new", {
        action: "applyMerchant",
        invitationCode: legacy.body.invitationCode,
        payload: application,
      })
    ).status,
    400,
  );
  const legacyService = catalogService(db, undefined, {
    workspaceId: legacy.body.workspace.id,
  });
  const generated = await legacyService.handle(
    new Request("http://localhost/api/catalog", {
      method: "POST",
      body: JSON.stringify(
        cmd(legacy.body.workspace, "issueAccessInvitation", {
          kind: "operations",
          label: "历史空间",
        }),
      ),
    }),
    "legacy-owner",
  );
  const secret = (await generated.json()).accessInvitationCode;
  assert.equal((await call("new", inspectAccess(secret))).status, 404);
  assert.equal(
    (
      await catalogImages(db, {}, options).handle(
        new Request(
          `http://localhost/api/catalog/images?workspaceId=${legacy.body.workspace.id}`,
          { method: "POST", body: "test" },
        ),
        "legacy-owner",
      )
    ).status,
    403,
  );
  await assert.rejects(() => platformRow(db), /多份历史货盘/);
  await assert.rejects(
    () => platformRow(db, { workspaceId: "missing" }),
    /配置不可用/,
  );
  assert.equal((await platformRow(db, options)).id, platform.body.workspace.id);
  assert.equal(
    sqlite.prepare("SELECT COUNT(*) AS total FROM catalog_workspaces").get()
      .total,
    2,
    "legacy data is preserved",
  );
  sqlite.close();
});

test("代录商户认领需核实，账号绑定保留商户状态、供货与历史，不泄露邀请凭据", async () => {
  const s = setup();
  const { call, seed, sqlite } = s;
  const invitation = await issued(s);
  const code = invitation.accessInvitationCode;
  const w = invitation.workspace;
  const raw = JSON.parse(
    sqlite.prepare("SELECT data FROM catalog_workspaces").get().data,
  );
  assert.notEqual(raw.accessInvitations[0].tokenHash, code);
  assert.ok(!JSON.stringify(w).includes("tokenHash"));
  assert.ok(!JSON.stringify(w).includes("requestedBy"));
  assert.equal((await call(null, inspectAccess(code))).status, 401);
  const preview = await call("claimant", inspectAccess(code));
  assert.equal(preview.body.invitation.label, application.name);
  assert.ok(!JSON.stringify(preview.body).includes(application.contact));
  assert.equal((await call("claimant", requestAccess(code))).status, 200);
  assert.equal((await call("claimant")).body.workspaces.length, 0);
  assert.equal(
    (await call("claimant", null, `?workspaceId=${w.id}`)).status,
    403,
  );
  const current = (await call("owner")).body.workspace;
  assert.equal(
    (
      await call(
        "owner",
        cmd(current, "reviewAccessRequest", {
          id: current.data.accessInvitations[0].id,
          approve: true,
          note: "",
        }),
      )
    ).status,
    400,
  );
  const approved = await call(
    "owner",
    cmd(current, "reviewAccessRequest", {
      id: current.data.accessInvitations[0].id,
      approve: true,
      note: "与原登记联系人核实",
    }),
  );
  assert.equal(approved.status, 200, approved.body.error);
  const owned = (await call("claimant")).body.workspace;
  assert.equal(owned.data.access.role, "merchant");
  assert.equal(owned.data.merchants[0].id, w.data.merchants[0].id);
  assert.equal(
    owned.data.merchants[0].status,
    "pending",
    "claim does not bypass merchant approval",
  );
  assert.deepEqual(owned.data.offers, w.data.offers);
  assert.equal(owned.data.members.length, 0);
  assert.equal(owned.data.accessInvitations.length, 0);
  assert.ok(
    w.data.events.every((before) =>
      owned.data.events.some((e) => e.id === before.id),
    ),
    "retains all original merchant history",
  );
  assert.equal(
    (await call("claimant", inspectAccess(code))).body.invitation.status,
    "accepted",
  );
  assert.equal((await call("another", inspectAccess(code))).status, 403);
  assert.equal((await call("claimant", requestAccess(code))).status, 409);
  assert.equal(
    (
      await call(
        "owner",
        cmd(approved.body.workspace, "issueAccessInvitation", {
          kind: "claim",
          merchantId: w.data.merchants[0].id,
        }),
      )
    ).status,
    400,
  );
  sqlite.close();
});

test("运营成员必须由负责人核实，不能升级权限；停用立即影响读写和图片接口", async () => {
  const s = setup();
  const { call, seed, sqlite, db, options } = s;
  const invitation = await issued(s, "operations");
  const id = invitation.workspace.id;
  assert.equal(
    (await call("staff", requestAccess(invitation.accessInvitationCode)))
      .status,
    200,
  );
  assert.equal((await call("staff", null, `?workspaceId=${id}`)).status, 403);
  let w = (await call("owner")).body.workspace;
  w = (
    await call(
      "owner",
      cmd(w, "reviewAccessRequest", {
        id: w.data.accessInvitations[0].id,
        approve: true,
        note: "负责人确认同事身份",
      }),
    )
  ).body.workspace;
  let staff = (await call("staff")).body;
  assert.equal(staff.workspaces[0].role, "operations");
  assert.equal(staff.workspace.data.access.isOwner, false);
  assert.equal(staff.workspace.data.members.length, 0);
  assert.equal(staff.workspace.data.accessInvitations.length, 0);
  assert.equal(
    (
      await call(
        "staff",
        cmd(w, "issueAccessInvitation", {
          kind: "operations",
          label: "擅自邀请",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "staff",
        cmd(w, "setMemberStatus", {
          id: w.data.members[0].id,
          status: "disabled",
          note: "越权",
        }),
      )
    ).status,
    403,
  );
  w = (await call("staff", cmd(w, "registerMerchant", application))).body
    .workspace;
  assert.equal(
    (
      await call(
        "staff",
        cmd(w, "issueAccessInvitation", {
          kind: "claim",
          merchantId: w.data.merchants[0].id,
        }),
      )
    ).status,
    200,
  );
  w = (await call("owner")).body.workspace;
  const memberId = w.data.members[0].id;
  const disabled = await call(
    "owner",
    cmd(w, "setMemberStatus", {
      id: memberId,
      status: "disabled",
      note: "工作交接完毕",
    }),
  );
  assert.equal(disabled.status, 200);
  assert.equal((await call("staff")).body.workspaces.length, 0);
  assert.equal((await call("staff", null, `?workspaceId=${id}`)).status, 403);
  assert.equal(
    (
      await call(
        "staff",
        cmd(w, "registerMerchant", { ...application, name: "停用后写入" }),
      )
    ).status,
    403,
  );
  const image = await catalogImages(db, {}).handle(
    new Request(`http://localhost/api/catalog/images?workspaceId=${id}`, {
      method: "POST",
      body: "test",
    }),
    "staff",
  );
  assert.equal(image.status, 403);
  assert.equal(
    (
      await call(
        "owner",
        cmd(disabled.body.workspace, "setMemberStatus", {
          id: memberId,
          status: "active",
          note: "负责人确认恢复工作",
        }),
      )
    ).status,
    200,
  );
  assert.equal((await call("staff", null, `?workspaceId=${id}`)).status, 200);
  assert.equal(
    (await call("staff", create)).status,
    403,
    "staff cannot create another platform",
  );
  sqlite.close();
});

test("认领邀请可撤销、重发和过期，通用入驻邀请码不混用，旧数据无需迁移", async () => {
  const s = setup();
  const { call, seed, sqlite } = s;
  let result = await issued(s);
  const first = result.accessInvitationCode;
  const id = result.workspace.id;
  assert.equal(
    (
      await call("new", {
        action: "applyMerchant",
        invitationCode: first,
        payload: application,
      })
    ).status,
    400,
  );
  const rotated = await call(
    "owner",
    cmd(result.workspace, "rotateInvitation", {}),
  );
  assert.equal(
    (await call("new", inspectAccess(rotated.body.invitationCode))).status,
    404,
  );
  result = (
    await call(
      "owner",
      cmd(rotated.body.workspace, "issueAccessInvitation", {
        kind: "claim",
        merchantId: result.workspace.data.merchants[0].id,
      }),
    )
  ).body;
  assert.equal((await call("new", inspectAccess(first))).status, 410);
  assert.equal(
    (
      await call(
        "new",
        requestAccess(result.accessInvitationCode),
        "",
        {},
        new Date("2026-10-20T08:00:00Z"),
      )
    ).status,
    410,
  );
  assert.equal(
    (await call("new", requestAccess(result.accessInvitationCode))).status,
    200,
  );
  let w = (await call("owner")).body.workspace;
  assert.equal(
    (
      await call(
        "owner",
        cmd(w, "reviewAccessRequest", {
          id: w.data.accessInvitations[0].id,
          approve: true,
          note: "已过期",
        }),
        "",
        {},
        new Date("2026-10-20T08:00:00Z"),
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await call(
        "owner",
        cmd(w, "revokeAccessInvitation", {
          id: w.data.accessInvitations[0].id,
          note: "认领人不符",
        }),
      )
    ).status,
    200,
  );
  assert.equal(
    (await call("new", inspectAccess(result.accessInvitationCode))).status,
    410,
  );
  const raw = JSON.parse(
    sqlite.prepare("SELECT data FROM catalog_workspaces WHERE id = ?").get(id)
      .data,
  );
  delete raw.members;
  delete raw.accessInvitations;
  sqlite
    .prepare("UPDATE catalog_workspaces SET data = ? WHERE id = ?")
    .run(JSON.stringify(raw), id);
  w = (await call("owner")).body.workspace;
  assert.deepEqual(w.data.members, []);
  assert.deepEqual(w.data.accessInvitations, []);
  assert.equal(
    (
      await call(
        "owner",
        cmd(w, "issueAccessInvitation", {
          kind: "operations",
          label: "旧空间新增成员",
        }),
      )
    ).status,
    200,
  );
  sqlite.close();
});

test("并发认领只保留一个申请；并发确认和撤销不会同时成功", async () => {
  const s = setup();
  const { call, seed, sqlite } = s;
  const invitation = await issued(s);
  const responses = await Promise.all([
    call("first", requestAccess(invitation.accessInvitationCode)),
    call("second", requestAccess(invitation.accessInvitationCode)),
  ]);
  assert.equal(responses.filter((r) => r.status === 200).length, 1);
  assert.ok(
    responses.some((r) => [403, 409].includes(r.status)),
    "loser is rejected before write or by revision conflict",
  );
  const winner = responses[0].status === 200 ? "first" : "second";
  const loser = winner === "first" ? "second" : "first";
  assert.equal(
    (await call(loser, inspectAccess(invitation.accessInvitationCode))).status,
    403,
  );
  const w = (await call("owner")).body.workspace;
  const id = w.data.accessInvitations[0].id;
  const reviews = await Promise.all([
    call(
      "owner",
      cmd(w, "reviewAccessRequest", { id, approve: true, note: "确认本人" }),
    ),
    call("owner", cmd(w, "revokeAccessInvitation", { id, note: "停止交接" })),
  ]);
  assert.deepEqual(reviews.map((r) => r.status).sort(), [200, 409]);
  const raw = JSON.parse(
    sqlite.prepare("SELECT data FROM catalog_workspaces").get().data,
  );
  assert.equal(
    Boolean(raw.merchants[0].userId),
    raw.accessInvitations[0].status === "accepted",
  );
  assert.equal(raw.accessInvitations.filter((i) => i.requestedBy).length, 1);
  sqlite.close();
});

test("成员管理拒绝跨空间操作、商户提权及客户端指定绑定身份", async () => {
  const s = setup();
  const { call, seed, sqlite } = s;
  const invitation = await issued(s);
  const w = invitation.workspace;
  const other = (await seed("otherOwner")).body.workspace;
  assert.equal(
    (
      await call(
        "otherOwner",
        cmd(w, "revokeAccessInvitation", {
          id: w.data.accessInvitations[0].id,
          note: "越权",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call(
        "otherOwner",
        cmd(other, "reviewAccessRequest", {
          id: w.data.accessInvitations[0].id,
          approve: true,
          note: "跨空间",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await call("new", {
        ...requestAccess(invitation.accessInvitationCode),
        payload: { ...claimant, userId: "victim" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await call("new", requestAccess(invitation.accessInvitationCode), "", {
        Origin: "https://untrusted.example",
      })
    ).status,
    403,
  );
  const rotated = (await call("owner", cmd(w, "rotateInvitation", {}))).body;
  const merchant = await call("merchant", {
    action: "applyMerchant",
    invitationCode: rotated.invitationCode,
    payload: { ...application, name: "另一商户" },
  });
  assert.equal(
    (
      await call(
        "merchant",
        cmd(merchant.body.workspace, "issueAccessInvitation", {
          kind: "operations",
          label: "提权",
        }),
      )
    ).status,
    403,
  );
  assert.equal(
    (await call("merchant", requestAccess(invitation.accessInvitationCode)))
      .status,
    400,
  );
  sqlite.close();
});

test("未登录拒绝访问；运营空间不自动创建且从空数据开始", async () => {
  const { call, seed, sqlite } = setup();
  assert.equal((await call(null)).status, 401);
  assert.equal((await call("owner")).status, 503);
  assert.equal((await call("owner", create)).status, 403);
  const created = await seed("owner");
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
  const { call, seed, sqlite } = setup();
  const created = await seed("owner");
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
  const { call, seed, sqlite } = setup();
  const created = await seed("owner");
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
  const { call, seed, sqlite } = setup();
  const created = await seed("owner");
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
  const { call, seed, sqlite } = setup();
  const created = await seed("owner");
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

test("上传图片使用持久化存储，隔离草稿与不同空间，公开 SKU 不暴露其他草稿图", async () => {
  const objects = new Map();
  const bucket = {
    async put(key, bytes, options) {
      objects.set(key, { bytes: new Uint8Array(bytes), ...options });
    },
    async get(key) {
      const o = objects.get(key);
      return o ? { ...o, body: new Response(o.bytes).body } : null;
    },
  };
  const { call, seed, sqlite, db, options } = setup(bucket);
  const created = await seed("owner");
  const w = created.body.workspace;
  const images = catalogImages(db, bucket, options);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGaIAAAAASUVORK5CYII=",
    "base64",
  );
  const upload = (user, body = png, extra = {}) =>
    images.handle(
      new Request(`http://localhost/api/catalog/images?workspaceId=${w.id}`, {
        method: "POST",
        body,
        headers: extra,
      }),
      user,
    );
  assert.equal((await upload(null)).status, 401);
  assert.equal((await upload("outsider")).status, 403);
  assert.equal(
    (await upload("owner", png, { Origin: "https://evil.example" })).status,
    403,
  );
  assert.equal(
    (await upload("owner", Buffer.from("<svg>this is not a photo</svg>")))
      .status,
    400,
  );
  assert.equal(
    (await upload("owner", new Uint8Array(5 * 1024 * 1024 + 1))).status,
    413,
  );
  const uploaded = await upload("owner");
  assert.equal(uploaded.status, 201);
  const { imageUrl } = await uploaded.json();
  const imageId = new URL(imageUrl, "http://localhost").pathname
    .split("/")
    .at(-1);
  const read = (user) =>
    images.handle(new Request(`http://localhost${imageUrl}`), user, imageId);
  assert.equal((await read("owner")).headers.get("Content-Type"), "image/png");
  await call("merchant", {
    action: "applyMerchant",
    invitationCode: created.body.invitationCode,
    payload: application,
  });
  assert.equal((await upload("merchant")).status, 403);
  assert.equal((await read("merchant")).status, 403);
  let current = (await call("owner")).body.workspace;
  await call(
    "owner",
    cmd(current, "reviewMerchant", {
      id: current.data.merchants[0].id,
      status: "active",
      note: "已核实",
    }),
  );
  const product = {
    code: "PHOTO-001",
    name: "测试图片商品",
    category: "日用",
    origin: "测试工厂",
    model: "P1",
    material: "PP",
    specification: "白色",
    quality: "样品一致",
    unit: "件",
    packaging: "袋装",
    imageUrl,
  };
  let merchantWorkspace = (await call("merchant")).body.workspace;
  assert.equal(
    (await call("merchant", cmd(merchantWorkspace, "submitSku", product)))
      .status,
    403,
    "cannot associate another user's private upload to gain access",
  );
  current = (await call("owner")).body.workspace;
  const submitted = await call("owner", cmd(current, "submitSku", product));
  assert.equal(submitted.status, 200);
  assert.equal((await read("merchant")).status, 403);
  const published = await call(
    "owner",
    cmd(submitted.body.workspace, "reviewSku", {
      id: submitted.body.workspace.data.skus[0].id,
      status: "active",
      note: "已核实图片",
    }),
  );
  assert.equal(published.status, 200);
  assert.equal((await read("merchant")).status, 200);
  const other = await seed("other-owner");
  assert.equal(
    (await call("other-owner", cmd(other.body.workspace, "submitSku", product)))
      .status,
    403,
  );
  assert.equal((await upload("merchant")).status, 201);
  sqlite.close();
});
