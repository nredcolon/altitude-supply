import { z } from "zod";
import type { Access, CatalogState, CatalogView, Offer, Sku } from "./types";

export class CatalogError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}
export function ensure(
  condition: unknown,
  message: string,
  status = 400,
): asserts condition {
  if (!condition) throw new CatalogError(message, status);
}
const required = z.string().trim().min(1, "请填写必填项").max(200);
const note = z.string().trim().min(1, "请填写审核依据").max(1000);
const count = z.number().int().min(1).max(1_000_000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "日期无效",
  );
export const merchantInput = z
  .object({
    name: required,
    contact: required,
    location: required,
    categories: required,
  })
  .strict();
const skuInput = z
  .object({
    code: required.regex(
      /^[A-Za-z0-9][A-Za-z0-9_-]{1,59}$/,
      "编码使用 2–60 位字母、数字、横线或下划线",
    ),
    name: required,
    category: required,
    origin: required,
    model: required,
    material: required,
    specification: required,
    quality: required,
    unit: required,
    packaging: required,
    imageUrl: z
      .string()
      .max(2000)
      .refine((v) => !v || /^https:\/\//i.test(v), "图片链接须为 HTTPS 地址")
      .default(""),
  })
  .strict();
const offerInput = z
  .object({
    id: z.string().optional(),
    expectedVersion: z.number().int().min(1).optional(),
    skuId: required,
    merchantId: required,
    merchantCode: required,
    unitPrice: z.number().int().min(1).max(100_000_000),
    availableQuantity: z.number().int().min(0).max(1_000_000),
    minimumQuantity: count,
    quantityStep: count,
    leadDays: z.number().int().min(0).max(365),
    deliveryLocation: required,
    validUntil: date,
  })
  .strict();
const normalize = (s: string) =>
  s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
export const today = (now = new Date()) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Shanghai" }).format(now);

export function emptyCatalog(
  ownerId: string,
  priceBasis: string,
): CatalogState {
  return {
    schemaVersion: 1,
    ownerId,
    priceBasis,
    merchants: [],
    skus: [],
    offers: [],
    events: [],
  };
}

export function accessFor(state: CatalogState, userId: string): Access {
  if (state.ownerId === userId) return { role: "operations", merchantId: null };
  const merchant = state.merchants.find((m) => m.userId === userId);
  ensure(merchant, "你没有这个运营空间的访问权限", 403);
  return { role: "merchant", merchantId: merchant.id };
}

export function viewCatalog(state: CatalogState, userId: string): CatalogView {
  const access = accessFor(state, userId);
  const { ownerId: _owner, ...data } = structuredClone(state);
  if (access.role === "merchant") {
    data.merchants = data.merchants.filter((m) => m.id === access.merchantId);
    data.skus = data.skus.filter(
      (s) => s.status === "active" || s.submittedBy === userId,
    );
    data.offers = data.offers.filter((o) => o.merchantId === access.merchantId);
    data.events = data.events.filter((e) => e.merchantId === access.merchantId);
  }
  // Login identifiers are never included in a catalog response.
  data.merchants = data.merchants.map((m) => ({
    ...m,
    userId: m.userId ? "[已绑定]" : null,
  }));
  data.skus = data.skus.map((s) => ({
    ...s,
    submittedBy: s.submittedBy === userId ? "me" : "platform",
  }));
  data.events = data.events.map((e) => ({
    ...e,
    actorId: e.actorId === userId ? "me" : "platform",
  }));
  return { ...data, access };
}

export function offerAvailability(
  state: Pick<CatalogState, "merchants" | "skus">,
  offer: Offer,
  now = new Date(),
) {
  if (
    state.merchants.find((m) => m.id === offer.merchantId)?.status !== "active"
  )
    return "商户未准入或已暂停";
  if (state.skus.find((s) => s.id === offer.skuId)?.status !== "active")
    return "SKU 未通过审核";
  if (offer.status !== "active")
    return (
      {
        pending: "供货关联待审核",
        paused: "商户已下架",
        rejected: "供货关联需修改",
      } as const
    )[offer.status];
  if (offer.validUntil < today(now)) return "报价已过期";
  const firstPack =
    Math.ceil(offer.minimumQuantity / offer.quantityStep) * offer.quantityStep;
  if (offer.availableQuantity < firstPack) return "可供量不足起订要求";
  return "可参与匹配";
}

function appendEvent(
  state: CatalogState,
  actorId: string,
  merchantId: string | null,
  action: string,
  targetId: string,
  detail: string,
  now: Date,
) {
  state.events.unshift({
    id: id("event"),
    actorId,
    merchantId,
    action,
    targetId,
    detail,
    at: now.toISOString(),
  });
}

export function applyApplication(
  original: CatalogState,
  userId: string,
  payload: unknown,
  now = new Date(),
): CatalogState {
  ensure(original.ownerId !== userId, "运营账号无需申请成为本空间商户");
  ensure(
    !original.merchants.some((m) => m.userId === userId),
    "你已提交入驻申请",
  );
  const p = merchantInput.parse(payload);
  ensure(
    !original.merchants.some((m) => normalize(m.name) === normalize(p.name)),
    "商户名称已登记，请联系运营核实账号绑定",
  );
  const state = structuredClone(original);
  const merchant = {
    ...p,
    id: id("merchant"),
    userId,
    status: "pending" as const,
    reviewNote: "",
    createdAt: now.toISOString(),
  };
  state.merchants.push(merchant);
  appendEvent(
    state,
    userId,
    merchant.id,
    "申请入驻",
    merchant.id,
    merchant.name,
    now,
  );
  return state;
}

/** The trusted user ID comes from server identity, never from a submitted role. */
export function applyCatalogCommand(
  original: CatalogState,
  userId: string,
  action: string,
  payload: unknown,
  now = new Date(),
): CatalogState {
  const access = accessFor(original, userId);
  const state = structuredClone(original);
  const ops = () =>
    ensure(access.role === "operations", "只有运营可以执行此操作", 403);
  const approvedMerchant = () => {
    if (access.role === "merchant")
      ensure(
        state.merchants.find((m) => m.id === access.merchantId)?.status ===
          "active",
        "请先完成商户准入审核",
        403,
      );
  };
  let target = "";
  let merchantId = access.merchantId;
  let detail = "";
  let label = "";
  switch (action) {
    case "registerMerchant": {
      ops();
      const p = merchantInput.parse(payload);
      ensure(
        !state.merchants.some((m) => normalize(m.name) === normalize(p.name)),
        "商户名称已存在",
      );
      target = id("merchant");
      merchantId = target;
      state.merchants.push({
        ...p,
        id: target,
        userId: null,
        status: "pending",
        reviewNote: "",
        createdAt: now.toISOString(),
      });
      label = "运营登记商户";
      detail = p.name;
      break;
    }
    case "reviewMerchant": {
      ops();
      const p = z
        .object({ id: required, status: z.enum(["active", "suspended"]), note })
        .strict()
        .parse(payload);
      const m = state.merchants.find((m) => m.id === p.id);
      ensure(m, "商户不存在", 404);
      m.status = p.status;
      m.reviewNote = p.note;
      target = m.id;
      merchantId = m.id;
      label = p.status === "active" ? "商户准入" : "暂停商户供货";
      detail = p.note;
      break;
    }
    case "submitSku":
    case "updateSku": {
      approvedMerchant();
      const parsed = skuInput
        .extend({ id: z.string().optional() })
        .strict()
        .parse(payload);
      const { id: updateId, ...p } = parsed;
      const existing =
        action === "updateSku"
          ? state.skus.find((s) => s.id === updateId)
          : undefined;
      if (action === "updateSku") {
        ensure(existing, "SKU 不存在", 404);
        ensure(
          access.role === "operations" || existing.submittedBy === userId,
          "不能修改其他商户提交的 SKU",
          403,
        );
        ensure(
          existing.status !== "active",
          "已生效商品身份不能修改，请建立新的 SKU",
        );
      }
      const code = p.code.toUpperCase();
      ensure(
        !state.skus.some((s) => s.id !== existing?.id && s.code === code),
        "SKU 编码已存在，请关联已有 SKU",
      );
      const fingerprint = JSON.stringify(
        [
          p.category,
          p.origin,
          p.model,
          p.material,
          p.specification,
          p.quality,
          p.unit,
          p.packaging,
        ].map(normalize),
      );
      ensure(
        !state.skus.some(
          (s) =>
            s.id !== existing?.id &&
            s.fingerprint === fingerprint &&
            s.status !== "rejected",
        ),
        "相同商品身份已建档，请使用已有 SKU",
      );
      target = existing?.id || id("sku");
      if (existing)
        Object.assign(existing, p, {
          code,
          fingerprint,
          status: "pending",
          reviewNote: "",
        });
      else
        state.skus.push({
          ...p,
          code,
          fingerprint,
          id: target,
          status: "pending",
          submittedBy: userId,
          reviewNote: "",
          createdAt: now.toISOString(),
        });
      label = existing ? "修改 SKU 并重新提交" : "提交标准 SKU";
      detail = `${code} ${p.name}`;
      break;
    }
    case "reviewSku": {
      ops();
      const p = z
        .object({ id: required, status: z.enum(["active", "rejected"]), note })
        .strict()
        .parse(payload);
      const s = state.skus.find((s) => s.id === p.id);
      ensure(s, "SKU 不存在", 404);
      if (p.status === "active")
        ensure(
          !state.skus.some(
            (x) =>
              x.id !== s.id &&
              x.status === "active" &&
              x.fingerprint === s.fingerprint,
          ),
          "已有相同商品身份的生效 SKU",
        );
      if (s.status === "active")
        ensure(
          p.status === "active",
          "已生效 SKU 不可改为驳回，请保留历史商品身份",
        );
      s.status = p.status;
      s.reviewNote = p.note;
      target = s.id;
      merchantId =
        state.merchants.find((m) => m.userId === s.submittedBy)?.id || null;
      label = "审核标准 SKU";
      detail = `${s.code}：${p.note}`;
      break;
    }
    case "saveOffer": {
      approvedMerchant();
      const p = offerInput.parse(payload);
      ensure(
        access.role === "operations" || p.merchantId === access.merchantId,
        "不能维护其他商户的供货报价",
        403,
      );
      ensure(
        state.merchants.find((m) => m.id === p.merchantId)?.status === "active",
        "供货商户尚未准入",
      );
      ensure(
        state.skus.find((s) => s.id === p.skuId)?.status === "active",
        "请选择审核通过的 SKU",
      );
      ensure(p.validUntil >= today(now), "报价有效期不能早于今天");
      const existing = p.id
        ? state.offers.find((o) => o.id === p.id)
        : undefined;
      if (p.id) {
        ensure(
          existing &&
            existing.merchantId === p.merchantId &&
            existing.skuId === p.skuId,
          "供货报价不存在或关联关系不可修改",
          404,
        );
        ensure(
          existing.version === p.expectedVersion,
          "供货报价已更新，请刷新后再编辑",
          409,
        );
      } else {
        ensure(
          !state.offers.some(
            (o) => o.skuId === p.skuId && o.merchantId === p.merchantId,
          ),
          "该商户已为此 SKU 建立报价，请编辑原报价",
        );
      }
      const { id: _id, expectedVersion: _version, ...fields } = p;
      target = existing?.id || id("offer");
      merchantId = p.merchantId;
      const offer: Offer = {
        ...fields,
        id: target,
        status: existing?.status === "active" ? "active" : "pending",
        version: (existing?.version || 0) + 1,
        reviewNote: existing?.reviewNote || "",
        updatedAt: now.toISOString(),
      };
      if (existing) Object.assign(existing, offer);
      else state.offers.push(offer);
      label = existing ? "更新供货条件" : "提交供货关联";
      detail = `${p.merchantCode} · v${offer.version} · ${p.unitPrice}分 · 可供${p.availableQuantity} · ${p.validUntil}到期`;
      break;
    }
    case "reviewOffer": {
      ops();
      const p = z
        .object({
          id: required,
          status: z.enum(["active", "rejected"]),
          note,
          expectedVersion: count,
        })
        .strict()
        .parse(payload);
      const o = state.offers.find((o) => o.id === p.id);
      ensure(o, "供货报价不存在", 404);
      ensure(
        o.version === p.expectedVersion,
        "商户已更新供货条件，请刷新后重新审核",
        409,
      );
      ensure(
        state.merchants.find((m) => m.id === o.merchantId)?.status === "active",
        "请先审核商户",
      );
      ensure(
        state.skus.find((s) => s.id === o.skuId)?.status === "active",
        "SKU 未生效",
      );
      ensure(
        p.status !== "active" || o.validUntil >= today(now),
        "报价已过期，请先更新",
      );
      o.status = p.status;
      o.reviewNote = p.note;
      o.version++;
      o.updatedAt = now.toISOString();
      target = o.id;
      merchantId = o.merchantId;
      label = "审核供货关联";
      detail = p.note;
      break;
    }
    case "pauseOffer": {
      const p = z
        .object({ id: required, expectedVersion: count })
        .strict()
        .parse(payload);
      const o = state.offers.find((o) => o.id === p.id);
      ensure(o, "供货报价不存在", 404);
      ensure(
        access.role === "operations" || o.merchantId === access.merchantId,
        "不能下架其他商户报价",
        403,
      );
      ensure(o.version === p.expectedVersion, "供货报价已更新，请刷新", 409);
      o.status = "paused";
      o.version++;
      o.updatedAt = now.toISOString();
      target = o.id;
      merchantId = o.merchantId;
      label = "下架供货报价";
      detail = "停止参与匹配";
      break;
    }
    default:
      throw new CatalogError("不支持的操作");
  }
  appendEvent(state, userId, merchantId, label, target, detail, now);
  return state;
}
