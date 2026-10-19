"use client";

import { useState, type FormEvent } from "react";
import type {
  CatalogView,
  CategoryTemplate,
  Sku,
} from "../../lib/catalog/types";
import {
  deliveryLabel,
  QUANTITY_EXPLANATION,
} from "../../lib/catalog/standards";
import { Field } from "./primitives";

export function SkuCategoryFields({
  templates,
  sku,
}: {
  templates: CategoryTemplate[];
  sku?: Sku;
}) {
  const [templateId, setTemplateId] = useState(sku?.categoryTemplateId || "");
  const selected = templates.find((t) => t.id === templateId);
  if (!templates.length)
    return (
      <Field
        label="品类"
        hint="管理员尚未配置品类模板。当前沿用通用字段，试用前需核实品类标准。"
      >
        <input
          name="category"
          required
          maxLength={200}
          defaultValue={sku?.category}
        />
      </Field>
    );
  return (
    <>
      <Field
        label="品类模板"
        hint="模板属性全部必填；不同颜色、尺寸等规格分别建立 SKU。"
      >
        <select
          name="categoryTemplateId"
          required
          value={templateId}
          onChange={(e) => setTemplateId(e.target.value)}
        >
          <option value="">请选择品类模板</option>
          {templates
            .filter((t) => t.active || t.id === templateId)
            .map((t) => (
              <option key={t.id} value={t.id} disabled={!t.active}>
                {t.name}
                {!t.active ? "（已停用，请重新选择）" : ""}
              </option>
            ))}
        </select>
        <input type="hidden" name="category" value={selected?.name || ""} />
      </Field>
      {selected?.attributes.map((label, index) => (
        <Field key={`${selected.id}-${index}`} label={label}>
          <input
            name={`attribute-${index}`}
            required
            maxLength={200}
            defaultValue={
              selected.id === sku?.categoryTemplateId
                ? sku?.attributes?.[label]
                : ""
            }
          />
        </Field>
      ))}
    </>
  );
}

export function StandardsSettings({
  data,
  busy,
  command,
}: {
  data: CatalogView;
  busy: boolean;
  command: (action: string, payload: unknown) => Promise<boolean>;
}) {
  const admin = data.access.role === "operations" && data.access.isOwner;
  const templates = data.categoryTemplates || [];
  const points = data.deliveryPoints || [];
  async function create(
    e: FormEvent<HTMLFormElement>,
    kind: "category" | "delivery",
  ) {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const values = new FormData(form);
    const name = String(values.get("name") || "").trim();
    const payload =
      kind === "category"
        ? {
            name,
            attributes: String(values.get("attributes") || "")
              .split(/\r?\n/)
              .map((s) => s.trim())
              .filter(Boolean),
          }
        : { name, address: String(values.get("address") || "").trim() };
    if (
      await command(
        kind === "category" ? "createCategoryTemplate" : "createDeliveryPoint",
        payload,
      )
    )
      form.reset();
  }
  return (
    <div className="standards-settings">
      <p className="notice">
        先核实首批真实品类和交货地址，再建立标准。模板与地址创建后保留原定义；需要变更时停用旧项并新建，已有记录可追溯。
      </p>
      <section className="panel">
        <div className="panel-heading">
          <h2>品类模板</h2>
          <span>{templates.filter((t) => t.active).length} 个启用</span>
        </div>
        <p className="note">
          品牌、型号、材质、质量、单位和包装沿用公共字段。这里补充该品类必须核对的属性，例如容量、颜色、尺寸。模板停用后不能用于新建或审核商品，已生效
          SKU 的身份保持不变。
        </p>
        {!templates.length && <p className="muted">尚未配置品类模板。</p>}
        {templates.map((t) => (
          <article className="standard-row" key={t.id}>
            <div>
              <strong>{t.name}</strong>
              <p>{t.attributes.join(" · ")}</p>
              <small>
                {data.skus.filter((s) => s.categoryTemplateId === t.id).length}{" "}
                个 SKU 已关联 · {t.active ? "启用中" : "已停用"}
              </small>
            </div>
            {admin && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  command("setStandardStatus", {
                    kind: "category",
                    id: t.id,
                    active: !t.active,
                  })
                }
              >
                {t.active ? "停用模板" : "启用模板"}
              </button>
            )}
          </article>
        ))}
        {!!data.skus.filter((s) => !s.categoryTemplateId).length && (
          <p className="note">
            {data.skus.filter((s) => !s.categoryTemplateId).length} 个历史 SKU
            使用通用字段，需逐项核实。已生效商品身份不可直接改写；不同规格应新建
            SKU。
          </p>
        )}
        {admin && (
          <form
            className="standard-form"
            onSubmit={(e) => create(e, "category")}
          >
            <Field label="品类模板名称">
              <input
                name="name"
                required
                maxLength={200}
                placeholder="填写经核实的品类名称"
              />
            </Field>
            <Field
              label="必填属性，每行一项"
              hint="最多 12 项；避免重复填写公共字段。"
            >
              <textarea
                name="attributes"
                required
                rows={4}
                maxLength={600}
                placeholder={"例如：容量\n颜色"}
              />
            </Field>
            <button className="btn primary" disabled={busy}>
              建立品类模板
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <div className="panel-heading">
          <h2>标准国内交货点</h2>
          <span>{points.filter((p) => p.active).length} 个启用</span>
        </div>
        <p className="note">
          建立首个交货点后，供货须选择启用的标准地点。历史自由填写的地址需重新选择；停用地点会使关联供货退出有效货源。地址不对外公开。
        </p>
        {!points.length && (
          <p className="muted">
            尚未配置标准交货点，当前沿用原有地址。试用前需核实。
          </p>
        )}
        {points.map((p) => (
          <article className="standard-row" key={p.id}>
            <div>
              <strong>{p.name}</strong>
              <p>{p.address}</p>
              <small>
                {data.offers.filter((o) => o.deliveryPointId === p.id).length}{" "}
                份供货关联 · {p.active ? "启用中" : "已停用"}
              </small>
            </div>
            {admin && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  command("setStandardStatus", {
                    kind: "delivery",
                    id: p.id,
                    active: !p.active,
                  })
                }
              >
                {p.active ? "停用交货点" : "启用交货点"}
              </button>
            )}
          </article>
        ))}
        {admin && (
          <form
            className="standard-form"
            onSubmit={(e) => create(e, "delivery")}
          >
            <Field label="交货点名称">
              <input name="name" required maxLength={60} />
            </Field>
            <Field label="完整交货地址">
              <textarea name="address" required maxLength={200} rows={2} />
            </Field>
            <button className="btn primary" disabled={busy}>
              建立交货点
            </button>
          </form>
        )}
      </section>
      <section className="panel">
        <h2>统一供货口径</h2>
        <p>{QUANTITY_EXPLANATION}</p>
        <p className="note">
          价格口径：{data.priceBasis}
          。原有供货须由商户确认数量或核实全部条件后续期；运营代录必须记录核实依据。
        </p>
      </section>
      {!admin && (
        <p className="note">当前为只读查看，货盘标准由平台管理员维护。</p>
      )}
    </div>
  );
}

export function DeliveryPointField({
  data,
  offer,
}: {
  data: CatalogView;
  offer?: import("../../lib/catalog/types").Offer;
}) {
  const points = data.deliveryPoints || [];
  if (!points.length)
    return (
      <Field
        label="国内交货地点"
        wide
        hint="尚未配置标准交货点，请填写实际可执行的交货地址。"
      >
        <input
          name="deliveryLocation"
          required
          maxLength={200}
          defaultValue={offer?.deliveryLocation || ""}
        />
      </Field>
    );
  return (
    <Field
      label="标准国内交货点"
      wide
      hint="只可选择当前启用的交货点；变更地址请联系平台管理员。"
    >
      <select
        name="deliveryPointId"
        required
        defaultValue={
          points.some((p) => p.id === offer?.deliveryPointId && p.active)
            ? offer?.deliveryPointId
            : ""
        }
      >
        <option value="">请选择标准交货点</option>
        {points
          .filter((p) => p.active)
          .map((p) => (
            <option key={p.id} value={p.id}>
              {deliveryLabel(p)}
            </option>
          ))}
      </select>
      {offer && <small>原记录：{offer.deliveryLocation}</small>}
    </Field>
  );
}
