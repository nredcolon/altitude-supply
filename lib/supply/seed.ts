import type { SupplyState, Order, Line, Parties } from './types';

export function makeSeed(now = new Date()): SupplyState {
  const day = (offset: number) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
  const stamp = now.toISOString();
  const parties: Parties = { purchaser: '示例 · 泰国联合采购方', exporter: '示例 · 境内出口服务方', importer: '示例 · 泰国进口商', payee: '示例 · 订单收款主体', delivery: '昆明集货点交货；泰国采购方指定仓验收', settlement: '海外签收并完成对账后 7 日内，按供货金额结算；平台服务费为 0' };
  const state: SupplyState = {
    suppliers: [
      { id: 'sup-1', name: '云禾家居商行', category: '家居日用', contact: '李店长（示例）', location: '一期 B 区 3 楼', status: '已准入', note: '支持混批，现货供应' },
      { id: 'sup-2', name: '织物里纺织', category: '家纺布艺', contact: '陈店长（示例）', location: '二期 12 区 2 楼', status: '已准入', note: '支持定制包装' },
      { id: 'sup-3', name: '山野随行箱包', category: '箱包配饰', contact: '王店长（示例）', location: '一期 C 区 2 楼', status: '已准入', note: '小批量灵活补货' },
      { id: 'sup-4', name: '禾木生活用品', category: '家居日用', contact: '赵店长（示例）', location: '二期 15 区 1 楼', status: '待审核', note: '经营主体资料待核实' },
    ],
    buyers: [ { id: 'buyer-1', name: 'Siam Living', city: '曼谷 Bangkok', contact: '采购团队（示例）' }, { id: 'buyer-2', name: 'North Market', city: '清迈 Chiang Mai', contact: '采购团队（示例）' } ],
    products: [
      { id: 'p-1', supplierId: 'sup-1', name: '藤编纹收纳篮', category: '家居日用', spec: '米白 / 32 × 24 × 18 cm', unit: '个', price: 1800, moq: 60, stock: 2400, leadDays: 3, status: '可供货', note: '可堆叠，独立包装', artwork: 'basket', updatedAt: stamp },
      { id: 'p-2', supplierId: 'sup-2', name: '纯棉素色毛巾', category: '家纺布艺', spec: '奶油白 / 34 × 75 cm / 120g', unit: '条', price: 650, moq: 100, stock: 5000, leadDays: 2, status: '可供货', note: '颜色与样品保持一致', artwork: 'towel', updatedAt: stamp },
      { id: 'p-3', supplierId: 'sup-3', name: '轻旅帆布托特包', category: '箱包配饰', spec: '原色 / 38 × 35 cm', unit: '个', price: 1250, moq: 100, stock: 1800, leadDays: 5, status: '可供货', note: '可提供定制方案，需另行确认', artwork: 'bag', updatedAt: stamp },
      { id: 'p-4', supplierId: 'sup-1', name: '磨砂随行水杯', category: '家居日用', spec: '鼠尾草绿 / 500 ml', unit: '个', price: 2200, moq: 100, stock: 1200, leadDays: 4, status: '待补充', note: '请补充材质及用途资料', artwork: 'bottle', updatedAt: stamp },
      { id: 'p-5', supplierId: 'sup-2', name: '条纹棉麻抱枕套', category: '家纺布艺', spec: '烟绿条纹 / 45 × 45 cm', unit: '个', price: 1580, moq: 80, stock: 1600, leadDays: 3, status: '待审核', note: '待审核商品信息与样品', artwork: 'pillow', updatedAt: stamp },
      { id: 'p-6', supplierId: 'sup-3', name: '旅行收纳三件套', category: '箱包配饰', spec: '暖灰 / 大中小三件', unit: '套', price: 2400, moq: 60, stock: 900, leadDays: 4, status: '可供货', note: '网面透气，整套包装', artwork: 'organizer', updatedAt: stamp },
    ],
    demands: [
      { id: 'RFQ-1001', buyerId: 'buyer-1', title: '曼谷生活方式门店 · 收纳用品补货', category: '家居日用', quantity: 300, budget: 2200, destination: '泰国 · 曼谷 Bang Na 仓', dueDate: day(18), requirements: '米白与自然色系；整箱包装；先确认样品与包装尺寸。', status: '待报价', createdAt: stamp },
      { id: 'RFQ-1002', buyerId: 'buyer-2', title: '清迈精品住宿 · 客房布艺采购', category: '家纺布艺', quantity: 500, budget: 1000, destination: '泰国 · 清迈采购仓', dueDate: day(24), requirements: '棉质、耐洗，规格与样品一致；需要中英文商品清单。', status: '待报价', createdAt: stamp },
      { id: 'RFQ-1003', buyerId: 'buyer-1', title: '泰国零售渠道 · 帆布袋秋季补货', category: '箱包配饰', quantity: 200, budget: 1600, destination: '泰国 · 曼谷 Bang Na 仓', dueDate: day(12), requirements: '原色帆布，不带品牌标识，按指定数量整箱供货。', status: '已成交', createdAt: stamp },
    ], quotes: [], orders: [], settlements: [], issues: [], serviceTasks: [], events: [],
  };
  const line = (pid: string, qty: number): Line => { const p = state.products.find(p => p.id === pid)!; return { productId: p.id, supplierId: p.supplierId, name: p.name, spec: p.spec, unit: p.unit, artwork: p.artwork, quantity: qty, unitCost: p.price, unitPrice: p.price }; };
  const order = (id: string, lines: Line[], status: Order['status'], age: number): Order => {
    const total = lines.reduce((a, l) => a + l.quantity * l.unitPrice, 0);
    return { id, quoteId: `QT-${id.slice(-4)}`, demandId: 'RFQ-1003', buyerId: 'buyer-1', lines, total: total + 80000, shipping: 80000, tax: 0, destination: '泰国 · 曼谷 Bang Na 仓', dueDate: day(10 - age), status, confirmedSuppliers: status === '待确认' ? [] : [...new Set(lines.map(l => l.supplierId))], deliveredSuppliers: ['待验货', '待发运', '运输中', '已交付', '已关闭'].includes(status) ? [...new Set(lines.map(l => l.supplierId))] : [], payment: status === '待确认' ? '待核实' : '已核实', paymentRef: status === '待确认' ? '' : '示例收款凭证', logistics: status === '运输中' ? '运输中' : status === '已交付' ? '已签收' : status === '待验货' ? '已集货' : '待集货', customs: ['运输中', '已交付'].includes(status) ? '已放行' : '待补资料', customsRef: ['运输中', '已交付'].includes(status) ? '示例放行资料' : '', taxStatus: '待归档', taxRef: '', inspection: ['运输中', '已交付'].includes(status) ? '已通过' : '待验货', carrier: status === '运输中' ? '跨境公路专线（示例）' : '', waybill: status === '运输中' ? 'DEMO-TH-1003' : '', receiptRef: status === '已交付' ? '示例签收记录' : '', eta: day(4), parties: { ...parties }, createdAt: day(-age) + 'T08:00:00.000Z' };
  };
  state.orders = [order('SO-1004', [line('p-3', 200)], '待确认', 0), order('SO-1003', [line('p-1', 300), line('p-2', 500)], '待验货', 2), order('SO-1002', [line('p-1', 200), line('p-6', 100)], '运输中', 5), order('SO-1001', [line('p-2', 800)], '已交付', 12)];
  // Seed objects are linked exactly like created orders, without placeholder references.
  state.demands = state.demands.filter(d => d.status !== '已成交');
  for (const o of state.orders) {
    const demandId = `RFQ-SEED-${o.id.slice(-4)}`;
    o.demandId = demandId;
    state.demands.push({ id: demandId, buyerId: o.buyerId, title: `示例历史采购 · ${o.lines[0].name}`, category: state.products.find(p => p.id === o.lines[0].productId)!.category, quantity: o.lines.reduce((sum, l) => sum + l.quantity, 0), budget: o.lines[0].unitPrice, destination: o.destination, dueDate: o.dueDate, requirements: '示例历史需求：按确认规格和样品交付。', status: '已成交', createdAt: o.createdAt });
    state.quotes.push({ id: o.quoteId, demandId, buyerId: o.buyerId, lines: structuredClone(o.lines), shipping: o.shipping, tax: o.tax, total: o.total, validUntil: o.dueDate, status: '已接受', parties: structuredClone(o.parties), notes: '示例历史报价，仅用于验证工作流；金额和主体不对应真实交易。', createdAt: o.createdAt });
  }
  state.orders[1].inspection = '存在差异';
  state.issues = [{ id: 'ISS-1001', orderId: 'SO-1003', title: '到仓收纳篮外箱破损', detail: '示例：发现 2 箱外包装破损，需重新包装并完成复验。', category: '验货差异', blocking: true, status: '待处理', resolution: '', createdBy: { role: 'operations', entityId: 'operations' }, createdAt: stamp }];
  state.settlements = [{ id: 'SET-1001', orderId: 'SO-1001', supplierId: 'sup-2', amount: 260000, reference: '示例付款记录 · 分批结算', paidAt: day(-2), fee: 0 }];
  state.events = [{ id: 'evt-seed', action: '建立示例工作空间', targetId: '', detail: '所有商户、渠道、订单与款项均为演示数据。', actor: { role: 'operations', entityId: 'operations' }, at: stamp }];
  return state;
}
