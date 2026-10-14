"use client";

import { useState } from "react";
import type { CatalogView } from "../../lib/catalog/types";
import { Field, Modal } from "./primitives";

const labels = {
  issued: "等待申请",
  requested: "等待核实",
  accepted: "已完成绑定",
  revoked: "已撤销",
};
export function AccessManagement({
  data,
  busy,
  error,
  command,
}: {
  data: CatalogView;
  busy: boolean;
  error: string;
  command: (action: string, payload: unknown) => Promise<boolean>;
}) {
  const owner = data.access.role === "operations" && data.access.isOwner;
  const [decision, setDecision] = useState<{
    action: string;
    id: string;
    title: string;
    approve?: boolean;
    status?: string;
  } | null>(null);
  return (
    <div className="access-management">
      <section className="panel access-intro">
        <h2>账号交接与权限</h2>
        <p>
          代录商户从「商户入驻」获取专属认领链接。申请人填写姓名和联系方式后，运营通过原登记联系人核实，再绑定账号。供货记录和准入状态保持原样。
        </p>
        {owner ? (
          <form
            className="access-invite-form"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const label = String(new FormData(form).get("label") || "");
              await command("issueAccessInvitation", {
                kind: "operations",
                label,
              });
            }}
          >
            <Field
              label="邀请运营成员"
              hint="成员可以查看全部内部供货成本、维护货盘和审核商户；成员管理仅负责人可用。"
            >
              <input
                name="label"
                required
                maxLength={200}
                placeholder="填写受邀同事姓名或备注"
              />
            </Field>
            <button className="btn primary" disabled={busy}>
              生成运营邀请链接
            </button>
          </form>
        ) : (
          <p className="note">
            你可以核实商户认领。运营成员的邀请、确认和停用由空间负责人处理。
          </p>
        )}
      </section>
      <section className="panel access-intro">
        <h2>邀请与认领申请</h2>
        <p className="muted">
          邀请有效期为 7
          天。申请本身不授予访问权限；确认绑定前需核实本人身份。撤销或重新生成商户邀请后，旧链接失效。
        </p>
        {data.accessInvitations.length === 0 && (
          <p className="muted">暂无专属邀请。</p>
        )}
        <div className="access-list">
          {data.accessInvitations.map((invitation) => {
            const expired =
              invitation.expiresAt <= new Date().toISOString() &&
              ["issued", "requested"].includes(invitation.status);
            return (
              <article className="access-row" key={invitation.id}>
                <div>
                  <strong>{invitation.label}</strong>
                  <p>
                    {invitation.kind === "claim"
                      ? "商户档案认领"
                      : "运营成员邀请"}{" "}
                    · {expired ? "已过期" : labels[invitation.status]}
                  </p>
                  {invitation.applicantName && (
                    <p>
                      申请人：{invitation.applicantName} ·{" "}
                      {invitation.applicantContact}（本人填写，待核实）
                    </p>
                  )}
                  <small>
                    有效至{" "}
                    {new Date(invitation.expiresAt).toLocaleString("zh-CN", {
                      timeZone: "Asia/Shanghai",
                    })}
                  </small>
                  {invitation.reviewNote && (
                    <p className="note">处理记录：{invitation.reviewNote}</p>
                  )}
                </div>
                <div className="access-actions">
                  {invitation.status === "requested" && !expired && (
                    <button
                      className="btn primary"
                      disabled={busy}
                      onClick={() =>
                        setDecision({
                          action: "reviewAccessRequest",
                          id: invitation.id,
                          approve: true,
                          title: `核实并绑定：${invitation.label}`,
                        })
                      }
                    >
                      核实并绑定
                    </button>
                  )}
                  {["issued", "requested"].includes(invitation.status) && (
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() =>
                        setDecision({
                          action: "revokeAccessInvitation",
                          id: invitation.id,
                          title: `撤销邀请：${invitation.label}`,
                        })
                      }
                    >
                      撤销邀请
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
      {owner && (
        <section className="panel access-intro">
          <h2>运营成员</h2>
          <p className="muted">
            当前账号是空间负责人。停用成员会立即阻止其后续访问，保留既有业务及操作记录。
          </p>
          {!data.members.length && <p>目前只有负责人。</p>}
          <div className="access-list">
            {data.members.map((member) => (
              <article className="access-row" key={member.id}>
                <div>
                  <strong>{member.name}</strong>
                  <p>
                    {member.contact} ·{" "}
                    {member.status === "active" ? "使用中" : "已停用"}
                  </p>
                </div>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    setDecision({
                      action: "setMemberStatus",
                      id: member.id,
                      status:
                        member.status === "active" ? "disabled" : "active",
                      title: `${member.status === "active" ? "停用" : "恢复"}运营成员：${member.name}`,
                    })
                  }
                >
                  {member.status === "active" ? "停用权限" : "恢复权限"}
                </button>
              </article>
            ))}
          </div>
        </section>
      )}
      {decision && (
        <Modal
          title={decision.title}
          close={() => {
            if (!busy) setDecision(null);
          }}
        >
          <form
            className="modal-body"
            onSubmit={async (e) => {
              e.preventDefault();
              const note = String(
                new FormData(e.currentTarget).get("note") || "",
              );
              const { action, id, approve, status } = decision;
              if (
                await command(action, {
                  id,
                  note,
                  ...(approve !== undefined && { approve }),
                  ...(status && { status }),
                })
              )
                setDecision(null);
            }}
          >
            {decision.approve && (
              <p className="notice">
                请通过已登记的联系方式核实申请人身份。绑定后，该账号将获得相应数据的访问与维护权限。
              </p>
            )}
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Field label="核实依据 / 处理原因">
              <textarea
                name="note"
                required
                maxLength={1000}
                rows={3}
                placeholder="例如：与原登记联系人电话确认，本人为档口负责人"
              />
            </Field>
            <button className="btn primary" disabled={busy}>
              {busy ? "保存中…" : "确认处理"}
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}
