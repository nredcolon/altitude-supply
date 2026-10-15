import { z } from "zod";
import { accessFor, emptyCatalog, ensure } from "./domain.ts";
import type { CatalogState } from "./types";

export type Portal = "merchant" | "operations";
export interface PlatformOptions {
  workspaceId?: string;
}
export interface PlatformRow {
  id: string;
  owner_id: string;
  name: string;
  revision: number;
  data: string;
  invite_hash: string;
  invite_expires_at: string;
}
export type PortalSession =
  | { status: "anonymous" | "unregistered" | "disabled" }
  | { status: "member"; portal: Portal; isOwner: boolean }
  | { status: "unavailable"; error: string };

/** Deployment configuration selects one platform; request parameters never select it. */
export async function platformRow(
  db: D1Database,
  options: PlatformOptions = {},
): Promise<PlatformRow> {
  if (options.workspaceId) {
    const row = await db
      .prepare("SELECT * FROM catalog_workspaces WHERE id = ?")
      .bind(options.workspaceId)
      .first<PlatformRow>();
    ensure(row, "平台配置不可用，请联系管理员", 503);
    return row;
  }
  const result = await db
    .prepare("SELECT * FROM catalog_workspaces LIMIT 2")
    .all<PlatformRow>();
  ensure(result.results.length > 0, "平台尚未初始化，请联系管理员", 503);
  ensure(
    result.results.length === 1,
    "存在多份历史货盘，请由管理员指定平台货盘",
    503,
  );
  return result.results[0];
}

export function sessionFor(
  state: CatalogState,
  userId: string | null,
): PortalSession {
  if (!userId) return { status: "anonymous" };
  if (
    state.ownerId !== userId &&
    state.members?.some((m) => m.userId === userId && m.status === "disabled")
  )
    return { status: "disabled" };
  const belongs =
    state.ownerId === userId ||
    state.members?.some((m) => m.userId === userId) ||
    state.merchants.some((m) => m.userId === userId);
  if (!belongs) return { status: "unregistered" };
  const access = accessFor(state, userId);
  return {
    status: "member",
    portal: access.role,
    isOwner: access.role === "operations" && access.isOwner,
  };
}

// Administrator CLI only. There is deliberately no HTTP initialization endpoint.
export function initialPlatformSql(input: unknown, now = new Date()) {
  const p = z
    .object({
      ownerId: z.string().trim().min(1).max(200),
      name: z.string().trim().min(1).max(160),
      priceBasis: z.string().trim().min(1).max(160),
    })
    .strict()
    .parse(input);
  const quote = (v: string) => `'${v.replaceAll("'", "''")}'`;
  const id = crypto.randomUUID();
  const unusedHash =
    crypto.randomUUID().replaceAll("-", "") +
    crypto.randomUUID().replaceAll("-", "");
  const values = [
    id,
    p.ownerId,
    p.name,
    unusedHash,
    now.toISOString(),
    JSON.stringify(emptyCatalog(p.ownerId, p.priceBasis)),
    now.toISOString(),
  ].map(quote);
  return `INSERT INTO catalog_workspaces (id, owner_id, name, invite_hash, invite_expires_at, revision, data, updated_at)
    SELECT ${values.slice(0, 5).join(", ")}, 0, ${values.slice(5).join(", ")} WHERE NOT EXISTS (SELECT 1 FROM catalog_workspaces);`;
}
