import { z } from "zod";
import type { Access, CatalogState, CatalogView, Offer, Sku } from "./types";
import { deliveryIssue, deliveryLabel, QUANTITY_BASIS } from "./standards.ts";

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
    categoryTemplateId: required.optional(),
    attributes: z.record(required, required).optional(),
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
      .refine(
        (v) =>
          !v ||
          /^https:\/\//i.test(v) ||
          /^\/api\/catalog\/images\/[a-f0-9-]{36}\?workspaceId=[a-f0-9-]{36}$/.test(
            v,
          ),
        "请上传图片或填写 HTTPS 图片地址",
      )
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
    deliveryLocation: z.string().trim().min(1).max(300),
    deliveryPointId: required.optional(),
    validUntil: date,
    conditionsConfirmed: z.literal(true, {
      errorMap: () => ({ message: "请确认供货数量口径及供货条件" }),
    }),
    confirmationNote: z.string().trim().max(1000).optional(),
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
    members: [],
    accessInvitations: [],
    categoryTemplates: [],
    deliveryPoints: [],
  };
}

export function accessFor(state: CatalogState, userId: string): Access {
  if (state.ownerId === userId)
    return { role: "operations", merchantId: null, isOwner: true };
  const member = state.members?.find((m) => m.userId === userId);
  if (member) {
    ensure(member.status === "active", "你的运营权限已停用，请联系负责人", 403);
    return { role: "operations", merchantId: null, isOwner: false };
  }
  const merchant = state.merchants.find((m) => m.userId === userId);
  ensure(merchant, "你没有这个运营空间的访问权限", 403);
  return { role: "merchant", merchantId: merchant.id };
}

export function viewCatalog(state: CatalogState, userId: string): CatalogView {
  const access = accessFor(state, userId);
  const {
    ownerId: _owner,
    members = [],
    accessInvitations = [],
    ...data
  } = structuredClone(state);
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
  return {
    ...data,
    access,
    members:
      access.role === "operations" && access.isOwner
        ? members.map(({ userId: _user, ...member }) => member)
        : [],
    accessInvitations:
      access.role === "operations"
        ? accessInvitations
            .filter((i) => access.isOwner || i.kind === "claim")
            .map(
              ({ tokenHash: _hash, requestedBy: _requester, ...invitation }) =>
                invitation,
            )
        : [],
  };
}

export function offerAvailability(
  state: Pick<CatalogState, "merchants" | "skus" | "deliveryPoints">,
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
  if (offer.quantityBasis !== QUANTITY_BASIS) return "供货数量口径待确认";
  const locationIssue = deliveryIssue(state, offer);
  if (locationIssue) return locationIssue;
  const firstPack =
    Math.ceil(offer.minimumQuantity / offer.quantityStep) * offer.quantityStep;
  if (offer.availableQuantity < firstPack) return "可供量不足起订要求";
  return "可参与匹配";
}

export function appendEvent(
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
    !original.members?.some((m) => m.userId === userId),
    "运营账号不能同时绑定本空间商户",
  );
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
    case "createCategoryTemplate": {
      ensure(
        access.role === "operations" && access.isOwner,
        "只有管理员可以维护货盘标准",
        403,
      );
      const p = z
        .object({
          name: required,
          attributes: z.array(z.string().trim().min(1).max(40)).min(1).max(12),
        })
        .strict()
        .parse(payload);
      ensure(
        new Set(p.attributes.map(normalize)).size === p.attributes.length,
        "品类属性不能重复",
      );
      ensure(
        !p.attributes.some((a) =>
          ["__proto__", "constructor", "prototype"].includes(a),
        ),
        "属性名称不可用",
      );
      state.categoryTemplates ||= [];
      ensure(
        !state.categoryTemplates.some(
          (t) => normalize(t.name) === normalize(p.name),
        ),
        "品类模板名称已存在，请使用不同版本名称",
      );
      target = id("category");
      state.categoryTemplates.push({ ...p, id: target, active: true });
      label = "建立品类模板";
      detail = `${p.name}：${p.attributes.join("、")}`;
      break;
    }
    case "createDeliveryPoint": {
      ensure(
        access.role === "operations" && access.isOwner,
        "只有管理员可以维护货盘标准",
        403,
      );
      const p = z
        .object({ name: z.string().trim().min(1).max(60), address: required })
        .strict()
        .parse(payload);
      state.deliveryPoints ||= [];
      ensure(
        !state.deliveryPoints.some(
          (d) => normalize(d.name) === normalize(p.name),
        ),
        "交货点名称已存在",
      );
      target = id("delivery");
      state.deliveryPoints.push({ ...p, id: target, active: true });
      label = "建立标准交货点";
      detail = `${p.name} · ${p.address}`;
      break;
    }
    case "setStandardStatus": {
      ensure(
        access.role === "operations" && access.isOwner,
        "只有管理员可以维护货盘标准",
        403,
      );
      const p = z
        .object({
          kind: z.enum(["category", "delivery"]),
          id: required,
          active: z.boolean(),
        })
        .strict()
        .parse(payload);
      const entry = (
        p.kind === "category" ? state.categoryTemplates : state.deliveryPoints
      )?.find((e) => e.id === p.id);
      ensure(entry, "标准不存在", 404);
      entry.active = p.active;
      target = entry.id;
      label = p.active ? "启用货盘标准" : "停用货盘标准";
      detail = `${p.kind === "category" ? "品类" : "交货点"}：${entry.name}`;
      break;
    }
    case "updateSkuImage": {
      const p = z
        .object({ id: required, imageUrl: skuInput.shape.imageUrl })
        .strict()
        .parse(payload);
      const sku = state.skus.find((s) => s.id === p.id);
      ensure(sku, "SKU 不存在", 404);
      if (sku.status === "active") ops();
      else {
        approvedMerchant();
        ensure(
          access.role === "operations" || sku.submittedBy === userId,
          "不能修改其他商户商品图片",
          403,
        );
      }
      sku.imageUrl = p.imageUrl;
      target = sku.id;
      label = "更新商品图片";
      detail = sku.code;
      merchantId =
        state.merchants.find((m) => m.userId === sku.submittedBy)?.id || null;
      break;
    }
    case "updateMerchant": {
      const p = merchantInput.extend({ id: required }).strict().parse(payload);
      ensure(
        access.role === "operations" || access.merchantId === p.id,
        "不能修改其他商户资料",
        403,
      );
      const m = state.merchants.find((m) => m.id === p.id);
      ensure(m, "商户不存在", 404);
      ensure(
        !state.merchants.some(
          (m) => m.id !== p.id && normalize(m.name) === normalize(p.name),
        ),
        "商户名称已存在",
      );
      Object.assign(m, {
        name: p.name,
        contact: p.contact,
        location: p.location,
        categories: p.categories,
      });
      // Revised business identity requires a fresh review, including suspended merchants.
      m.status = "pending";
      m.reviewNote = "经营资料已更新，等待重新审核";
      target = m.id;
      merchantId = m.id;
      label = "修改商户资料";
      detail = `${m.name} · 重新提交准入审核`;
      break;
    }
    case "updateOfferTerms": {
      approvedMerchant();
      const p = z
        .object({
          id: required,
          expectedVersion: count,
          unitPrice: offerInput.shape.unitPrice.optional(),
          availableQuantity: offerInput.shape.availableQuantity.optional(),
          leadDays: offerInput.shape.leadDays.optional(),
          validUntil: date.optional(),
          conditionsConfirmed: z.boolean().optional(),
          confirmationNote: z.string().trim().max(1000).optional(),
        })
        .strict()
        .parse(payload);
      const o = state.offers.find((o) => o.id === p.id);
      ensure(o, "供货报价不存在", 404);
      ensure(
        access.role === "operations" || o.merchantId === access.merchantId,
        "不能维护其他商户的供货报价",
        403,
      );
      ensure(
        o.version === p.expectedVersion,
        "供货报价已更新，请刷新后再编辑",
        409,
      );
      ensure(
        o.status === "active",
        "未生效或已暂停的供货，请编辑完整资料后提交审核",
      );
      ensure(
        state.merchants.find((m) => m.id === o.merchantId)?.status === "active",
        "供货商户尚未准入",
      );
      ensure(
        state.skus.find((s) => s.id === o.skuId)?.status === "active",
        "SKU 未生效",
      );
      ensure(
        !deliveryIssue(state, o),
        deliveryIssue(state, o) || "交货点需核实",
      );
      if (p.availableQuantity !== undefined || p.validUntil !== undefined) {
        ensure(p.conditionsConfirmed === true, "请确认供货数量口径及供货条件");
      }
      const fields = [
        "unitPrice",
        "availableQuantity",
        "leadDays",
        "validUntil",
      ] as const;
      ensure(
        fields.some((f) => p[f] !== undefined),
        "请选择要更新的供货条件",
      );
      if (p.validUntil !== undefined) {
        ensure(
          p.conditionsConfirmed === true,
          "请确认价格、数量和交货条件仍然有效",
        );
        ensure(
          p.validUntil >= today(now) && p.validUntil > o.validUntil,
          "续期日期必须晚于原有效期且不早于今天",
        );
      }
      if (access.role === "operations")
        ensure(p.confirmationNote, "请记录与商户核实的依据");
      const changes: string[] = [];
      if (
        (p.availableQuantity !== undefined || p.validUntil !== undefined) &&
        o.quantityBasis !== QUANTITY_BASIS
      ) {
        o.quantityBasis = QUANTITY_BASIS;
        changes.push("已确认自由可供数量口径");
      }
      for (const field of fields) {
        const value = p[field];
        if (value !== undefined && value !== o[field]) {
          changes.push(`${field}：${o[field]} → ${value}`);
          Object.assign(o, { [field]: value });
        }
      }
      ensure(changes.length, "供货条件没有变化");
      o.version++;
      o.updatedAt = now.toISOString();
      target = o.id;
      merchantId = o.merchantId;
      label = p.validUntil ? "确认供货条件并续期" : "快捷维护供货";
      detail = `${changes.join("；")} · v${o.version}${p.confirmationNote ? ` · 核实依据：${p.confirmationNote}` : ""}`;
      break;
    }
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
      const templates = state.categoryTemplates || [];
      if (templates.length || p.categoryTemplateId) {
        const template = templates.find(
          (t) => t.id === p.categoryTemplateId && t.active,
        );
        ensure(template, "请选择启用的品类模板");
        ensure(p.category === template.name, "商品品类与模板不一致");
        ensure(
          p.attributes &&
            Object.keys(p.attributes).length === template.attributes.length &&
            template.attributes.every((a) => Object.hasOwn(p.attributes!, a)),
          "请完整填写模板中的全部属性，不可增加未定义属性",
        );
      } else
        ensure(!Object.keys(p.attributes || {}).length, "品类属性需要关联模板");
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
      const identity: unknown[] = [
        p.category,
        p.origin,
        p.model,
        p.material,
        p.specification,
        p.quality,
        p.unit,
        p.packaging,
      ].map(normalize);
      if (p.attributes && Object.keys(p.attributes).length)
        identity.push(
          Object.entries(p.attributes)
            .map(([k, v]) => [normalize(k), normalize(v)])
            .sort(([a], [b]) => a.localeCompare(b)),
        );
      const fingerprint = JSON.stringify(identity);
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
      if (
        p.status === "active" &&
        s.status !== "active" &&
        state.categoryTemplates?.length
      )
        ensure(
          state.categoryTemplates.some(
            (t) => t.id === s.categoryTemplateId && t.active,
          ),
          "请选择启用的品类模板并修改待审核商品后重提",
        );
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
      if (access.role === "operations")
        ensure(p.confirmationNote, "请记录与商户核实的依据");
      ensure(
        !deliveryIssue(state, p),
        deliveryIssue(state, p) || "请选择标准交货点",
      );
      const point = state.deliveryPoints?.find(
        (d) => d.id === p.deliveryPointId,
      );
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
      const {
        id: _id,
        expectedVersion: _version,
        conditionsConfirmed: _confirmed,
        confirmationNote,
        ...fields
      } = p;
      target = existing?.id || id("offer");
      merchantId = p.merchantId;
      const offer: Offer = {
        ...fields,
        deliveryLocation: point ? deliveryLabel(point) : p.deliveryLocation,
        quantityBasis: QUANTITY_BASIS,
        id: target,
        status: existing?.status === "active" ? "active" : "pending",
        version: (existing?.version || 0) + 1,
        reviewNote: existing?.reviewNote || "",
        updatedAt: now.toISOString(),
      };
      if (existing) Object.assign(existing, offer);
      else state.offers.push(offer);
      label = existing ? "更新供货条件" : "提交供货关联";
      detail = `${p.merchantCode} · v${offer.version} · ${p.unitPrice}分 · 自由可供${p.availableQuantity} · ${p.validUntil}到期 · 已确认供货口径${confirmationNote ? ` · 核实依据：${confirmationNote}` : ""}`;
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
      if (p.status === "active") {
        ensure(o.quantityBasis === QUANTITY_BASIS, "请先确认供货数量口径");
        ensure(
          !deliveryIssue(state, o),
          deliveryIssue(state, o) || "交货点需核实",
        );
      }
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
