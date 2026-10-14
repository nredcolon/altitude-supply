import { z } from "zod";
import {
  accessFor,
  applyApplication,
  applyCatalogCommand,
  CatalogError,
  emptyCatalog,
  ensure,
  viewCatalog,
} from "./domain.ts";
import type { CatalogResponse, CatalogState, WorkspaceSummary } from "./types";
import { catalogImages } from "./images.ts";

interface Row {
  id: string;
  owner_id: string;
  name: string;
  revision: number;
  data: string;
}
const label = z.string().trim().min(1).max(160);
const identity = z.string().min(1).max(200);
const commandSchema = z
  .object({
    workspaceId: identity,
    revision: z.number().int().min(0),
    action: z.string().min(1).max(50),
    payload: z.unknown(),
  })
  .strict();
const codeSchema = z
  .string()
  .trim()
  .regex(/^[a-f0-9]{64}$/i, "邀请码应为64位字符")
  .transform((v) => v.toLowerCase());
const reply = (data: unknown, status = 200) =>
  Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const token = () =>
  crypto.randomUUID().replaceAll("-", "") +
  crypto.randomUUID().replaceAll("-", "");
async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
const invitationExpiry = (now: Date) =>
  new Date(now.getTime() + 7 * 86400000).toISOString();

export function catalogService(db: D1Database, bucket?: R2Bucket) {
  async function list(userId: string): Promise<WorkspaceSummary[]> {
    const result = await db
      .prepare(
        `SELECT id, name, owner_id FROM catalog_workspaces AS w
      WHERE owner_id = ? OR EXISTS (
        SELECT 1 FROM json_each(w.data, '$.merchants') AS m WHERE json_extract(m.value, '$.userId') = ?
      ) ORDER BY updated_at DESC`,
      )
      .bind(userId, userId)
      .all<{ id: string; name: string; owner_id: string }>();
    return result.results.map((r) => ({
      id: r.id,
      name: r.name,
      role: r.owner_id === userId ? "operations" : "merchant",
    }));
  }
  async function getRow(id: string) {
    const row = await db
      .prepare(
        "SELECT id, owner_id, name, revision, data FROM catalog_workspaces WHERE id = ?",
      )
      .bind(id)
      .first<Row>();
    ensure(row, "运营空间不存在", 404);
    return row;
  }
  async function response(
    userId: string,
    id?: string,
  ): Promise<CatalogResponse> {
    const workspaces = await list(userId);
    const selected = id || workspaces[0]?.id;
    if (!selected) return { workspaces };
    const row = await getRow(selected);
    return {
      workspaces,
      workspace: {
        id: row.id,
        name: row.name,
        revision: row.revision,
        data: viewCatalog(JSON.parse(row.data), userId),
      },
    };
  }
  async function save(row: Row, state: CatalogState, now: Date) {
    const data = JSON.stringify(state);
    ensure(data.length <= 2_000_000, "试用空间容量已满，请联系维护人员扩容");
    const result = await db
      .prepare(
        "UPDATE catalog_workspaces SET data = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
      )
      .bind(data, now.toISOString(), row.id, row.revision)
      .run();
    ensure(result.meta.changes === 1, "其他窗口已更新数据，请刷新后重试", 409);
  }
  return {
    async handle(
      request: Request,
      userId: string | null,
      now = new Date(),
    ): Promise<Response> {
      try {
        ensure(userId, "请先登录", 401);
        if (request.method === "GET")
          return reply(
            await response(
              userId,
              new URL(request.url).searchParams.get("workspaceId") || undefined,
            ),
          );
        ensure(request.method === "POST", "不支持的请求方式", 405);
        const origin = request.headers.get("origin");
        ensure(
          !origin || origin === new URL(request.url).origin,
          "不允许跨站提交",
          403,
        );
        const text = await request.text();
        ensure(text.length <= 32000, "提交内容过大", 413);
        const input = z
          .object({ action: z.string() })
          .passthrough()
          .parse(JSON.parse(text));
        if (input.action === "createWorkspace") {
          const p = z
            .object({
              action: z.literal("createWorkspace"),
              name: label,
              priceBasis: label,
            })
            .strict()
            .parse(input);
          ensure(
            !(await list(userId)).some((w) => w.role === "operations"),
            "该账号已创建运营空间",
          );
          const id = crypto.randomUUID();
          const invitationCode = token();
          const expiry = invitationExpiry(now);
          const inserted = await db
            .prepare(
              "INSERT OR IGNORE INTO catalog_workspaces (id, owner_id, name, invite_hash, invite_expires_at, revision, data, updated_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)",
            )
            .bind(
              id,
              userId,
              p.name,
              await hash(invitationCode),
              expiry,
              JSON.stringify(emptyCatalog(userId, p.priceBasis)),
              now.toISOString(),
            )
            .run();
          ensure(
            inserted.meta.changes === 1,
            "该账号已有运营空间，请刷新",
            409,
          );
          return reply(
            {
              ...(await response(userId, id)),
              invitationCode,
              invitationExpiresAt: expiry,
            },
            201,
          );
        }
        if (input.action === "applyMerchant") {
          const p = z
            .object({
              action: z.literal("applyMerchant"),
              invitationCode: codeSchema,
              payload: z.unknown(),
            })
            .strict()
            .parse(input);
          const row = await db
            .prepare(
              "SELECT id, owner_id, name, revision, data FROM catalog_workspaces WHERE invite_hash = ? AND invite_expires_at > ?",
            )
            .bind(await hash(p.invitationCode), now.toISOString())
            .first<Row>();
          ensure(row, "邀请码无效或已过期，请联系运营");
          await save(
            row,
            applyApplication(JSON.parse(row.data), userId, p.payload, now),
            now,
          );
          return reply(await response(userId, row.id), 201);
        }
        const p = commandSchema.parse(input);
        const row = await getRow(p.workspaceId);
        const state: CatalogState = JSON.parse(row.data);
        const access = accessFor(state, userId);
        ensure(row.revision === p.revision, "数据已更新，请刷新后重试", 409);
        if (
          ["submitSku", "updateSku", "updateSkuImage"].includes(p.action) &&
          p.payload &&
          typeof p.payload === "object" &&
          "imageUrl" in p.payload
        ) {
          const imageUrl = p.payload.imageUrl;
          if (
            typeof imageUrl === "string" &&
            imageUrl.startsWith("/api/catalog/images/")
          ) {
            const parsed = new URL(imageUrl, request.url);
            ensure(
              parsed.searchParams.get("workspaceId") === row.id,
              "图片必须属于当前运营空间",
            );
            const read = await catalogImages(db, bucket).handle(
              new Request(parsed),
              userId,
              parsed.pathname.split("/").at(-1),
            );
            await read.body?.cancel();
            ensure(read.ok, "图片不可用或无权使用，请重新上传", 403);
          }
        }
        if (p.action === "rotateInvitation") {
          ensure(access.role === "operations", "只有运营可以更新邀请码", 403);
          const invitationCode = token();
          const expiry = invitationExpiry(now);
          const result = await db
            .prepare(
              "UPDATE catalog_workspaces SET invite_hash = ?, invite_expires_at = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND revision = ?",
            )
            .bind(
              await hash(invitationCode),
              expiry,
              now.toISOString(),
              row.id,
              row.revision,
            )
            .run();
          ensure(result.meta.changes === 1, "数据已更新，请刷新后重试", 409);
          return reply({
            ...(await response(userId, row.id)),
            invitationCode,
            invitationExpiresAt: expiry,
          });
        }
        await save(
          row,
          applyCatalogCommand(state, userId, p.action, p.payload, now),
          now,
        );
        return reply(await response(userId, row.id));
      } catch (error) {
        if (error instanceof CatalogError)
          return reply({ error: error.message }, error.status);
        if (error instanceof z.ZodError)
          return reply(
            {
              error: error.issues
                .map((i) => `${i.path.join(".")}：${i.message}`)
                .slice(0, 3)
                .join("；"),
            },
            400,
          );
        if (error instanceof SyntaxError)
          return reply({ error: "请求格式不正确" }, 400);
        console.error(
          "Catalog request failed",
          error instanceof Error ? error.message : "unknown",
        );
        return reply({ error: "暂时无法保存，请刷新后重试" }, 500);
      }
    },
  };
}
