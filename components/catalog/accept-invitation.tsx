"use client";

import { useEffect, useState } from "react";
import { Mountain } from "lucide-react";
import type { AccessInvitationPreview } from "../../lib/catalog/types";
import { Field } from "./primitives";

export default function AcceptInvitation({
  authenticated,
  displayName,
}: {
  authenticated: boolean;
  displayName: string;
}) {
  const [code, setCode] = useState("");
  const [invitation, setInvitation] = useState<AccessInvitationPreview | null>(
    null,
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function inspect(
    invitationCode: string,
    payload?: { name: string; contact: string },
  ) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: payload ? "requestAccess" : "inspectAccessInvitation",
          invitationCode,
          ...(payload && { payload }),
        }),
      });
      const body = (await response.json()) as {
        invitation?: AccessInvitationPreview;
        error?: string;
      };
      if (!response.ok || !body.invitation)
        throw new Error(body.error || "读取邀请失败");
      setInvitation(body.invitation);
    } catch (e) {
      setInvitation(null);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get(
      "access",
    );
    let saved = "";
    try {
      if (incoming && /^[a-f0-9]{64}$/i.test(incoming))
        sessionStorage.setItem("shanhai.access", incoming);
      saved = sessionStorage.getItem("shanhai.access") || "";
    } catch {
      saved = incoming || "";
    }
    if (incoming)
      window.history.replaceState(null, "", window.location.pathname);
    setCode(saved);
    if (authenticated && saved) void inspect(saved);
  }, [authenticated]);
  return (
    <main className="accept-page">
      <section className="panel accept-card">
        <a className="accept-brand" href="/">
          <Mountain /> 山海供
        </a>
        <h1>账号邀请与商户认领</h1>
        {!authenticated ? (
          <>
            <p>
              使用本人的账号登录，核对邀请并提交申请。已有商品与供货资料会保留，运营确认后即可接手维护。
            </p>
            <a
              className="btn primary"
              target="_top"
              href="/signin-with-chatgpt?return_to=%2Faccept"
            >
              使用 ChatGPT 账号登录
            </a>
          </>
        ) : (
          <>
            <p className="muted">当前登录：{displayName}</p>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            {!invitation && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void inspect(code);
                }}
              >
                <Field
                  label="专属邀请码"
                  hint="通过运营发送的专属链接进入时会自动填写。"
                >
                  <input
                    required
                    minLength={64}
                    maxLength={64}
                    autoComplete="off"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </Field>
                <button className="btn primary" disabled={busy}>
                  {busy ? "读取中…" : "查看邀请"}
                </button>
              </form>
            )}
            {invitation && (
              <>
                <div className="accept-summary">
                  <small>{invitation.workspaceName}</small>
                  <h2>{invitation.label}</h2>
                  <p>
                    {invitation.kind === "claim"
                      ? "认领已有商户档案，保留原供货记录。"
                      : "加入运营团队，可查看内部供货成本、维护货盘和审核商户。"}
                  </p>
                </div>
                {invitation.status === "issued" && (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      void inspect(code, {
                        name: String(f.get("name") || ""),
                        contact: String(f.get("contact") || ""),
                      });
                    }}
                  >
                    <Field label="本人姓名">
                      <input
                        name="name"
                        required
                        maxLength={200}
                        autoComplete="name"
                      />
                    </Field>
                    <Field
                      label="联系手机 / 联系方式"
                      hint="供运营联系核实，不作为登录凭据。"
                    >
                      <input
                        name="contact"
                        required
                        maxLength={200}
                        autoComplete="tel"
                      />
                    </Field>
                    <p className="muted">
                      提交后等待运营核实，确认前无法访问空间资料。
                    </p>
                    <button className="btn primary" disabled={busy}>
                      {busy ? "提交中…" : "提交认领申请"}
                    </button>
                  </form>
                )}
                {invitation.status === "requested" && (
                  <div className="notice">
                    申请已提交，请联系发出邀请的运营完成核实。无需重复填写。
                  </div>
                )}
                {invitation.status === "accepted" ? (
                  <a
                    className="btn primary"
                    href={`${invitation.kind === "claim" ? "/merchant" : "/operations"}?workspaceId=${encodeURIComponent(invitation.workspaceId)}`}
                    onClick={() => {
                      try {
                        sessionStorage.removeItem("shanhai.access");
                      } catch {
                        /* Session storage may be unavailable. */
                      }
                    }}
                  >
                    绑定已完成，进入工作台
                  </a>
                ) : (
                  <button
                    className="btn"
                    disabled={busy}
                    onClick={() => void inspect(code)}
                  >
                    {busy ? "查询中…" : "刷新核实结果"}
                  </button>
                )}
              </>
            )}
            <a
              className="text-button"
              target="_top"
              href="/signout-with-chatgpt?return_to=%2Faccept"
            >
              切换登录账号
            </a>
          </>
        )}
      </section>
    </main>
  );
}
