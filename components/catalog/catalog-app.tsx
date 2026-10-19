"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  ArrowRight,
  Boxes,
  Check,
  ClipboardList,
  Copy,
  Layers3,
  LoaderCircle,
  Menu,
  Mountain,
  Package,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Store,
  Users,
  X,
} from "lucide-react";
import { offerAvailability } from "../../lib/catalog/domain";
import {
  matchesSupplyFilter,
  supplyHealth,
  type SupplyFilter,
} from "../../lib/catalog/maintenance";
import { ImageField } from "./image-field";
import { AccessManagement } from "./access-management";
import {
  StandardsSettings,
  SkuCategoryFields,
  DeliveryPointField,
} from "./standards-settings";
import {
  deliveryLabel,
  QUANTITY_EXPLANATION,
} from "../../lib/catalog/standards";
import type { Portal } from "../../lib/catalog/platform";
import type {
  CatalogResponse,
  Merchant,
  Offer,
  Sku,
} from "../../lib/catalog/types";
import {
  currency,
  dateAfter,
  Field,
  Modal,
  ProductImage,
  Status,
} from "./primitives";

type Dialog = {
  type: "merchant" | "profile" | "sku" | "image" | "offer" | "review" | "quick";
  item?: Merchant | Sku | Offer;
  kind?: "Merchant" | "Sku" | "Offer";
  field?: "unitPrice" | "availableQuantity" | "leadDays" | "validUntil";
} | null;
const pageNames: Record<string, string> = {
  overview: "供货工作台",
  merchants: "商户入驻",
  skus: "标准 SKU 库",
  offers: "供货报价",
  activity: "操作记录",
  detail: "SKU 供货详情",
  profile: "我的商户",
  members: "账号与成员",
  standards: "货盘标准",
};
const attributeSummary = (sku: Sku) =>
  Object.entries(sku.attributes || {})
    .map(([label, value]) => `${label}：${value}`)
    .join(" · ");

export default function CatalogApp({
  displayName,
  portal,
}: {
  displayName: string;
  portal: Portal;
}) {
  const [result, setResult] = useState<CatalogResponse>({ workspaces: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [page, setPage] = useState("overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mobile, setMobile] = useState(false);
  const [invitationCode, setInvitationCode] = useState("");
  const [origin, setOrigin] = useState("");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [skuId, setSkuId] = useState("");
  const workspace = result.workspace;
  const data = workspace?.data;
  const ops = data?.access.role === "operations";
  const mine = data?.merchants.find((m) => m.id === data.access.merchantId);
  const close = useCallback(() => {
    if (!busy && !uploadBusy) setDialog(null);
  }, [busy, uploadBusy]);
  const navigate = (next: string) => {
    setPage(next);
    setQuery("");
    setStatusFilter("all");
    setMobile(false);
    setError("");
  };
  async function load(id?: string) {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/catalog?portal=${portal}${id ? `&workspaceId=${encodeURIComponent(id)}` : ""}`,
      );
      const body = (await response.json()) as CatalogResponse;
      if (!response.ok) {
        if (response.status === 401 || response.status === 403)
          setResult({ workspaces: [] });
        throw new Error(body.error || "读取失败");
      }
      setResult(body);
      if (body.workspace) {
        try {
          sessionStorage.removeItem("shanhai.join");
        } catch {
          /* Storage may be unavailable. */
        }
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    setOrigin(window.location.origin);
    const incoming = new URLSearchParams(window.location.hash.slice(1)).get(
      "invite",
    );
    let saved = "";
    try {
      if (incoming && /^[a-f0-9]{64}$/i.test(incoming))
        sessionStorage.setItem("shanhai.join", incoming);
      saved = sessionStorage.getItem("shanhai.join") || "";
    } catch {
      saved = incoming || "";
    }
    if (incoming)
      window.history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search,
      );
    if (portal === "merchant" && saved) setInvitationCode(saved);
    void load();
  }, [portal]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function submit(body: unknown) {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const next = (await response.json()) as CatalogResponse;
      if (!response.ok) {
        if (response.status === 409) await load(workspace?.id);
        throw new Error(next.error || "保存失败");
      }
      setResult(next);
      if ((body as { action?: string })?.action === "applyMerchant") {
        try {
          sessionStorage.removeItem("shanhai.join");
        } catch {
          /* In-memory form still works when storage is unavailable. */
        }
        setInvitationCode("");
      }
      setDialog(null);
      setToast("已保存");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const command = (action: string, payload: unknown = {}) =>
    submit({
      action,
      payload,
      workspaceId: workspace?.id,
      revision: workspace?.revision,
    });
  const open = (next: Dialog) => {
    setError("");
    setUploadBusy(false);
    setDialog(next);
  };
  const matches = (...values: string[]) =>
    values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const eligible =
    data?.offers.filter((o) => offerAvailability(data, o) === "可参与匹配") ||
    [];
  const filterOffers = (filter: SupplyFilter) => {
    navigate("offers");
    setStatusFilter(filter);
  };
  const reminders = data
    ? [
        ...(ops
          ? [
              {
                title: "商户待审核",
                count: data.merchants.filter((m) => m.status === "pending")
                  .length,
                text: "核实经营资料，开放供货维护",
                run: () => {
                  navigate("merchants");
                  setStatusFilter("pending");
                },
              },
              {
                title: "商品待审核",
                count: data.skus.filter((s) => s.status === "pending").length,
                text: "确认同款身份与标准规格",
                run: () => {
                  navigate("skus");
                  setStatusFilter("pending");
                },
              },
              {
                title: "供货关联待审核",
                count: data.offers.filter((o) => o.status === "pending").length,
                text: "核实商品与商户供货条件",
                run: () => filterOffers("pending"),
              },
            ]
          : [
              {
                title: "需要处理的供货",
                count: data.offers.filter((o) =>
                  matchesSupplyFilter(data, o, "attention"),
                ).length,
                text: "查看审核意见与数量要求",
                run: () => filterOffers("attention"),
              },
            ]),
        {
          title: "即将到期",
          count: data.offers.filter((o) => supplyHealth(data, o).expiring)
            .length,
          text: "3天内到期，请确认供货条件后续期",
          run: () => filterOffers("expiring"),
        },
        {
          title: "报价已过期",
          count: data.offers.filter((o) => supplyHealth(data, o).expired)
            .length,
          text: "更新有效期后才可恢复有效供给",
          run: () => filterOffers("expired"),
        },
        ...(ops
          ? [
              {
                title: "商品缺少图片",
                count: data.skus.filter((s) => !s.imageUrl).length,
                text: "补充清晰图片，便于核对商品",
                run: () => {
                  navigate("skus");
                  setStatusFilter("missing-image");
                },
              },
            ]
          : []),
      ]
    : [];
  const stats = data
    ? [
        {
          title: "标准 SKU",
          number: data.skus.filter((s) => s.status === "active").length,
          hint: "审核通过的商品身份",
          icon: Layers3,
        },
        {
          title: ops ? "入驻商户" : "我的入驻状态",
          number: ops
            ? data.merchants.length
            : mine?.status === "active"
              ? "已准入"
              : mine?.status === "suspended"
                ? "已暂停"
                : "待审核",
          hint: ops
            ? `${data.merchants.filter((m) => m.status === "pending").length} 家待审核`
            : mine?.name || "",
          icon: Store,
        },
        {
          title: "有效供货报价",
          number: eligible.length,
          hint: "价格与数量均符合基本要求",
          icon: ClipboardList,
        },
        {
          title: ops ? "关联多商户的 SKU" : "需要处理的供货",
          number: ops
            ? data.skus.filter(
                (s) =>
                  new Set(
                    data.offers
                      .filter((o) => o.skuId === s.id)
                      .map((o) => o.merchantId),
                  ).size > 1,
              ).length
            : data.offers.filter((o) =>
                matchesSupplyFilter(data, o, "attention"),
              ).length,
          hint: ops ? "同一商品，多方供货" : "待审核、失效或即将到期",
          icon: Boxes,
        },
      ]
    : [];
  const offersTable = (offers: Offer[]) => (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>商品 / 商户货号</th>
            {ops && <th>供货商户</th>}
            <th>供货单价</th>
            <th>可供 / 起订 / 倍数</th>
            <th>交货条件</th>
            <th>有效性</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {offers.map((o) => {
            const sku = data!.skus.find((s) => s.id === o.skuId);
            return (
              <tr key={o.id}>
                <td data-label="商品">
                  <b>{sku?.name}</b>
                  <small>
                    {sku?.code} · {o.merchantCode} · v{o.version}
                  </small>
                </td>
                {ops && (
                  <td data-label="供货商户">
                    {data!.merchants.find((m) => m.id === o.merchantId)?.name}
                  </td>
                )}
                <td className="price" data-label="供货单价">
                  {currency(o.unitPrice)}
                  <small>每{sku?.unit}</small>
                </td>
                <td data-label="数量条件">
                  {o.availableQuantity} / {o.minimumQuantity} / {o.quantityStep}
                  <small>单位：{sku?.unit}</small>
                </td>
                <td data-label="交货条件">
                  {o.leadDays} 天内<small>{o.deliveryLocation}</small>
                </td>
                <td data-label="有效性">
                  <Status value={o.status} />
                  <small>{offerAvailability(data!, o)}</small>
                  <small>有效至 {o.validUntil}</small>
                  {supplyHealth(data!, o).expiring && (
                    <small className="expiry-warning">
                      {supplyHealth(data!, o).daysLeft === 0
                        ? "今天到期"
                        : `${supplyHealth(data!, o).daysLeft}天后到期`}
                    </small>
                  )}
                </td>
                <td data-label="操作">
                  <div className="row-actions">
                    {o.status === "active" &&
                      (ops || mine?.status === "active") && (
                        <>
                          <button
                            onClick={() =>
                              open({
                                type: "quick",
                                item: o,
                                field: "unitPrice",
                              })
                            }
                          >
                            改价
                          </button>
                          <button
                            onClick={() =>
                              open({
                                type: "quick",
                                item: o,
                                field: "availableQuantity",
                              })
                            }
                          >
                            改量
                          </button>
                          <button
                            onClick={() =>
                              open({
                                type: "quick",
                                item: o,
                                field: "leadDays",
                              })
                            }
                          >
                            交期
                          </button>
                          <button
                            onClick={() =>
                              open({
                                type: "quick",
                                item: o,
                                field: "validUntil",
                              })
                            }
                          >
                            续期
                          </button>
                        </>
                      )}
                    <button onClick={() => open({ type: "offer", item: o })}>
                      编辑
                    </button>
                    {ops &&
                      (o.status === "pending" || o.status === "rejected") && (
                        <button
                          onClick={() =>
                            open({ type: "review", kind: "Offer", item: o })
                          }
                        >
                          审核
                        </button>
                      )}
                    {o.status !== "paused" && (
                      <button
                        disabled={busy}
                        onClick={() =>
                          command("pauseOffer", {
                            id: o.id,
                            expectedVersion: o.version,
                          })
                        }
                      >
                        下架
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!offers.length && (
        <Empty
          title="还没有供货报价"
          text="选择已生效的 SKU，填写商户自己的价格、数量和交货条件。"
        />
      )}
    </div>
  );

  function dialogForm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy || uploadBusy) return;
    const form = new FormData(e.currentTarget);
    const s = (key: string) => String(form.get(key) || "").trim();
    const n = (key: string) => Number(s(key));
    if (dialog?.type === "image")
      return void command("updateSkuImage", {
        id: dialog.item!.id,
        imageUrl: s("imageUrl"),
      });
    if (dialog?.type === "quick") {
      const o = dialog.item as Offer;
      const field = dialog.field!;
      return void command("updateOfferTerms", {
        id: o.id,
        expectedVersion: o.version,
        [field]:
          field === "validUntil"
            ? s(field)
            : field === "unitPrice"
              ? Math.round(n(field) * 100)
              : n(field),
        ...(field === "validUntil" || field === "availableQuantity"
          ? { conditionsConfirmed: form.get("conditionsConfirmed") === "on" }
          : {}),
        ...(ops ? { confirmationNote: s("confirmationNote") } : {}),
      });
    }
    if (dialog?.type === "merchant" || dialog?.type === "profile")
      return void command(
        dialog.type === "profile" ? "updateMerchant" : "registerMerchant",
        {
          ...(dialog.type === "profile" ? { id: dialog.item!.id } : {}),
          name: s("name"),
          contact: s("contact"),
          location: s("location"),
          categories: s("categories"),
        },
      );
    if (dialog?.type === "sku") {
      const template = data?.categoryTemplates?.find(
        (t) => t.id === s("categoryTemplateId"),
      );
      const fields = [
        "code",
        "name",
        "category",
        "origin",
        "model",
        "material",
        "specification",
        "quality",
        "unit",
        "packaging",
        "imageUrl",
      ];
      return void command(dialog.item ? "updateSku" : "submitSku", {
        ...Object.fromEntries(fields.map((key) => [key, s(key)])),
        ...(template
          ? {
              categoryTemplateId: template.id,
              attributes: Object.fromEntries(
                template.attributes.map((label, index) => [
                  label,
                  s(`attribute-${index}`),
                ]),
              ),
            }
          : {}),
        ...(dialog.item ? { id: dialog.item.id } : {}),
      });
    }
    if (dialog?.type === "offer") {
      const o = dialog.item as Offer | undefined;
      const point = data?.deliveryPoints?.find(
        (p) => p.id === s("deliveryPointId"),
      );
      return void command("saveOffer", {
        ...(o ? { id: o.id, expectedVersion: o.version } : {}),
        skuId: o?.skuId || s("skuId"),
        merchantId:
          o?.merchantId || (ops ? s("merchantId") : data!.access.merchantId),
        merchantCode: s("merchantCode"),
        unitPrice: Math.round(n("unitPrice") * 100),
        availableQuantity: n("availableQuantity"),
        minimumQuantity: n("minimumQuantity"),
        quantityStep: n("quantityStep"),
        leadDays: n("leadDays"),
        deliveryLocation: point ? deliveryLabel(point) : s("deliveryLocation"),
        ...(point ? { deliveryPointId: point.id } : {}),
        validUntil: s("validUntil"),
        conditionsConfirmed: form.get("conditionsConfirmed") === "on",
        ...(ops ? { confirmationNote: s("confirmationNote") } : {}),
      });
    }
    if (dialog?.type === "review")
      return void command(`review${dialog.kind}`, {
        id: dialog.item!.id,
        status: s("status"),
        note: s("note"),
        ...(dialog.kind === "Offer"
          ? { expectedVersion: (dialog.item as Offer).version }
          : {}),
      });
  }

  let content: ReactNode;
  if (!data) {
    content = (
      <main className="entry">
        <div className="entry-intro">
          <a href="/" className="entry-brand">
            <Mountain size={25} />
            山海供
          </a>
          <h1>
            让每一份好货，
            <br />
            成为可靠的供给。
          </h1>
          <p>
            关联标准商品，维护自己的价格、数量和交期，让平台组织清楚、可靠的供货货盘。
          </p>
          <div className="entry-steps">
            <span>01 商户入驻</span>
            <span>02 标准 SKU</span>
            <span>03 供货维护</span>
          </div>
          <div className="entry-footer">
            <ShieldCheck size={18} /> 商户平台服务免费 · 按供货能力审核
          </div>
        </div>
        <section className="entry-card">
          <h2>{portal === "merchant" ? "商户申请入驻" : "运营访问状态"}</h2>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {portal === "merchant" ? (
            <>
              <p className="muted">
                使用运营提供的入驻邀请码提交资料。已有档案的商户请使用专属认领链接。
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const value = (key: string) => String(f.get(key) || "");
                  void submit({
                    action: "applyMerchant",
                    invitationCode: value("invitationCode"),
                    payload: {
                      name: value("name"),
                      contact: value("contact"),
                      location: value("location"),
                      categories: value("categories"),
                    },
                  });
                }}
              >
                <Field label="入驻邀请码">
                  <input
                    name="invitationCode"
                    autoComplete="off"
                    required
                    minLength={64}
                    maxLength={64}
                    value={invitationCode}
                    onChange={(e) => setInvitationCode(e.target.value)}
                  />
                </Field>
                <MerchantFields />
                <button className="btn primary" disabled={busy || loading}>
                  {busy ? "提交中…" : "提交入驻申请"}
                  <ArrowRight size={16} />
                </button>
              </form>
              <a className="text-button" href="/accept">
                查看已有档案的认领申请
              </a>
            </>
          ) : (
            <p className="notice">
              当前账号无法进入运营后台，请联系平台管理员核实权限。
            </p>
          )}
          <a
            className="text-button"
            href={`/signout-with-chatgpt?return_to=${encodeURIComponent(`/${portal}/login`)}`}
            target="_top"
          >
            切换登录账号
          </a>
        </section>
      </main>
    );
  } else if (page === "overview") {
    content = (
      <>
        <section className="hero">
          <div>
            <span className="eyebrow">A SHARED CATALOG. RELIABLE SUPPLY.</span>
            <h2>
              {ops
                ? "先把货盘做好，让匹配有据可依。"
                : "维护一次供货条件，持续参与匹配。"}
            </h2>
            <p>一个标准 SKU，多家商户独立供货。价格、数量与交期，各自清楚。</p>
            <button
              className="btn light"
              onClick={() => navigate(ops ? "skus" : "offers")}
            >
              {ops ? "管理标准 SKU" : "维护我的供货"}
              <ArrowRight size={16} />
            </button>
          </div>
          <div className="supply-visual" aria-hidden="true">
            <div>
              <Store size={22} /> 商户 A
            </div>
            <div>
              <Store size={22} /> 商户 B
            </div>
            <div>
              <Store size={22} /> 商户 C
            </div>
            <span>
              <Layers3 size={35} />
              标准 SKU
            </span>
          </div>
        </section>
        <div className="stats">
          {stats.map((item) => (
            <article key={item.title}>
              <span>
                {item.title}
                <item.icon size={18} />
              </span>
              <strong>{item.number}</strong>
              <small>{item.hint}</small>
            </article>
          ))}
        </div>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{ops ? "今天需要处理" : "我的供货提醒"}</h2>
              <p>按当前商品与供货条件生成，点击即可处理</p>
            </div>
            <span className="status active">供货维护</span>
          </div>
          <div className="task-grid">
            {reminders.map((task) => (
              <button className="task-card" key={task.title} onClick={task.run}>
                <span>
                  {task.title}
                  <ArrowRight size={16} />
                </span>
                <strong>{task.count}</strong>
                <small>{task.text}</small>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>{ops ? "最近维护的供货报价" : "我的供货报价"}</h2>
              <p>过期、未审核或数量不足的报价不会视为有效供给</p>
            </div>
            <button className="text-button" onClick={() => navigate("offers")}>
              查看全部 <ArrowRight size={15} />
            </button>
          </div>
          {offersTable(
            [...data.offers]
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .slice(0, 5),
          )}
        </section>
      </>
    );
  } else if (page === "merchants" || page === "profile") {
    content = (
      <div className="merchant-grid">
        {data.merchants
          .filter(
            (m) =>
              matches(m.name, m.categories, m.location) &&
              (statusFilter === "all" || m.status === statusFilter),
          )
          .map((m) => (
            <article className="panel merchant-card" key={m.id}>
              <div className="card-top">
                <span className="merchant-icon">
                  <Store />
                </span>
                <Status value={m.status} />
              </div>
              <h2>{m.name}</h2>
              <p>{m.categories}</p>
              <dl>
                <dt>联系人</dt>
                <dd>{m.contact}</dd>
                <dt>经营地址</dt>
                <dd>{m.location}</dd>
                <dt>账号</dt>
                <dd>
                  {m.userId
                    ? "已绑定商户登录账号"
                    : "运营协助维护，暂未绑定商户账号"}
                </dd>
              </dl>
              {m.reviewNote && <p className="note">{m.reviewNote}</p>}
              <button
                className="btn"
                onClick={() => open({ type: "profile", item: m })}
              >
                修改经营资料
              </button>
              {ops && (
                <button
                  className="btn"
                  onClick={() =>
                    open({ type: "review", kind: "Merchant", item: m })
                  }
                >
                  准入 / 暂停管理
                </button>
              )}
              {ops && !m.userId && (
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    command("issueAccessInvitation", {
                      kind: "claim",
                      merchantId: m.id,
                    })
                  }
                >
                  生成专属认领链接
                </button>
              )}
              {ops && !m.userId && (
                <small className="muted">
                  重新生成会撤销该商户之前的认领邀请及待核实申请。
                </small>
              )}
            </article>
          ))}
        {!data.merchants.length && (
          <Empty
            title="登记第一家供货商户"
            text="可以由运营协助登记，也可以给商户邀请码，由商户登录后申请入驻。"
          />
        )}
        {!ops && (
          <section className="panel profile-help">
            <h2>我的供货服务</h2>
            <p>
              商品审核、入驻和供货条件问题，请联系向你发送入驻邀请的平台运营。
            </p>
            <button className="btn" onClick={() => navigate("activity")}>
              查看我的操作记录
            </button>
            <a
              className="text-button"
              href="/signout-with-chatgpt?return_to=%2Fmerchant%2Flogin"
              target="_top"
            >
              退出登录
            </a>
          </section>
        )}
      </div>
    );
  } else if (page === "standards" && ops) {
    content = <StandardsSettings data={data} busy={busy} command={command} />;
  } else if (page === "members" && ops) {
    content = (
      <AccessManagement
        data={data}
        busy={busy}
        error={error}
        command={command}
      />
    );
  } else if (page === "skus") {
    content = (
      <>
        <div className="toolbar">
          <p>SKU 只描述商品身份，供货价与数量由商户分别维护。</p>
          <label>
            状态{" "}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">全部</option>
              <option value="active">已生效</option>
              <option value="pending">待审核</option>
              <option value="rejected">需修改</option>
              <option value="missing-image">缺少图片</option>
            </select>
          </label>
        </div>
        <div className="sku-grid">
          {data.skus
            .filter(
              (s) =>
                matches(s.name, s.code, s.specification, attributeSummary(s)) &&
                (statusFilter === "all" ||
                  s.status === statusFilter ||
                  (statusFilter === "missing-image" && !s.imageUrl)),
            )
            .map((s) => (
              <article className="panel sku-card" key={s.id}>
                <button
                  className="sku-image-button"
                  onClick={() => {
                    setSkuId(s.id);
                    navigate("detail");
                  }}
                >
                  <ProductImage url={s.imageUrl} name={s.name} />
                </button>
                <div className="sku-body">
                  <div className="card-top">
                    <small>
                      {s.category} · {s.code}
                    </small>
                    <Status value={s.status} />
                  </div>
                  <button
                    className="sku-title"
                    onClick={() => {
                      setSkuId(s.id);
                      navigate("detail");
                    }}
                  >
                    {s.name}
                    <ArrowRight size={17} />
                  </button>
                  <p>{s.specification}</p>
                  {attributeSummary(s) && (
                    <p className="note">{attributeSummary(s)}</p>
                  )}
                  <div className="sku-foot">
                    <span>
                      {data.offers.filter((o) => o.skuId === s.id).length}{" "}
                      份供货报价
                    </span>
                    {s.status !== "active" &&
                      (ops || s.submittedBy === "me") && (
                        <button
                          className="text-button"
                          onClick={() => open({ type: "sku", item: s })}
                        >
                          修改
                        </button>
                      )}
                    {ops && (
                      <button
                        className="text-button"
                        onClick={() => open({ type: "image", item: s })}
                      >
                        {s.imageUrl ? "修改图片" : "补充图片"}
                      </button>
                    )}
                    {ops && s.status !== "active" && (
                      <button
                        className="text-button"
                        onClick={() =>
                          open({ type: "review", kind: "Sku", item: s })
                        }
                      >
                        审核商品身份
                      </button>
                    )}
                  </div>
                </div>
              </article>
            ))}
        </div>
        {!data.skus.length && (
          <Empty
            title="建立平台标准商品库"
            text="先统一型号、材质和规格，再让多家商户关联供货。"
          />
        )}
      </>
    );
  } else if (page === "detail") {
    const sku = data.skus.find((s) => s.id === skuId);
    content = sku ? (
      <>
        <button className="text-button back" onClick={() => navigate("skus")}>
          ← 返回标准 SKU 库
        </button>
        <section className="panel sku-detail">
          <ProductImage url={sku.imageUrl} name={sku.name} />
          <div>
            <div className="card-top">
              <small>{sku.code}</small>
              <Status value={sku.status} />
            </div>
            <h2>{sku.name}</h2>
            <dl>
              {[
                ["品牌 / 来源", sku.origin],
                ["型号", sku.model],
                ["材质", sku.material],
                ["规格", sku.specification],
                ["质量标准", sku.quality],
                ["计量单位", sku.unit],
                ["包装", sku.packaging],
                ...Object.entries(sku.attributes || {}),
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v}</dd>
                </div>
              ))}
            </dl>
            <p className="note">
              {sku.reviewNote ||
                "等待运营核实商品身份。审核后，同款商户可在此 SKU 下分别挂价。"}
            </p>
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <h2>此 SKU 的供货报价</h2>
            <button
              className="btn primary"
              disabled={
                sku.status !== "active" || (!ops && mine?.status !== "active")
              }
              onClick={() => open({ type: "offer" })}
            >
              新增供货报价
            </button>
          </div>
          {offersTable(data.offers.filter((o) => o.skuId === sku.id))}
        </section>
      </>
    ) : (
      <Empty title="商品不存在" text="请返回商品库重新选择。" />
    );
  } else if (page === "offers") {
    content = (
      <>
        <div className="notice">
          <ShieldCheck size={18} />
          <span>
            <b>统一价格口径：</b>
            {data.priceBasis}。商户供货价为内部采购成本，后续客户报价单独管理。
          </span>
        </div>
        <div className="supply-filters" aria-label="供货状态筛选">
          {(
            [
              ["all", "全部"],
              ["available", "有效供货"],
              ["pending", "待审核"],
              ["expiring", "即将到期"],
              ["expired", "已过期"],
              ["paused", "已下架"],
              ["attention", "需处理"],
            ] as [SupplyFilter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              className={statusFilter === key ? "active" : ""}
              aria-pressed={statusFilter === key}
              onClick={() => setStatusFilter(key)}
            >
              {label}
              <span>
                {
                  data.offers.filter((o) => matchesSupplyFilter(data, o, key))
                    .length
                }
              </span>
            </button>
          ))}
        </div>
        <section className="panel">
          {offersTable(
            data.offers.filter((o) => {
              const sku = data.skus.find((s) => s.id === o.skuId);
              return (
                matchesSupplyFilter(data, o, statusFilter as SupplyFilter) &&
                matches(
                  sku?.name || "",
                  sku?.code || "",
                  o.merchantCode,
                  data.merchants.find((m) => m.id === o.merchantId)?.name || "",
                )
              );
            }),
          )}
        </section>
      </>
    );
  } else {
    content = (
      <section className="panel activity">
        <div className="panel-heading">
          <h2>供货资料变更记录</h2>
          <p>记录提交、审核和更新，不自动覆盖历史操作</p>
        </div>
        {data.events
          .filter((e) => matches(e.action, e.detail))
          .map((e) => (
            <article key={e.id}>
              <span className="timeline-dot" />
              <div>
                <b>{e.action}</b>
                <p>{e.detail}</p>
              </div>
              <time>
                {new Date(e.at).toLocaleString("zh-CN", {
                  timeZone: "Asia/Shanghai",
                })}
              </time>
            </article>
          ))}
        {!data.events.length && (
          <Empty
            title="暂无操作记录"
            text="商户和商品开始维护后，相关记录会显示在这里。"
          />
        )}
      </section>
    );
  }

  const skuEdit =
    dialog?.type === "sku" ? (dialog.item as Sku | undefined) : undefined;
  const offer =
    dialog?.type === "offer" || dialog?.type === "quick"
      ? (dialog.item as Offer | undefined)
      : undefined;
  return (
    <div className="app-shell">
      {data && (
        <>
          <aside className={`sidebar ${mobile ? "open" : ""}`}>
            <div className="brand">
              <span>
                <Mountain size={25} />
              </span>
              <div>
                <b>山海供</b>
                <small>SHANHAI SUPPLY</small>
              </div>
            </div>
            <div className="workspace-name">
              <i />
              {workspace?.name}
            </div>
            <p className="nav-caption">供货基础管理</p>
            <nav>
              {(ops
                ? [
                    { id: "overview", name: "供货工作台", icon: Layers3 },
                    {
                      id: "merchants",
                      name: ops ? "商户入驻" : "我的商户",
                      icon: Users,
                    },
                    { id: "skus", name: "标准 SKU 库", icon: Package },
                    {
                      id: "offers",
                      name: ops ? "商户供货报价" : "我的供货报价",
                      icon: ClipboardList,
                    },
                    { id: "activity", name: "操作记录", icon: ShieldCheck },
                    { id: "standards", name: "货盘标准", icon: Layers3 },
                    {
                      id: "members",
                      name: `账号与成员${data.accessInvitations.some((i) => i.status === "requested") ? " · 待核实" : ""}`,
                      icon: Users,
                    },
                  ]
                : [
                    { id: "overview", name: "首页", icon: Layers3 },
                    { id: "offers", name: "我的供货", icon: ClipboardList },
                    { id: "profile", name: "我的", icon: Store },
                  ]
              ).map((n) => (
                <button
                  key={n.id}
                  className={
                    page === n.id || (page === "detail" && n.id === "skus")
                      ? "active"
                      : ""
                  }
                  onClick={() => navigate(n.id)}
                >
                  <n.icon size={19} />
                  {n.name}
                </button>
              ))}
            </nav>
            <div className="sidebar-bottom">
              <b>商户平台服务免费</b>
              <p>
                准入与供货能力审核
                <br />
                与付费社群权益独立
              </p>
              <a href="/">返回山海供首页</a>
            </div>
          </aside>
          {mobile && (
            <button
              className="scrim"
              aria-label="关闭导航"
              onClick={() => setMobile(false)}
            />
          )}
        </>
      )}
      <div className={data ? "main-shell" : "welcome-shell"}>
        <header className="topbar">
          <div>
            <button
              className="icon-button mobile-menu"
              aria-label="打开导航"
              onClick={() => setMobile(true)}
            >
              <Menu size={21} />
            </button>
            <span>
              {data
                ? pageNames[page]
                : `山海供 · ${portal === "merchant" ? "商户入驻" : "运营后台"}`}
            </span>
          </div>
          <div className="topbar-right">
            {workspace && (
              <span className="platform-name">{workspace.name}</span>
            )}
            <span className="account">
              <i>{displayName.slice(0, 1) || "山"}</i>
              <span>
                {data
                  ? ops
                    ? data.access.role === "operations" && data.access.isOwner
                      ? "平台管理员"
                      : "平台运营"
                    : "供货商户"
                  : "已登录"}
                <small>{displayName}</small>
              </span>
            </span>
          </div>
        </header>
        {data ? (
          <main className="main-content">
            <div className="page-heading">
              <div>
                <small>山海供 · {ops ? "运营后台" : "商户供货端"}</small>
                <h1>{pageNames[page]}</h1>
                <p>
                  {ops
                    ? "统一商品身份，让每家商户的供货条件清楚、有效。"
                    : "维护好你的价格、数量与交期，让好货持续可供。"}
                </p>
              </div>
              <div className="heading-actions">
                <button
                  className="btn"
                  disabled={loading || busy}
                  onClick={() => load(workspace?.id)}
                >
                  <RefreshCw size={15} />
                  刷新
                </button>
                {page === "merchants" && ops && (
                  <>
                    <button
                      className="btn"
                      disabled={busy}
                      onClick={() => command("rotateInvitation")}
                    >
                      生成入驻邀请码
                    </button>
                    <button
                      className="btn primary"
                      onClick={() => open({ type: "merchant" })}
                    >
                      <Plus size={16} />
                      登记商户
                    </button>
                  </>
                )}
                {page === "skus" && (
                  <button
                    className="btn primary"
                    disabled={!ops && mine?.status !== "active"}
                    onClick={() => open({ type: "sku" })}
                  >
                    <Plus size={16} />
                    提交标准 SKU
                  </button>
                )}
                {page === "offers" && (
                  <button
                    className="btn primary"
                    disabled={!ops && mine?.status !== "active"}
                    onClick={() => {
                      setSkuId("");
                      if (ops) open({ type: "offer" });
                      else navigate("skus");
                    }}
                  >
                    <Plus size={16} />
                    {ops ? "新增供货报价" : "查找商品并供货"}
                  </button>
                )}
              </div>
            </div>
            {!ops && mine?.status !== "active" && (
              <div className="notice">
                <ShieldCheck />
                <span>
                  你的商户当前
                  {mine?.status === "suspended" ? "已暂停" : "等待准入审核"}
                  ，审核通过后可以提交商品和维护供货报价。
                </span>
              </div>
            )}
            {result.invitationCode && (
              <section className="invitation panel">
                <b>商户入驻链接</b>
                <p>
                  有效至{" "}
                  {new Date(result.invitationExpiresAt!).toLocaleString(
                    "zh-CN",
                    { timeZone: "Asia/Shanghai" },
                  )}
                  ，将链接发给商户，登录后即可填写申请。更新邀请后旧链接失效，已入驻商户不受影响。
                </p>
                <div>
                  <input
                    aria-label="商户入驻链接"
                    readOnly
                    value={`${origin}/merchant/login#invite=${result.invitationCode}`}
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/merchant/login#invite=${result.invitationCode!}`,
                        );
                        setToast("入驻链接已复制");
                      } catch {
                        setToast("请选中入驻链接手动复制");
                      }
                    }}
                  >
                    <Copy size={15} />
                    复制入驻链接
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    setResult({ ...result, invitationCode: undefined })
                  }
                >
                  收起邀请
                </button>
              </section>
            )}
            {result.accessInvitationCode && (
              <section className="invitation panel">
                <b>专属账号邀请 · {result.accessInvitationLabel}</b>
                <p>
                  仅交给对应受邀人。有效至{" "}
                  {new Date(result.accessInvitationExpiresAt!).toLocaleString(
                    "zh-CN",
                    { timeZone: "Asia/Shanghai" },
                  )}
                  ，对方申请后请到「账号与成员」核实。链接仅本次显示，需重新生成才能再次获取。
                </p>
                <div>
                  <input
                    aria-label="专属账号邀请链接"
                    readOnly
                    value={`${origin}/${result.accessInvitationKind === "operations" ? "operations" : "merchant"}/login#access=${result.accessInvitationCode}`}
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          `${window.location.origin}/${result.accessInvitationKind === "operations" ? "operations" : "merchant"}/login#access=${result.accessInvitationCode}`,
                        );
                        setToast("专属邀请链接已复制");
                      } catch {
                        setToast("请选中邀请链接手动复制");
                      }
                    }}
                  >
                    <Copy size={15} />
                    复制链接
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    setResult({ ...result, accessInvitationCode: undefined })
                  }
                >
                  收起邀请
                </button>
              </section>
            )}
            {error && !dialog && (
              <div className="error" role="alert">
                {error}
              </div>
            )}
            {loading ? (
              <div className="loading">
                <LoaderCircle className="spin" /> 正在读取供货资料…
              </div>
            ) : (
              <>
                {!["overview", "detail", "standards"].includes(page) && (
                  <label className="search">
                    <Search size={17} />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="搜索当前页面…"
                      aria-label="搜索当前页面"
                    />
                  </label>
                )}
                {content}
              </>
            )}
            <footer>
              <span>山海供 · 海外供货平台</span>
              <a
                href={`/signout-with-chatgpt?return_to=${encodeURIComponent(`/${portal}/login`)}`}
                target="_top"
              >
                退出登录
              </a>
              <span>商户免费入驻 · 供货资料独立维护</span>
            </footer>
          </main>
        ) : (
          <>
            {loading && (
              <div className="loading">
                <LoaderCircle className="spin" />
                读取账号资料…
              </div>
            )}
            {content}
          </>
        )}
      </div>
      {dialog && (
        <Modal
          title={
            dialog.type === "quick"
              ? {
                  unitPrice: "修改供货价",
                  availableQuantity: "修改可供数量",
                  leadDays: "修改交货天数",
                  validUntil: "确认条件并续期",
                }[dialog.field!]
              : dialog.type === "image"
                ? "维护商品图片"
                : dialog.type === "profile"
                  ? "修改经营资料"
                  : dialog.type === "merchant"
                    ? "登记供货商户"
                    : dialog.type === "sku"
                      ? "提交标准 SKU"
                      : dialog.type === "offer"
                        ? offer
                          ? "编辑供货报价"
                          : "新增供货报价"
                        : "审核与状态管理"
          }
          close={close}
        >
          <form onSubmit={dialogForm}>
            <div className="modal-body">
              {error && (
                <div className="error" role="alert">
                  {error}
                </div>
              )}
              {dialog.type === "image" && (
                <ImageField
                  workspaceId={workspace!.id}
                  initialUrl={(dialog.item as Sku).imageUrl}
                  onBusy={setUploadBusy}
                />
              )}
              {dialog.type === "quick" && offer && (
                <>
                  <p className="notice">
                    {data?.skus.find((s) => s.id === offer.skuId)?.name} ·{" "}
                    {offer.merchantCode}
                    <br />
                    {data?.priceBasis}
                  </p>
                  {dialog.field === "validUntil" ? (
                    <>
                      <dl className="renew-summary">
                        <dt>当前供货价</dt>
                        <dd>{currency(offer.unitPrice)}</dd>
                        <dt>可供数量</dt>
                        <dd>{offer.availableQuantity}</dd>
                        <dt>起订 / 数量倍数</dt>
                        <dd>
                          {offer.minimumQuantity} / {offer.quantityStep}
                        </dd>
                        <dt>交货条件</dt>
                        <dd>
                          {offer.leadDays}天内 · {offer.deliveryLocation}
                        </dd>
                        <dt>原有效期</dt>
                        <dd>{offer.validUntil}</dd>
                      </dl>
                      <Field label="新的有效期">
                        <input
                          name="validUntil"
                          type="date"
                          min={[
                            dateAfter(0),
                            new Date(Date.parse(offer.validUntil) + 86400000)
                              .toISOString()
                              .slice(0, 10),
                          ]
                            .sort()
                            .at(-1)}
                          defaultValue={[
                            dateAfter(7),
                            new Date(
                              Date.parse(offer.validUntil) + 7 * 86400000,
                            )
                              .toISOString()
                              .slice(0, 10),
                          ]
                            .sort()
                            .at(-1)}
                          required
                        />
                      </Field>
                      <label className="checkbox-row">
                        <input
                          name="conditionsConfirmed"
                          type="checkbox"
                          required
                        />
                        我已核实上述价格、数量和交货条件，在新的有效期内仍然有效。
                      </label>
                    </>
                  ) : (
                    <Field
                      label={
                        dialog.field === "unitPrice"
                          ? "新的供货单价（元）"
                          : dialog.field === "availableQuantity"
                            ? "新的可供数量"
                            : "新的交货天数"
                      }
                      hint={
                        dialog.field === "availableQuantity"
                          ? "填写本次最新可供数量，不是增加的数量。"
                          : undefined
                      }
                    >
                      <input
                        name={dialog.field}
                        type="number"
                        min={dialog.field === "unitPrice" ? "0.01" : "0"}
                        max={dialog.field === "leadDays" ? "365" : "1000000"}
                        step={dialog.field === "unitPrice" ? "0.01" : "1"}
                        required
                        defaultValue={
                          dialog.field === "unitPrice"
                            ? offer.unitPrice / 100
                            : offer[dialog.field!]
                        }
                      />
                    </Field>
                  )}
                  {ops && (
                    <Field label="与商户核实的依据">
                      <textarea
                        name="confirmationNote"
                        rows={3}
                        required
                        maxLength={1000}
                        placeholder="例如：今日电话确认可供200件，联系人张先生"
                      />
                    </Field>
                  )}
                  {(dialog.field === "availableQuantity" ||
                    dialog.field === "validUntil") && (
                    <p className="notice">{QUANTITY_EXPLANATION}</p>
                  )}
                  {dialog.field === "availableQuantity" && (
                    <label className="checkbox-row">
                      <input
                        name="conditionsConfirmed"
                        type="checkbox"
                        required
                      />
                      我已核实，此数量符合上述供货口径。
                    </label>
                  )}
                  {supplyHealth(data!, offer).expired &&
                    dialog.field !== "validUntil" && (
                      <p className="note">
                        该报价已过期。本次修改不会自动续期，请核实全部条件后另行续期。
                      </p>
                    )}
                </>
              )}
              {(dialog.type === "merchant" || dialog.type === "profile") && (
                <>
                  <p className="notice">
                    {dialog.type === "profile"
                      ? "修改经营资料后需要重新审核，审核通过前暂不作为有效供货商。"
                      : "运营协助登记的商户暂未绑定登录账号，由运营维护供货资料。"}
                  </p>
                  <div className="form-grid">
                    <MerchantFields
                      merchant={
                        dialog.type === "profile"
                          ? (dialog.item as Merchant)
                          : undefined
                      }
                    />
                  </div>
                </>
              )}
              {dialog.type === "sku" && (
                <>
                  <p className="notice">
                    请先查找已有 SKU。只有商品身份一致的供货，才能挂在同一 SKU
                    下。
                  </p>
                  <div className="form-grid">
                    <Field label="平台 SKU 编码">
                      <input
                        name="code"
                        defaultValue={skuEdit?.code}
                        required
                        placeholder="例如 HOME-BASKET-001"
                        pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,59}"
                      />
                    </Field>
                    <Field label="商品名称">
                      <input
                        name="name"
                        defaultValue={skuEdit?.name}
                        required
                        maxLength={200}
                      />
                    </Field>
                    <SkuCategoryFields
                      templates={data?.categoryTemplates || []}
                      sku={skuEdit}
                    />
                    <Field label="品牌 / 生产来源">
                      <input
                        name="origin"
                        defaultValue={skuEdit?.origin}
                        required
                        maxLength={200}
                      />
                    </Field>
                    <Field label="型号">
                      <input
                        name="model"
                        defaultValue={skuEdit?.model}
                        required
                        maxLength={200}
                      />
                    </Field>
                    <Field label="材质">
                      <input
                        name="material"
                        defaultValue={skuEdit?.material}
                        required
                        maxLength={200}
                      />
                    </Field>
                    <Field label="规格 / 颜色 / 尺寸" wide>
                      <input
                        name="specification"
                        defaultValue={skuEdit?.specification}
                        required
                        maxLength={200}
                      />
                    </Field>
                    <Field label="质量标准" wide>
                      <input
                        name="quality"
                        defaultValue={skuEdit?.quality}
                        required
                        maxLength={200}
                        placeholder="填写可核验的等级或质量要求"
                      />
                    </Field>
                    <Field label="计量单位">
                      <input
                        name="unit"
                        required
                        maxLength={30}
                        defaultValue={skuEdit?.unit || "件"}
                      />
                    </Field>
                    <Field label="标准包装">
                      <input
                        name="packaging"
                        defaultValue={skuEdit?.packaging}
                        required
                        maxLength={200}
                        placeholder="例如单件独立包装，20件/箱"
                      />
                    </Field>
                    <ImageField
                      workspaceId={workspace!.id}
                      initialUrl={skuEdit?.imageUrl}
                      onBusy={setUploadBusy}
                    />
                  </div>
                </>
              )}
              {dialog.type === "offer" && (
                <>
                  <p className="notice">
                    {data?.priceBasis}
                    。首次供货关联由运营核实；已审核关联更新价格、数量后直接生效并保留版本。
                  </p>
                  <div className="form-grid">
                    <Field label="标准 SKU" wide>
                      <select
                        name="skuId"
                        required
                        disabled={Boolean(offer)}
                        defaultValue={offer?.skuId || skuId || ""}
                      >
                        <option value="">请选择已审核 SKU</option>
                        {data?.skus
                          .filter((s) => s.status === "active")
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.code} · {s.name} · {s.specification}
                              {attributeSummary(s)
                                ? ` · ${attributeSummary(s)}`
                                : ""}
                            </option>
                          ))}
                      </select>
                    </Field>
                    {ops && (
                      <Field label="供货商户" wide>
                        <select
                          name="merchantId"
                          required
                          disabled={Boolean(offer)}
                          defaultValue={offer?.merchantId || ""}
                        >
                          <option value="">请选择已准入商户</option>
                          {data?.merchants
                            .filter((m) => m.status === "active")
                            .map((m) => (
                              <option key={m.id} value={m.id}>
                                {m.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                    )}
                    <Field label="商户内部货号">
                      <input
                        name="merchantCode"
                        required
                        defaultValue={offer?.merchantCode}
                        maxLength={200}
                      />
                    </Field>
                    <Field label="供货单价（元 / 标准单位）">
                      <input
                        name="unitPrice"
                        type="number"
                        min="0.01"
                        max="1000000"
                        step="0.01"
                        required
                        defaultValue={offer ? offer.unitPrice / 100 : ""}
                      />
                    </Field>
                    <Field label="可供数量" hint={QUANTITY_EXPLANATION}>
                      <input
                        name="availableQuantity"
                        type="number"
                        min="0"
                        max="1000000"
                        step="1"
                        required
                        defaultValue={offer?.availableQuantity ?? 0}
                      />
                    </Field>
                    <Field label="最低起订量">
                      <input
                        name="minimumQuantity"
                        type="number"
                        min="1"
                        max="1000000"
                        step="1"
                        required
                        defaultValue={offer?.minimumQuantity ?? 1}
                      />
                    </Field>
                    <Field
                      label="数量倍数"
                      hint="例如20表示按20、40、60件供货。"
                    >
                      <input
                        name="quantityStep"
                        type="number"
                        min="1"
                        max="1000000"
                        step="1"
                        required
                        defaultValue={offer?.quantityStep ?? 1}
                      />
                    </Field>
                    <Field label="备货交货天数">
                      <input
                        name="leadDays"
                        type="number"
                        min="0"
                        max="365"
                        step="1"
                        required
                        defaultValue={offer?.leadDays ?? 3}
                      />
                    </Field>
                    <DeliveryPointField data={data!} offer={offer} />
                    <Field label="报价有效至">
                      <input
                        name="validUntil"
                        type="date"
                        min={dateAfter(0)}
                        required
                        defaultValue={offer?.validUntil || dateAfter(7)}
                      />
                    </Field>
                    {ops && (
                      <Field label="与商户核实的依据" wide>
                        <textarea
                          name="confirmationNote"
                          required
                          rows={3}
                          maxLength={1000}
                          placeholder="记录核实时间、联系人及确认结果"
                        />
                      </Field>
                    )}
                    <label className="checkbox-row wide">
                      <input
                        name="conditionsConfirmed"
                        type="checkbox"
                        required
                      />
                      我已核实商品、供货价、自由可供数量、交期及有效期。
                    </label>
                  </div>
                </>
              )}
              {dialog.type === "review" && (
                <div className="form-grid">
                  <Field label="审核结果" wide>
                    <select name="status" defaultValue="active">
                      <option value="active">审核通过 / 准入</option>
                      <option
                        value={
                          dialog.kind === "Merchant" ? "suspended" : "rejected"
                        }
                      >
                        {dialog.kind === "Merchant" ? "暂停供货" : "需修改资料"}
                      </option>
                    </select>
                  </Field>
                  <Field label="审核依据与说明" wide>
                    <textarea
                      name="note"
                      required
                      maxLength={1000}
                      rows={4}
                      placeholder="记录经营资料、商品身份或供货条件的核实依据"
                    />
                  </Field>
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={close}
                disabled={busy || uploadBusy}
              >
                取消
              </button>
              <button
                className="btn primary"
                type="submit"
                disabled={busy || uploadBusy}
              >
                {busy ? "保存中…" : uploadBusy ? "正在上传图片…" : "确认并保存"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {toast && (
        <div className="toast" role="status">
          <Check size={17} />
          {toast}
          <button
            className="icon-button"
            onClick={() => setToast("")}
            aria-label="关闭提示"
          >
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}

function MerchantFields({ merchant }: { merchant?: Merchant }) {
  return (
    <>
      <Field label="商户名称">
        <input
          name="name"
          defaultValue={merchant?.name}
          required
          maxLength={200}
        />
      </Field>
      <Field label="联系人及联系方式">
        <input
          name="contact"
          defaultValue={merchant?.contact}
          required
          maxLength={200}
        />
      </Field>
      <Field label="档口 / 经营地址">
        <input
          name="location"
          defaultValue={merchant?.location}
          required
          maxLength={200}
        />
      </Field>
      <Field label="主营品类">
        <input
          name="categories"
          defaultValue={merchant?.categories}
          required
          maxLength={200}
          placeholder="例如家居日用、家纺"
        />
      </Field>
    </>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <Package size={31} strokeWidth={1.3} />
      <h3>{title}</h3>
      <p>{text}</p>
    </div>
  );
}
