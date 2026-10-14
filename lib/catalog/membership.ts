import { z } from "zod";
import { accessFor, appendEvent, ensure } from "./domain.ts";
import type { AccessInvitation, CatalogState } from "./types";

const text = z.string().trim().min(1).max(200);
const evidence = z.string().trim().min(1, "请填写核实依据").max(1000);
export const membershipActions = new Set([
  "issueAccessInvitation",
  "reviewAccessRequest",
  "revokeAccessInvitation",
  "setMemberStatus",
]);

function mayManage(
  state: CatalogState,
  userId: string,
  kind: AccessInvitation["kind"],
) {
  const access = accessFor(state, userId);
  ensure(access.role === "operations", "只有运营可以管理账号交接", 403);
  if (kind === "operations")
    ensure(access.isOwner, "只有空间负责人可以管理运营成员", 403);
}
function availableAccount(state: CatalogState, userId: string) {
  ensure(
    state.ownerId !== userId &&
      !state.members?.some((m) => m.userId === userId),
    "该账号已有运营身份，请使用受邀人的账号",
  );
  ensure(
    !state.merchants.some((m) => m.userId === userId),
    "该账号已绑定本空间商户",
  );
}
function availableMerchant(state: CatalogState, merchantId: string | null) {
  const merchant = state.merchants.find((m) => m.id === merchantId);
  ensure(merchant, "商户不存在", 404);
  ensure(!merchant.userId, "商户已绑定账号，不能再次认领");
  return merchant;
}

export function applyMembershipCommand(
  original: CatalogState,
  userId: string,
  action: string,
  payload: unknown,
  now = new Date(),
  tokenHash?: string,
): CatalogState {
  const state = structuredClone(original);
  state.members ??= [];
  state.accessInvitations ??= [];
  if (action === "issueAccessInvitation") {
    const p = z
      .discriminatedUnion("kind", [
        z.object({ kind: z.literal("claim"), merchantId: text }).strict(),
        z.object({ kind: z.literal("operations"), label: text }).strict(),
      ])
      .parse(payload);
    mayManage(state, userId, p.kind);
    ensure(tokenHash && /^[a-f0-9]{64}$/.test(tokenHash), "邀请生成失败");
    const merchant =
      p.kind === "claim" ? availableMerchant(state, p.merchantId) : null;
    if (merchant) {
      for (const old of state.accessInvitations) {
        if (
          old.merchantId === merchant.id &&
          ["issued", "requested"].includes(old.status)
        ) {
          old.status = "revoked";
          old.reviewNote = "运营重新生成认领邀请，旧邀请失效";
        }
      }
    }
    const invitation: AccessInvitation = {
      id: `invitation_${crypto.randomUUID()}`,
      tokenHash,
      kind: p.kind,
      merchantId: merchant?.id || null,
      label: merchant?.name || (p.kind === "operations" ? p.label : ""),
      status: "issued",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 7 * 86400000).toISOString(),
      requestedBy: null,
      applicantName: "",
      applicantContact: "",
      reviewNote: "",
    };
    state.accessInvitations.unshift(invitation);
    appendEvent(
      state,
      userId,
      invitation.merchantId,
      "生成账号邀请",
      invitation.id,
      `${invitation.kind === "claim" ? "商户认领" : "运营成员"} · ${invitation.label}`,
      now,
    );
    return state;
  }
  if (action === "setMemberStatus") {
    mayManage(state, userId, "operations");
    const p = z
      .object({
        id: text,
        status: z.enum(["active", "disabled"]),
        note: evidence,
      })
      .strict()
      .parse(payload);
    const member = state.members.find((m) => m.id === p.id);
    ensure(
      member && member.userId !== state.ownerId,
      "运营成员不存在或不能修改负责人",
      404,
    );
    ensure(member.status !== p.status, "成员状态没有变化");
    member.status = p.status;
    appendEvent(
      state,
      userId,
      null,
      p.status === "active" ? "恢复运营权限" : "停用运营权限",
      member.id,
      `${member.name} · ${p.note}`,
      now,
    );
    return state;
  }
  const p = z
    .object({
      id: text,
      note: evidence,
      approve:
        action === "reviewAccessRequest" ? z.boolean() : z.never().optional(),
    })
    .strict()
    .parse(payload);
  const invitation = state.accessInvitations.find((i) => i.id === p.id);
  ensure(invitation, "邀请不存在", 404);
  mayManage(state, userId, invitation.kind);
  if (action === "revokeAccessInvitation") {
    ensure(
      ["issued", "requested"].includes(invitation.status),
      "邀请已处理，不能重复撤销",
    );
    invitation.status = "revoked";
  } else {
    ensure(action === "reviewAccessRequest", "未知的成员操作");
    ensure(
      invitation.status === "requested" && invitation.requestedBy,
      "没有待核实的认领申请",
    );
    if (p.approve) {
      ensure(
        invitation.expiresAt > now.toISOString(),
        "邀请已过期，请重新邀请并核实",
      );
      availableAccount(state, invitation.requestedBy);
      if (invitation.kind === "claim") {
        availableMerchant(state, invitation.merchantId).userId =
          invitation.requestedBy;
      } else {
        state.members.push({
          id: `member_${crypto.randomUUID()}`,
          userId: invitation.requestedBy,
          name: invitation.applicantName,
          contact: invitation.applicantContact,
          status: "active",
          joinedAt: now.toISOString(),
        });
      }
      invitation.status = "accepted";
    } else invitation.status = "revoked";
  }
  invitation.reviewNote = p.note;
  appendEvent(
    state,
    userId,
    invitation.merchantId,
    invitation.status === "accepted" ? "确认账号绑定" : "撤销账号邀请",
    invitation.id,
    `${invitation.label} · ${invitation.applicantName || "尚未申请"} · ${p.note}`,
    now,
  );
  return state;
}

export function inspectInvitation(
  state: CatalogState,
  tokenHash: string,
  userId: string,
  now: Date,
) {
  const invitation = state.accessInvitations?.find(
    (i) => i.tokenHash === tokenHash,
  );
  ensure(invitation, "邀请无效，请联系运营重新发送", 404);
  ensure(
    !invitation.requestedBy || invitation.requestedBy === userId,
    "此邀请已由其他账号申请，请联系运营核实",
    403,
  );
  ensure(invitation.status !== "revoked", "邀请已撤销，请联系运营", 410);
  if (invitation.status !== "accepted")
    ensure(
      invitation.expiresAt > now.toISOString(),
      "邀请已过期，请联系运营",
      410,
    );
  return invitation;
}

export function requestMembership(
  original: CatalogState,
  tokenHash: string,
  userId: string,
  payload: unknown,
  now = new Date(),
): CatalogState {
  const p = z.object({ name: text, contact: text }).strict().parse(payload);
  const state = structuredClone(original);
  const invitation = inspectInvitation(state, tokenHash, userId, now);
  ensure(invitation.status === "issued", "申请已提交，请刷新查看核实结果", 409);
  availableAccount(state, userId);
  if (invitation.kind === "claim")
    availableMerchant(state, invitation.merchantId);
  ensure(
    !state.accessInvitations?.some(
      (i) =>
        i.requestedBy === userId &&
        i.status === "requested" &&
        i.expiresAt > now.toISOString(),
    ),
    "该账号已有待核实的申请，请先联系运营处理",
  );
  invitation.requestedBy = userId;
  invitation.applicantName = p.name;
  invitation.applicantContact = p.contact;
  invitation.status = "requested";
  appendEvent(
    state,
    userId,
    invitation.merchantId,
    "申请账号绑定",
    invitation.id,
    `${invitation.label} · ${p.name} · 等待线下核实`,
    now,
  );
  return state;
}
