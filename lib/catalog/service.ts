import { z } from "zod";
import {
  accessFor,
  applyApplication,
  applyCatalogCommand,
  CatalogError,
  ensure,
  viewCatalog,
} from "./domain.ts";
import type { CatalogResponse, CatalogState, WorkspaceSummary } from "./types";
import { catalogImages } from "./images.ts";
import { platformRow, sessionFor, type PlatformOptions } from "./platform.ts";
import {
  applyMembershipCommand,
  inspectInvitation,
  membershipActions,
  requestMembership,
} from "./membership.ts";

interface Row {
  id: string;
  owner_id: string;
  name: string;
  revision: number;
  data: string;
}
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

export function catalogService(
  db: D1Database,
  bucket?: R2Bucket,
  options: PlatformOptions = {},
) {
  async function list(userId: string): Promise<WorkspaceSummary[]> {
    const row = await platformRow(db, options);
    const session = sessionFor(JSON.parse(row.data), userId);
    return session.status === "member"
      ? [{ id: row.id, name: row.name, role: session.portal }]
      : [];
  }
  async function getRow(id: string) {
    const row = await platformRow(db, options);
    ensure(id === row.id, "不能访问其他平台货盘", 403);
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
        if (request.method === "GET") {
          const url = new URL(request.url);
          const result = await response(
            userId,
            url.searchParams.get("workspaceId") || undefined,
          );
          const portal = url.searchParams.get("portal");
          if (portal) {
            ensure(
              portal === "merchant" || portal === "operations",
              "入口无效",
            );
            if (result.workspace)
              ensure(
                result.workspace.data.access.role === portal,
                "请使用对应账号入口",
                403,
              );
          }
          return reply(result);
        }
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
        ensure(
          input.action !== "createWorkspace",
          "平台由管理员统一初始化，不能自行创建运营空间",
          403,
        );
        if (
          ["inspectAccessInvitation", "requestAccess"].includes(input.action)
        ) {
          const p = z
            .object({
              action: z.enum(["inspectAccessInvitation", "requestAccess"]),
              invitationCode: codeSchema,
              payload: z.unknown().optional(),
            })
            .strict()
            .parse(input);
          const tokenHash = await hash(p.invitationCode);
          const row = await platformRow(db, options);
          let state: CatalogState = JSON.parse(row.data);
          if (p.action === "requestAccess") {
            state = requestMembership(state, tokenHash, userId, p.payload, now);
            await save(row, state, now);
          }
          const invitation = inspectInvitation(state, tokenHash, userId, now);
          return reply({
            invitation: {
              workspaceId: row.id,
              workspaceName: row.name,
              label: invitation.label,
              kind: invitation.kind,
              status: invitation.status,
              expiresAt: invitation.expiresAt,
            },
          });
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
          const row = await platformRow(db, options);
          ensure(
            row.invite_hash === (await hash(p.invitationCode)) &&
              row.invite_expires_at > now.toISOString(),
            "邀请码无效或已过期，请联系运营",
          );
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
        if (membershipActions.has(p.action)) {
          const code =
            p.action === "issueAccessInvitation" ? token() : undefined;
          const next = applyMembershipCommand(
            state,
            userId,
            p.action,
            p.payload,
            now,
            code ? await hash(code) : undefined,
          );
          await save(row, next, now);
          const invitation = code ? next.accessInvitations?.[0] : undefined;
          return reply({
            ...(await response(userId, row.id)),
            ...(code && {
              accessInvitationCode: code,
              accessInvitationExpiresAt: invitation!.expiresAt,
              accessInvitationLabel: invitation!.label,
              accessInvitationKind: invitation!.kind,
            }),
          });
        }
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
            const read = await catalogImages(db, bucket, options).handle(
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
