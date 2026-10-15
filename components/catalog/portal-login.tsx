"use client";
import { useEffect, useState } from "react";
import {
  ArrowRight,
  Mountain,
  ShieldCheck,
  Store,
  Layers3,
} from "lucide-react";
import type { Portal, PortalSession } from "../../lib/catalog/platform";

export default function PortalLogin({
  portal,
  session,
  displayName,
}: {
  portal: Portal;
  session: PortalSession;
  displayName: string;
}) {
  const merchant = portal === "merchant";
  const [invited, setInvited] = useState(false);
  const [returnTo, setReturnTo] = useState(`/${portal}`);
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const access = params.get("access");
    const invite = merchant ? params.get("invite") : null;
    const valid = (v: string | null) => Boolean(v && /^[a-f0-9]{64}$/i.test(v));
    const accepting =
      valid(access) ||
      new URLSearchParams(window.location.search).get("next") === "accept";
    try {
      if (valid(access)) sessionStorage.setItem("shanhai.access", access!);
      if (valid(invite)) sessionStorage.setItem("shanhai.join", invite!);
    } catch {
      /* Invitation remains in the URL until storage is available. */
    }
    if (valid(access) || valid(invite)) {
      setInvited(true);
      // Keep the fragment if storage is blocked so reopening this link can recover it.
      try {
        if (
          sessionStorage.getItem(
            valid(access) ? "shanhai.access" : "shanhai.join",
          )
        )
          window.history.replaceState(
            null,
            "",
            window.location.pathname + window.location.search,
          );
      } catch {
        /* Browser storage unavailable. */
      }
    }
    setReturnTo(accepting ? "/accept" : `/${portal}`);
    if (session.status !== "anonymous" && accepting)
      window.location.replace("/accept");
    else if (session.status === "member")
      window.location.replace(`/${session.portal}`);
  }, [merchant, portal, session]);
  const target = session.status === "member" ? `/${session.portal}` : returnTo;
  return (
    <main
      className={`entry login-entry ${merchant ? "merchant-login" : "operations-login"}`}
    >
      <div className="entry-intro">
        <a href="/" className="entry-brand">
          <Mountain size={25} />
          山海供
        </a>
        <span className="login-role">
          {merchant ? <Store size={18} /> : <Layers3 size={18} />}
          {merchant ? "商户供货端" : "平台运营端"}
        </span>
        <h1>
          {merchant ? (
            <>
              好货在手，
              <br />
              供向山海。
            </>
          ) : (
            <>
              一盘好货，
              <br />
              有序经营。
            </>
          )}
        </h1>
        <p>
          {merchant
            ? "维护自己的商品、价格、数量与交期，让平台持续组织有效货源。"
            : "审核商户与商品，汇集供货条件，统一承接海外采购需求。"}
        </p>
        <div className="entry-footer">
          <ShieldCheck size={18} />
          {merchant
            ? "商户平台服务免费 · 供货资格独立审核"
            : "运营账号由平台管理员邀请开通"}
        </div>
      </div>
      <section className="entry-card login-card">
        <h2>{merchant ? "商户登录" : "运营登录"}</h2>
        <p className="muted">
          {merchant
            ? "已入驻商户登录后进入自己的供货工作台。"
            : "仅已开通权限的运营和平台管理员可进入。"}
        </p>
        {invited && <p className="notice">已收到邀请，登录后继续办理。</p>}
        {session.status === "anonymous" ? (
          <>
            <a
              className="btn primary"
              target="_top"
              href={`/signin-with-chatgpt?return_to=${encodeURIComponent(returnTo)}`}
            >
              使用 ChatGPT 账号登录 <ArrowRight size={17} />
            </a>
            {merchant && (
              <p className="muted">
                首次入驻请使用运营提供的邀请，登录后提交商户资料或认领已有档案。
              </p>
            )}
          </>
        ) : (
          <>
            <p className="login-account">当前账号：{displayName}</p>
            {session.status === "member" && (
              <a className="btn primary" href={target}>
                进入{session.portal === "merchant" ? "商户" : "运营"}工作台{" "}
                <ArrowRight size={17} />
              </a>
            )}
            {session.status === "unregistered" &&
              (merchant ? (
                <a className="btn primary" href={target}>
                  继续商户入驻 <ArrowRight size={17} />
                </a>
              ) : (
                <>
                  <p className="notice">
                    当前账号尚未开通运营权限。请联系平台管理员获取专属邀请，申请后等待核实。
                  </p>
                  <a className="btn" href="/accept">
                    查看邀请申请
                  </a>
                </>
              ))}
            {session.status === "disabled" && (
              <p className="error" role="alert">
                运营权限已停用，请联系平台管理员。
              </p>
            )}
            {session.status === "unavailable" && (
              <p className="error" role="alert">
                {session.error}
              </p>
            )}
            <a
              className="text-button"
              target="_top"
              href={`/signout-with-chatgpt?return_to=${encodeURIComponent(`/${portal}/login`)}`}
            >
              切换登录账号
            </a>
          </>
        )}
        <a
          className="login-other"
          href={merchant ? "/operations/login" : "/merchant/login"}
        >
          {merchant ? "平台工作人员，前往运营登录" : "供货商户，前往商户登录"}{" "}
          <ArrowRight size={14} />
        </a>
      </section>
    </main>
  );
}
