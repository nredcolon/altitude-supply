import { getChatGPTUser } from '../../chatgpt-auth';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { makeSeed } from '../../../lib/supply/seed';
import { applyCommand, BusinessError, viewState } from '../../../lib/supply/domain';
import type { Actor, SupplyState } from '../../../lib/supply/types';

const actorSchema = z.object({ role: z.enum(['operations', 'supplier', 'buyer']), entityId: z.string().min(1).max(160) });
const response = (data: unknown, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
async function load(userId: string) {
  if (!env.DB) throw new BusinessError('数据库尚未就绪，请联系维护人员', 503);
  let row = await env.DB.prepare('SELECT data, revision FROM supply_workspaces WHERE user_id = ?').bind(userId).first<{data: string; revision: number}>();
  if (!row) {
    await env.DB.prepare('INSERT OR IGNORE INTO supply_workspaces (user_id, revision, data, updated_at) VALUES (?, 0, ?, ?)').bind(userId, JSON.stringify(makeSeed()), new Date().toISOString()).run();
    row = await env.DB.prepare('SELECT data, revision FROM supply_workspaces WHERE user_id = ?').bind(userId).first<{data: string; revision: number}>();
  }
  if (!row) throw new BusinessError('无法建立工作空间', 503);
  return { state: JSON.parse(row.data) as SupplyState, revision: row.revision };
}
function failure(e: unknown) {
  if (e instanceof BusinessError) return response({ error: e.message }, e.status);
  if (e instanceof z.ZodError) return response({ error: e.issues.map(i => `${i.path.join('.')}：${i.message}`).slice(0, 3).join('；') }, 400);
  if (e instanceof SyntaxError) return response({ error: '请求内容格式不正确' }, 400);
  console.error('Supply workspace request failed', e instanceof Error ? e.message : 'unknown');
  return response({ error: '操作未完成，请稍后重试。已保存的数据不会因此更改。' }, 500);
}
export async function GET(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) return response({ error: '请先登录' }, 401);
    const params = new URL(request.url).searchParams;
    // Role switching is intentionally restricted to the signed-in user's personal
    // demo workspace. It is not a production merchant login/permission model.
    const actor: Actor = actorSchema.parse({ role: params.get('role') || 'operations', entityId: params.get('entityId') || 'operations' });
    const { state, revision } = await load(user.userId);
    return response({ state: viewState(state, actor), revision, actor, mode: 'demo' });
  } catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    const user = await getChatGPTUser(); if (!user) return response({ error: '请先登录' }, 401);
    const origin = request.headers.get('origin'); if (origin && origin !== new URL(request.url).origin) return response({ error: '不允许跨站提交' }, 403);
    const bodyText = await request.text(); if (bodyText.length > 100000) return response({ error: '提交内容过大' }, 413);
    const body = z.object({ actor: actorSchema, action: z.string().max(80), payload: z.unknown(), revision: z.number().int().min(0) }).parse(JSON.parse(bodyText));
    const { state, revision } = await load(user.userId);
    if (body.revision !== revision) return response({ error: '数据已被其他窗口更新，已刷新页面数据，请重新确认后操作。' }, 409);
    const next = applyCommand(state, body.actor, body.action, body.payload);
    const result = await env.DB!.prepare('UPDATE supply_workspaces SET data = ?, revision = revision + 1, updated_at = ? WHERE user_id = ? AND revision = ?').bind(JSON.stringify(next), new Date().toISOString(), user.userId, revision).run();
    if (result.meta.changes !== 1) return response({ error: '数据同时发生变化，请刷新后重试。' }, 409);
    return response({ state: viewState(next, body.actor), revision: revision + 1, actor: body.actor, mode: 'demo' });
  } catch (e) { return failure(e); }
}
