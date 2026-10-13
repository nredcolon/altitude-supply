import { z } from 'zod';
import type { Actor, SupplyState, Order, Role } from './types';

export class BusinessError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }
const text = z.string().trim().min(1, '请填写必填内容').max(2000);
const short = text.max(160);
const quantity = z.number().int().min(1).max(1000000);
const amount = z.number().int().min(0).max(10000000000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式无效').refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, '日期无效');
const uid = (prefix: string) => `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
function requireThat(condition: unknown, message: string): asserts condition { if (!condition) throw new BusinessError(message); }
const partiesSchema = z.object({ purchaser: short, exporter: short, importer: short, payee: short, delivery: text, settlement: text });
const productSchema = z.object({ supplierId: short, name: short, category: short, spec: short, unit: short, price: amount.min(1), moq: quantity, stock: amount.max(1000000), leadDays: quantity.max(365), note: z.string().max(2000).default(''), artwork: z.enum(['basket', 'towel', 'bag', 'bottle', 'pillow', 'organizer']).default('basket') });

export function validateActor(state: SupplyState, actor: Actor) {
  if (!['operations', 'supplier', 'buyer'].includes(actor.role)) throw new BusinessError('无效的操作视角', 403);
  if (actor.role === 'supplier' && !state.suppliers.some(s => s.id === actor.entityId)) throw new BusinessError('商户不存在', 403);
  if (actor.role === 'buyer' && !state.buyers.some(b => b.id === actor.entityId)) throw new BusinessError('采购方不存在', 403);
}
function permit(actor: Actor, roles: Role[]) { if (!roles.includes(actor.role)) throw new BusinessError('当前身份不能执行此操作', 403); }
export function canAccessOrder(actor: Actor, order: Order) { return actor.role === 'operations' || (actor.role === 'buyer' ? order.buyerId === actor.entityId : order.lines.some(l => l.supplierId === actor.entityId)); }
export function supplierDue(order: Order, supplierId: string) { return order.lines.filter(l => l.supplierId === supplierId).reduce((sum, l) => sum + (l.unitCost ?? l.unitPrice) * l.quantity, 0); }
export function supplierPaid(state: SupplyState, orderId: string, supplierId: string) { return state.settlements.filter(s => s.orderId === orderId && s.supplierId === supplierId).reduce((sum, s) => sum + s.amount, 0); }
export function outstanding(state: SupplyState, order: Order, supplierId: string) { return supplierDue(order, supplierId) - supplierPaid(state, order.id, supplierId); }

export function applyCommand(original: SupplyState, actor: Actor, action: string, payload: unknown, now = new Date()): SupplyState {
  const state = structuredClone(original); validateActor(state, actor);
  const stamp = now.toISOString(); let targetId = ''; let detail = ''; let label = action;
  const getOrder = (id: string) => { const o = state.orders.find(o => o.id === id); if (!o || !canAccessOrder(actor, o)) throw new BusinessError('订单不存在或不可访问', 404); targetId = id; return o; };
  const unblocked = (o: Order) => requireThat(!state.issues.some(i => i.orderId === o.id && i.blocking && i.status === '待处理'), '请先处理阻断订单的异常');
  switch (action) {
    case 'createSupplier': {
      permit(actor, ['operations']);
      const p = z.object({ name: short, category: short, contact: short, location: short, note: z.string().max(2000).default('') }).parse(payload);
      targetId = uid('SUP'); state.suppliers.unshift({ ...p, id: targetId, status: '待审核' }); label = '登记商户'; detail = p.name; break;
    }
    case 'approveSupplier': {
      permit(actor, ['operations']); const p = z.object({ id: short, note: text }).parse(payload); const s = state.suppliers.find(s => s.id === p.id);
      requireThat(s, '商户不存在'); requireThat(s.status !== '已准入', '商户已完成审核'); s.status = '已准入'; s.note = p.note; targetId = s.id; label = '商户准入'; detail = p.note; break;
    }
    case 'createProduct': case 'updateProduct': {
      permit(actor, ['operations', 'supplier']); const p = productSchema.extend({ id: z.string().optional() }).parse(payload);
      requireThat(actor.role === 'operations' || p.supplierId === actor.entityId, '不能提交其他商户的商品');
      requireThat(state.suppliers.some(s => s.id === p.supplierId), '供货商户不存在');
      if (action === 'updateProduct') {
        const product = state.products.find(x => x.id === p.id); requireThat(product && product.supplierId === p.supplierId, '商品不存在或不属于该商户');
        Object.assign(product, p, { status: '待审核', updatedAt: stamp }); targetId = product.id; label = '更新商品并提交审核';
      } else { targetId = uid('SKU'); state.products.unshift({ ...p, id: targetId, status: '待审核', updatedAt: stamp }); label = '提交新商品'; }
      detail = p.name; break;
    }
    case 'reviewProduct': {
      permit(actor, ['operations']); const p = z.object({ id: short, result: z.enum(['可供货', '待补充']), note: text }).parse(payload);
      const product = state.products.find(x => x.id === p.id); requireThat(product, '商品不存在');
      if (p.result === '可供货') requireThat(state.suppliers.find(s => s.id === product.supplierId)?.status === '已准入', '请先完成该商户的准入审核');
      product.status = p.result; product.note = p.note; product.updatedAt = stamp; targetId = product.id; label = '审核商品'; detail = `${p.result}：${p.note}`; break;
    }
    case 'createDemand': {
      permit(actor, ['operations', 'buyer']); const p = z.object({ buyerId: short, title: short, category: short, quantity, budget: amount, destination: short, dueDate: date, requirements: text }).parse(payload);
      requireThat(actor.role === 'operations' || p.buyerId === actor.entityId, '不能代其他采购方提交需求');
      requireThat(state.buyers.some(b => b.id === p.buyerId), '采购方不存在'); requireThat(p.dueDate >= stamp.slice(0, 10), '到货日期不能早于今天');
      targetId = uid('RFQ'); state.demands.unshift({ ...p, id: targetId, status: '待报价', createdAt: stamp }); label = '发布采购需求'; detail = p.title; break;
    }
    case 'createQuote': {
      permit(actor, ['operations']); const p = z.object({ demandId: short, lines: z.array(z.object({ productId: short, quantity, unitPrice: amount.min(1) })).min(1).max(30), shipping: amount, tax: amount, validUntil: date, parties: partiesSchema, notes: text }).parse(payload);
      const demand = state.demands.find(d => d.id === p.demandId); requireThat(demand && demand.status !== '已成交', '需求不存在或已成交');
      requireThat(p.validUntil >= stamp.slice(0, 10), '报价已过有效期'); requireThat(new Set(p.lines.map(l => l.productId)).size === p.lines.length, '请合并同一商品的数量');
      const lines = p.lines.map(l => { const product = state.products.find(x => x.id === l.productId); requireThat(product?.status === '可供货', '报价只能使用审核通过的商品'); requireThat(state.suppliers.find(s => s.id === product.supplierId)?.status === '已准入', '商户未准入'); requireThat(l.quantity >= product.moq && l.quantity <= product.stock, `${product.name} 数量不符合起订量或库存`); return { productId: product.id, supplierId: product.supplierId, name: product.name, spec: product.spec, unit: product.unit, artwork: product.artwork, quantity: l.quantity, unitPrice: l.unitPrice, unitCost: product.price }; });
      const total = lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, p.shipping + p.tax); requireThat(Number.isSafeInteger(total) && total <= 10000000000, '报价总金额超过允许范围');
      targetId = uid('QT'); state.quotes.unshift({ ...p, id: targetId, buyerId: demand.buyerId, lines, total, status: '待确认', createdAt: stamp }); demand.status = '已报价'; label = '形成正式报价'; detail = demand.title; break;
    }
    case 'acceptQuote': {
      permit(actor, ['operations', 'buyer']); const p = z.object({ id: short }).parse(payload); const q = state.quotes.find(q => q.id === p.id);
      requireThat(q && (actor.role === 'operations' || q.buyerId === actor.entityId), '报价不存在或不可访问'); requireThat(q.status === '待确认', '该报价已转为订单'); requireThat(q.validUntil >= stamp.slice(0, 10), '报价已过期，请联系运营重新报价');
      const d = state.demands.find(d => d.id === q.demandId)!; requireThat(d.status !== '已成交', '该需求已有成交订单');
      q.lines.forEach(l => { const p = state.products.find(p => p.id === l.productId); requireThat(p?.status === '可供货' && p.price === l.unitCost && p.spec === l.spec, '商品条件已变化，请重新报价'); requireThat(p.stock >= l.quantity, `${l.name} 可用库存不足，请重新报价`); p.stock -= l.quantity; });
      targetId = uid('SO'); state.orders.unshift({ id: targetId, quoteId: q.id, demandId: d.id, buyerId: q.buyerId, lines: structuredClone(q.lines), total: q.total, shipping: q.shipping, tax: q.tax, destination: d.destination, dueDate: d.dueDate, status: '待确认', confirmedSuppliers: [], deliveredSuppliers: [], payment: '待核实', paymentRef: '', logistics: '待集货', customs: '待补资料', customsRef: '', taxStatus: '待归档', taxRef: '', inspection: '待验货', carrier: '', waybill: '', receiptRef: '', eta: '', parties: q.parties, createdAt: stamp }); q.status = '已接受'; d.status = '已成交'; label = '确认报价并建立订单'; detail = q.id; break;
    }
    case 'confirmSupply': {
      permit(actor, ['operations', 'supplier']); const p = z.object({ id: short, supplierId: short }).parse(payload); const o = getOrder(p.id);
      requireThat(o.status === '待确认', '订单不在待确认阶段'); requireThat(actor.role === 'operations' || p.supplierId === actor.entityId, '不能代其他商户确认'); requireThat(o.lines.some(l => l.supplierId === p.supplierId), '该商户不在此订单内'); requireThat(!o.confirmedSuppliers.includes(p.supplierId), '该商户已确认'); o.confirmedSuppliers.push(p.supplierId); if (o.lines.every(l => o.confirmedSuppliers.includes(l.supplierId))) o.status = '待启动'; label = '确认供货条件'; detail = p.supplierId; break;
    }
    case 'verifyPayment': {
      permit(actor, ['operations']); const p = z.object({ id: short, reference: text, amount }).parse(payload); const o = getOrder(p.id); requireThat(o.payment === '待核实', '款项已登记核实'); requireThat(p.amount === o.total, '首版要求足额收款，金额须与订单应付一致'); o.payment = '已核实'; o.paymentRef = p.reference; label = '登记收款核验'; detail = p.reference; break;
    }
    case 'startSupply': {
      permit(actor, ['operations']); const p = z.object({ id: short }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '待启动', '请先取得所有供货商确认'); requireThat(o.payment === '已核实', '尚未满足付款条件，不能启动供货'); unblocked(o); o.status = '备货中'; label = '启动供货'; break;
    }
    case 'warehouseDelivery': {
      permit(actor, ['operations', 'supplier']); const p = z.object({ id: short, supplierId: short, reference: text }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '备货中', '订单不在备货阶段'); requireThat(actor.role === 'operations' || p.supplierId === actor.entityId, '不能代其他商户交货'); requireThat(o.lines.some(l => l.supplierId === p.supplierId), '该商户不在此订单内'); requireThat(!o.deliveredSuppliers.includes(p.supplierId), '该商户已登记交货'); o.deliveredSuppliers.push(p.supplierId); if (o.lines.every(l => o.deliveredSuppliers.includes(l.supplierId))) { o.status = '待验货'; o.logistics = '已集货'; } label = '登记国内交货'; detail = p.reference; break;
    }
    case 'inspect': {
      permit(actor, ['operations']); const p = z.object({ id: short, result: z.enum(['通过', '差异']), quantity, reference: text }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '待验货', '订单不在验货阶段');
      if (p.result === '通过') { unblocked(o); requireThat(p.quantity === o.lines.reduce((sum, l) => sum + l.quantity, 0), '实收数量与订单不一致，请登记验货差异'); o.inspection = '已通过'; o.status = '待发运'; }
      else { o.inspection = '存在差异'; state.issues.unshift({ id: uid('ISS'), orderId: o.id, title: '到仓验货差异', detail: p.reference, category: '验货差异', blocking: true, status: '待处理', resolution: '', createdBy: actor, createdAt: stamp }); }
      label = `登记验货${p.result}`; detail = p.reference; break;
    }
    case 'recordCustoms': case 'archiveTax': {
      permit(actor, ['operations']); const p = z.object({ id: short, reference: text }).parse(payload); const o = getOrder(p.id); requireThat(o.status !== '已关闭', '订单已关闭'); if (action === 'recordCustoms') { o.customs = '已放行'; o.customsRef = p.reference; label = '登记通关放行'; } else { o.taxStatus = '已归档'; o.taxRef = p.reference; label = '登记税务资料归档'; } detail = p.reference; break;
    }
    case 'dispatch': {
      permit(actor, ['operations']); const p = z.object({ id: short, carrier: short, waybill: short, eta: date }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '待发运' && o.inspection === '已通过', '请先完成到仓验货'); requireThat(o.customs === '已放行', '请先核实并登记通关放行资料'); requireThat(o.payment === '已核实', '付款条件未满足'); requireThat(p.eta >= stamp.slice(0, 10), '预计到达不能早于今天'); unblocked(o); Object.assign(o, { carrier: p.carrier, waybill: p.waybill, eta: p.eta, status: '运输中', logistics: '运输中' }); label = '登记跨境发运'; detail = `${p.carrier} · ${p.waybill}`; break;
    }
    case 'receive': {
      permit(actor, ['operations', 'buyer']); const p = z.object({ id: short, reference: text }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '运输中', '订单尚未发运或已经签收'); unblocked(o); o.status = '已交付'; o.logistics = '已签收'; o.receiptRef = p.reference; label = '确认海外签收'; detail = p.reference; break;
    }
    case 'settle': {
      permit(actor, ['operations']); const p = z.object({ id: short, supplierId: short, amount: amount.min(1), reference: text, paidAt: date }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '已交付', '订单完成交付后才能登记结算'); unblocked(o); requireThat(p.paidAt <= stamp.slice(0, 10), '付款记录不能使用未来日期'); requireThat(o.lines.some(l => l.supplierId === p.supplierId), '供货商户不在该订单内'); requireThat(p.amount <= outstanding(state, o, p.supplierId), '结算金额超过商户未结余额'); requireThat(!state.settlements.some(s => s.reference === p.reference && s.orderId === o.id && s.supplierId === p.supplierId), '该付款凭证已登记'); state.settlements.unshift({ id: uid('SET'), orderId: o.id, supplierId: p.supplierId, amount: p.amount, reference: p.reference, paidAt: p.paidAt, fee: 0 }); label = '登记商户结算'; detail = p.reference; break;
    }
    case 'closeOrder': {
      permit(actor, ['operations']); const p = z.object({ id: short }).parse(payload); const o = getOrder(p.id); requireThat(o.status === '已交付', '请先完成交付'); unblocked(o); requireThat(o.taxStatus === '已归档', '税务资料尚未归档'); requireThat(o.lines.every(l => outstanding(state, o, l.supplierId) === 0), '商户款项尚未全部结清'); o.status = '已关闭'; label = '关闭已完成订单'; break;
    }
    case 'createIssue': {
      const p = z.object({ orderId: short, title: short, detail: text, category: short }).parse(payload); getOrder(p.orderId); targetId = uid('ISS'); state.issues.unshift({ ...p, id: targetId, blocking: true, status: '待处理', resolution: '', createdBy: actor, createdAt: stamp }); label = '提出订单异常'; detail = p.title; break;
    }
    case 'resolveIssue': {
      permit(actor, ['operations']); const p = z.object({ id: short, resolution: text }).parse(payload); const issue = state.issues.find(i => i.id === p.id); requireThat(issue && issue.status === '待处理', '异常不存在或已处理'); issue.status = '已解决'; issue.resolution = p.resolution; targetId = issue.id; label = '解决订单异常'; detail = p.resolution; break;
    }
    case 'createServiceTask': {
      const p = z.object({ title: short, detail: text }).parse(payload); targetId = uid('SR'); state.serviceTasks.unshift({ ...p, id: targetId, actor, status: '待处理', resolution: '', createdAt: stamp }); label = '提交服务请求'; detail = p.title; break;
    }
    case 'resolveServiceTask': {
      permit(actor, ['operations']); const p = z.object({ id: short, resolution: text }).parse(payload); const task = state.serviceTasks.find(t => t.id === p.id); requireThat(task && task.status === '待处理', '服务请求不存在或已完成'); task.status = '已完成'; task.resolution = p.resolution; targetId = task.id; label = '完成服务请求'; detail = p.resolution; break;
    }
    default: throw new BusinessError('不支持的业务操作');
  }
  state.events.unshift({ id: uid('EVT'), action: label, targetId, detail, actor: { ...actor }, at: stamp });
  return state;
}

export function viewState(original: SupplyState, actor: Actor): SupplyState {
  validateActor(original, actor); const state = structuredClone(original); if (actor.role === 'operations') return state;
  state.orders = state.orders.filter(o => canAccessOrder(actor, o));
  const ids = new Set(state.orders.map(o => o.id));
  state.issues = state.issues.filter(i => ids.has(i.orderId));
  state.serviceTasks = state.serviceTasks.filter(t => t.actor.role === actor.role && t.actor.entityId === actor.entityId);
  state.events = state.events.filter(e => e.actor.role === actor.role && e.actor.entityId === actor.entityId);
  if (actor.role === 'supplier') {
    state.suppliers = state.suppliers.filter(s => s.id === actor.entityId);
    state.buyers = state.buyers.map(b => ({ id: b.id, name: '泰国采购渠道', city: b.city, contact: '' }));
    state.products = state.products.filter(p => p.supplierId === actor.entityId);
    state.demands = state.demands.filter(d => state.products.some(p => p.category === d.category));
    state.quotes = [];
    state.settlements = state.settlements.filter(s => s.supplierId === actor.entityId);
    state.orders = state.orders.map(o => ({ ...o, lines: o.lines.filter(l => l.supplierId === actor.entityId).map(l => ({ ...l, unitPrice: l.unitCost ?? l.unitPrice })), total: supplierDue(o, actor.entityId), shipping: 0, tax: 0, paymentRef: '', confirmedSuppliers: o.confirmedSuppliers.filter(s => s === actor.entityId), deliveredSuppliers: o.deliveredSuppliers.filter(s => s === actor.entityId) }));
  } else {
    state.suppliers = [];
    state.buyers = state.buyers.filter(b => b.id === actor.entityId);
    state.products = state.products.filter(p => p.status === '可供货').map(p => ({ ...p, supplierId: '', price: 0, note: '' }));
    state.demands = state.demands.filter(d => d.buyerId === actor.entityId);
    const clean = (l: Order['lines'][number]) => { const { unitCost: _cost, ...rest } = l; return { ...rest, supplierId: '' }; };
    state.quotes = state.quotes.filter(q => q.buyerId === actor.entityId).map(q => ({ ...q, lines: q.lines.map(clean) }));
    state.orders = state.orders.map(o => ({ ...o, lines: o.lines.map(clean), confirmedSuppliers: [], deliveredSuppliers: [] })); state.settlements = [];
  }
  return state;
}
