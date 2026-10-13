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
  type: "merchant" | "sku" | "offer" | "review";
  item?: Merchant | Sku | Offer;
  kind?: "Merchant" | "Sku" | "Offer";
} | null;
const pageNames: Record<string, string> = {
  overview: "供货工作台",
  merchants: "商户入驻",
  skus: "标准 SKU 库",
  offers: "供货报价",
  activity: "操作记录",
  detail: "SKU 供货详情",
};
const categories = ["家居日用", "家纺布艺", "箱包配饰", "其他"];

export default function CatalogApp({ displayName }: { displayName: string }) {
  const [result, setResult] = useState<CatalogResponse>({ workspaces: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [page, setPage] = useState("overview");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [mobile, setMobile] = useState(false);
  const [entryMode, setEntryMode] = useState<"create" | "join">("create");
  const [showEntry, setShowEntry] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [skuId, setSkuId] = useState("");
  const workspace = result.workspace;
  const data = workspace?.data;
  const ops = data?.access.role === "operations";
  const mine = data?.merchants.find((m) => m.id === data.access.merchantId);
  const close = useCallback(() => setDialog(null), []);
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
        `/api/catalog${id ? `?workspaceId=${encodeURIComponent(id)}` : ""}`,
      );
      const body = (await response.json()) as CatalogResponse;
      if (!response.ok) throw new Error(body.error || "读取失败");
      setResult(body);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  async function submit(body: unknown) {
    if (busy) return;
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
      setDialog(null);
      setShowEntry(false);
      setToast("已保存");
    } catch (e) {
      setError((e as Error).message);
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
    setDialog(next);
  };
  const matches = (...values: string[]) =>
    values.join(" ").toLowerCase().includes(query.trim().toLowerCase());
  const eligible =
    data?.offers.filter((o) => offerAvailability(data, o) === "可参与匹配") ||
    [];
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
          title: "关联多商户的 SKU",
          number: data.skus.filter(
            (s) =>
              new Set(
                data.offers
                  .filter((o) => o.skuId === s.id)
                  .map((o) => o.merchantId),
              ).size > 1,
          ).length,
          hint: ops ? "同一商品，多方供货" : "当前仅显示自己的货源",
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
                </td>
                <td data-label="操作">
                  <div className="row-actions">
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
    const form = new FormData(e.currentTarget);
    const s = (key: string) => String(form.get(key) || "").trim();
    const n = (key: string) => Number(s(key));
    if (dialog?.type === "merchant")
      return void command("registerMerchant", {
        name: s("name"),
        contact: s("contact"),
        location: s("location"),
        categories: s("categories"),
      });
    if (dialog?.type === "sku") {
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
        ...(dialog.item ? { id: dialog.item.id } : {}),
      });
    }
    if (dialog?.type === "offer") {
      const o = dialog.item as Offer | undefined;
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
        deliveryLocation: s("deliveryLocation"),
        validUntil: s("validUntil"),
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
  if (!data || showEntry) {
    content = (
      <main className="entry">
        <div className="entry-intro">
          <span className="eyebrow">LUOSI SUPPLY / M1</span>
          <h1>
            让每一份好货，
            <br />
            成为可靠的供给。
          </h1>
          <p>
            商户维护商品和供货条件，平台建立统一商品库，为自动组货准备真实、有效的货源。
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
          <div className="tabs">
            <button
              className={entryMode === "create" ? "active" : ""}
              onClick={() => setEntryMode("create")}
            >
              运营建立空间
            </button>
            <button
              className={entryMode === "join" ? "active" : ""}
              onClick={() => setEntryMode("join")}
            >
              商户申请入驻
            </button>
          </div>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <form
            key={entryMode}
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const v = (k: string) => String(f.get(k) || "");
              if (entryMode === "create")
                void submit({
                  action: "createWorkspace",
                  name: v("name"),
                  priceBasis: v("priceBasis"),
                });
              else
                void submit({
                  action: "applyMerchant",
                  invitationCode: v("invitationCode"),
                  payload: {
                    name: v("name"),
                    contact: v("contact"),
                    location: v("location"),
                    categories: v("categories"),
                  },
                });
            }}
          >
            {entryMode === "create" ? (
              <>
                <h2>建立你的运营空间</h2>
                <p className="muted">
                  从空白货盘开始，当前账号成为该空间运营负责人。
                </p>
                <Field label="空间名称">
                  <input
                    name="name"
                    required
                    maxLength={160}
                    defaultValue="螺蛳湾海外供货"
                  />
                </Field>
                <Field
                  label="统一供货价格口径"
                  hint="整个空间按相同口径维护商户价格，创建后由系统统一展示。"
                >
                  <input
                    name="priceBasis"
                    required
                    maxLength={160}
                    defaultValue="人民币含税商品供货价，国内运费另计"
                  />
                </Field>
              </>
            ) : (
              <>
                <h2>加入运营空间</h2>
                <p className="muted">
                  使用运营提供的邀请码，提交经营资料。审核通过后可维护供货商品。
                </p>
                <Field label="入驻邀请码">
                  <input
                    name="invitationCode"
                    autoComplete="off"
                    required
                    minLength={64}
                    maxLength={64}
                  />
                </Field>
                <MerchantFields />
              </>
            )}
            <button className="btn primary" disabled={busy || loading}>
              {busy
                ? "保存中…"
                : entryMode === "create"
                  ? "建立运营空间"
                  : "提交入驻申请"}
              <ArrowRight size={16} />
            </button>
          </form>
          {workspace && (
            <button className="text-button" onClick={() => setShowEntry(false)}>
              返回现有空间
            </button>
          )}
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
              <h2>当前开发里程碑</h2>
              <p>M1 · 商户与标准货盘</p>
            </div>
            <span className="status active">进行小范围验证</span>
          </div>
          <div className="milestones">
            <div>
              <Check />
              <b>商户入驻</b>
              <small>经营资料与准入</small>
            </div>
            <div>
              <Check />
              <b>标准 SKU 库</b>
              <small>统一商品身份</small>
            </div>
            <div>
              <Check />
              <b>商户供货维护</b>
              <small>一款商品，多份报价</small>
            </div>
            <div className="later">
              <span>04</span>
              <b>自动匹配组货</b>
              <small>下一里程碑</small>
            </div>
            <div className="later">
              <span>05</span>
              <b>对外报价</b>
              <small>后续里程碑</small>
            </div>
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
  } else if (page === "merchants") {
    content = (
      <div className="merchant-grid">
        {data.merchants
          .filter((m) => matches(m.name, m.categories, m.location))
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
            </article>
          ))}
        {!data.merchants.length && (
          <Empty
            title="登记第一家供货商户"
            text="可以由运营协助登记，也可以给商户邀请码，由商户登录后申请入驻。"
          />
        )}
      </div>
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
            </select>
          </label>
        </div>
        <div className="sku-grid">
          {data.skus
            .filter(
              (s) =>
                matches(s.name, s.code, s.specification) &&
                (statusFilter === "all" || s.status === statusFilter),
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
        <section className="panel">
          {offersTable(
            data.offers.filter((o) => {
              const sku = data.skus.find((s) => s.id === o.skuId);
              return matches(
                sku?.name || "",
                sku?.code || "",
                o.merchantCode,
                data.merchants.find((m) => m.id === o.merchantId)?.name || "",
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
    dialog?.type === "offer" ? (dialog.item as Offer | undefined) : undefined;
  return (
    <div className="app-shell">
      {data && !showEntry && (
        <>
          <aside className={`sidebar ${mobile ? "open" : ""}`}>
            <div className="brand">
              <span>
                <Boxes size={25} />
              </span>
              <div>
                <b>螺蛳湾 · 海外供货</b>
                <small>LUOSI SUPPLY</small>
              </div>
            </div>
            <div className="workspace-name">
              <i />
              {workspace?.name}
            </div>
            <p className="nav-caption">供货基础管理</p>
            <nav>
              {[
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
              ].map((n) => (
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
              <small>M1 · 标准货盘基础版</small>
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
      <div className={data && !showEntry ? "main-shell" : "welcome-shell"}>
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
              {data && !showEntry ? pageNames[page] : "螺蛳湾海外供货"}
            </span>
          </div>
          <div className="topbar-right">
            {result.workspaces.length > 0 && (
              <label className="workspace-switch">
                <span className="sr-only">切换运营空间</span>
                <select
                  value={workspace?.id || ""}
                  onChange={(e) => {
                    setShowEntry(false);
                    navigate("overview");
                    void load(e.target.value);
                  }}
                >
                  {result.workspaces.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <span className="account">
              <i>{displayName.slice(0, 1)}</i>
              <span>
                {data ? (ops ? "平台运营" : "供货商户") : "已登录"}
                <small>{displayName}</small>
              </span>
            </span>
          </div>
        </header>
        {data && !showEntry ? (
          <main className="main-content">
            <div className="page-heading">
              <div>
                <small>CATALOG FOUNDATION / M1</small>
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
                      open({ type: "offer" });
                    }}
                  >
                    <Plus size={16} />
                    新增供货报价
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
                <b>商户入驻邀请码</b>
                <p>
                  有效至{" "}
                  {new Date(result.invitationExpiresAt!).toLocaleString(
                    "zh-CN",
                  )}
                  ，新代码生效后旧代码失效。商户获得代码只能提交申请，仍需运营审核。
                </p>
                <div>
                  <input
                    aria-label="入驻邀请码"
                    readOnly
                    value={result.invitationCode}
                  />
                  <button
                    className="btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(
                          result.invitationCode!,
                        );
                        setToast("邀请码已复制");
                      } catch {
                        setToast("请选中邀请码手动复制");
                      }
                    }}
                  >
                    <Copy size={15} />
                    复制
                  </button>
                </div>
                <button
                  className="text-button"
                  onClick={() =>
                    setResult({ ...result, invitationCode: undefined })
                  }
                >
                  收起邀请码
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
                {!["overview", "detail"].includes(page) && (
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
              <span>螺蛳湾 · 海外供货平台</span>
              <button onClick={() => setShowEntry(true)}>
                申请加入其他空间
              </button>
              <span>自动匹配与对外报价将在后续里程碑开放</span>
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
            dialog.type === "merchant"
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
              {dialog.type === "merchant" && (
                <>
                  <p className="notice">
                    运营协助登记的商户暂未绑定登录账号，由运营维护供货资料。
                  </p>
                  <div className="form-grid">
                    <MerchantFields />
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
                    <Field label="品类">
                      <select name="category" defaultValue={skuEdit?.category}>
                        {categories.map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </Field>
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
                    <Field
                      label="商品图片链接"
                      wide
                      hint="本阶段可填写 HTTPS 图片地址，文件上传排在后续迭代。"
                    >
                      <input
                        type="url"
                        name="imageUrl"
                        defaultValue={skuEdit?.imageUrl}
                        placeholder="https://…"
                        maxLength={2000}
                      />
                    </Field>
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
                    <Field label="可供数量">
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
                    <Field label="国内交货地点" wide>
                      <input
                        name="deliveryLocation"
                        required
                        defaultValue={
                          offer?.deliveryLocation || "螺蛳湾商户档口交货"
                        }
                        maxLength={200}
                      />
                    </Field>
                    <Field label="报价有效至">
                      <input
                        name="validUntil"
                        type="date"
                        min={dateAfter(0)}
                        required
                        defaultValue={offer?.validUntil || dateAfter(7)}
                      />
                    </Field>
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
              <button type="button" className="btn" onClick={close}>
                取消
              </button>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? "保存中…" : "确认并保存"}
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

function MerchantFields() {
  return (
    <>
      <Field label="商户名称">
        <input name="name" required maxLength={200} />
      </Field>
      <Field label="联系人及联系方式">
        <input name="contact" required maxLength={200} />
      </Field>
      <Field label="档口 / 经营地址">
        <input name="location" required maxLength={200} />
      </Field>
      <Field label="主营品类">
        <input
          name="categories"
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
