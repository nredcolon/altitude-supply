import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSeed } from '../lib/supply/seed.ts';
import { applyCommand, viewState, outstanding } from '../lib/supply/domain.ts';

const now = new Date('2026-10-13T08:00:00Z');
const ops = { role: 'operations', entityId: 'operations' };
const supplier = { role: 'supplier', entityId: 'sup-1' };
const buyer = { role: 'buyer', entityId: 'buyer-1' };
const seed = () => makeSeed(now);
const act = (s, action, payload, actor=ops) => applyCommand(s, actor, action, payload, now);
const parties = { purchaser:'测试采购方', exporter:'测试出口方', importer:'测试进口方', payee:'测试收款方', delivery:'昆明指定仓交货，泰国买家签收', settlement:'签收后7日内按供货金额结算，平台费0' };
const quotePayload = { demandId:'RFQ-1001', lines:[{productId:'p-1',quantity:100,unitPrice:2100}],shipping:20000,tax:0,validUntil:'2026-10-20',parties,notes:'测试报价：含运输，税费已确认，不含额外包装' };

test('供应商响应不包含其他商户商品、底价、结算或完整跨商户订单',()=>{
  const s = viewState(seed(),supplier);
  assert.equal(s.suppliers.length,1); assert.ok(s.products.every(p=>p.supplierId==='sup-1'));
  assert.ok(s.orders.every(o=>o.lines.every(l=>l.supplierId==='sup-1')));
  assert.equal(s.orders.find(o=>o.id==='SO-1003').total,540000);
  assert.ok(s.orders.every(o=>o.paymentRef==='')); assert.equal(s.quotes.length,0);
});
test('采购方响应隐藏供货底价和商户结算',()=>{
  const s=viewState(seed(),buyer); assert.equal(s.suppliers.length,0);assert.equal(s.settlements.length,0);
  assert.ok(s.products.every(p=>p.price===0 && p.supplierId===''));
  assert.ok(s.orders.every(o=>o.lines.every(l=>!('unitCost' in l) && l.supplierId==='')));
  assert.ok(s.demands.every(d=>d.buyerId===buyer.entityId));
});
test('商户不能审核商品或查看其他商户订单',()=>{
  assert.throws(()=>act(seed(),'reviewProduct',{id:'p-5',result:'可供货',note:'测试'},supplier),/不能/);
  assert.throws(()=>act(seed(),'createIssue',{orderId:'SO-1001',title:'问题',detail:'详情',category:'其他'},supplier),/不可访问/);
});
test('未知角色与实体不能读取工作空间',()=>{
  assert.throws(()=>viewState(seed(),{role:'admin',entityId:'x'}),/无效/);
  assert.throws(()=>viewState(seed(),{role:'supplier',entityId:'unknown'}),/不存在/);
});
test('未准入商户商品不能通过审核',()=>{
  let s=act(seed(),'createProduct',{supplierId:'sup-4',name:'测试商品',category:'其他',spec:'标准',unit:'件',price:100,moq:1,stock:10,leadDays:1});
  assert.throws(()=>act(s,'reviewProduct',{id:s.products[0].id,result:'可供货',note:'已审核'}),/准入/);
});
test('待审核商品、低于起订量、重复商品、库存不足都不能报价',()=>{
  for(const lines of [[{productId:'p-5',quantity:100,unitPrice:2000}],[{productId:'p-1',quantity:1,unitPrice:2000}],[{productId:'p-1',quantity:99999,unitPrice:2000}],[{productId:'p-1',quantity:100,unitPrice:2000},{productId:'p-1',quantity:100,unitPrice:2000}]]) assert.throws(()=>act(seed(),'createQuote',{...quotePayload,lines}));
});
test('报价按整数分计算，确认后预留库存，禁止重复转单',()=>{
  let s=act(seed(),'createQuote',quotePayload);const q=s.quotes[0];assert.equal(q.total,230000);
  s=act(s,'acceptQuote',{id:q.id},buyer);assert.equal(s.orders[0].total,230000);assert.equal(s.products.find(p=>p.id==='p-1').stock,2300);
  assert.throws(()=>act(s,'acceptQuote',{id:q.id},buyer),/已转为订单/);
});
test('供货条件变化或报价过期必须重新报价',()=>{
  let s=act(seed(),'createQuote',quotePayload);s.products[0].price+=1;
  assert.throws(()=>act(s,'acceptQuote',{id:s.quotes[0].id},buyer),/重新报价/);
  s=act(seed(),'createQuote',quotePayload);assert.throws(()=>applyCommand(s,buyer,'acceptQuote',{id:s.quotes[0].id},new Date('2026-10-21T00:00:00Z')),/过期/);
});
test('未核实款项不能启动供货；不能用金额不符的记录放行',()=>{
  let s=act(seed(),'confirmSupply',{id:'SO-1004',supplierId:'sup-3'});
  assert.throws(()=>act(s,'startSupply',{id:'SO-1004'}),/付款条件/);
  assert.throws(()=>act(s,'verifyPayment',{id:'SO-1004',amount:1,reference:'测试凭证'}),/金额/);
});
test('验货差异阻断放行，解决后仍需实收数量一致的复验',()=>{
  let s=seed();assert.throws(()=>act(s,'inspect',{id:'SO-1003',result:'通过',quantity:800,reference:'测试验收'}),/异常/);
  s=act(s,'resolveIssue',{id:'ISS-1001',resolution:'测试：重新包装完成'});
  assert.throws(()=>act(s,'inspect',{id:'SO-1003',result:'通过',quantity:799,reference:'测试验收'}),/数量/);
  s=act(s,'inspect',{id:'SO-1003',result:'通过',quantity:800,reference:'测试复验'});
  assert.equal(s.orders.find(o=>o.id==='SO-1003').status,'待发运');
  assert.throws(()=>act(s,'dispatch',{id:'SO-1003',carrier:'测试承运',waybill:'TEST-1',eta:'2026-10-20'}),/放行/);
});
test('分批付款不能超额、重复登记、填未来日期，平台费保持为零',()=>{
  const s=seed();const payload={id:'SO-1001',supplierId:'sup-2',amount:260000,reference:'测试付款',paidAt:'2026-10-13'};
  assert.throws(()=>act(s,'settle',{...payload,amount:260001}),/超过/);
  assert.throws(()=>act(s,'settle',{...payload,paidAt:'2026-10-14'}),/未来/);
  const next=act(s,'settle',payload);assert.equal(next.settlements[0].fee,0);assert.equal(outstanding(next,next.orders.find(o=>o.id==='SO-1001'),'sup-2'),0);
  assert.throws(()=>act(next,'settle',payload));assert.throws(()=>act(next,'closeOrder',{id:'SO-1001'}),/归档/);
});
test('未经买家签收不能登记商户结算',()=>{
  assert.throws(()=>act(seed(),'settle',{id:'SO-1002',supplierId:'sup-1',amount:100,reference:'测试',paidAt:'2026-10-13'}),/交付/);
});
test('完整流程：需求报价、多供应商供货、交货验收、放行发运、签收、结算、归档关闭',()=>{
  let s=act(seed(),'createQuote',{...quotePayload,lines:[...quotePayload.lines,{productId:'p-2',quantity:100,unitPrice:800}]});
  s=act(s,'acceptQuote',{id:s.quotes[0].id},buyer);const id=s.orders[0].id;
  for(const supplierId of ['sup-1','sup-2'])s=act(s,'confirmSupply',{id,supplierId},{role:'supplier',entityId:supplierId});
  s=act(s,'verifyPayment',{id,amount:s.orders[0].total,reference:'测试足额收款'});
  s=act(s,'startSupply',{id});
  for(const supplierId of ['sup-1','sup-2'])s=act(s,'warehouseDelivery',{id,supplierId,reference:'测试交货'},{role:'supplier',entityId:supplierId});
  s=act(s,'inspect',{id,result:'通过',quantity:200,reference:'测试验货'});
  s=act(s,'recordCustoms',{id,reference:'测试关务放行'});
  s=act(s,'dispatch',{id,carrier:'测试物流',waybill:'TEST-123',eta:'2026-10-20'});
  s=act(s,'receive',{id,reference:'测试客户签收'},buyer);
  for(const [supplierId,amount] of [['sup-1',180000],['sup-2',65000]])s=act(s,'settle',{id,supplierId,amount,reference:`测试付款-${supplierId}`,paidAt:'2026-10-13'});
  s=act(s,'archiveTax',{id,reference:'测试归档'});s=act(s,'closeOrder',{id});
  assert.equal(s.orders[0].status,'已关闭');assert.equal(s.orders[0].logistics,'已签收');assert.ok(s.events.length>=15);
});
test('失败操作不会污染原始数据，非法日期和负金额会被拒绝',()=>{
  const s=seed(),before=JSON.stringify(s);assert.throws(()=>act(s,'verifyPayment',{id:'SO-1004',amount:-1,reference:'测试'}));assert.equal(JSON.stringify(s),before);
  assert.throws(()=>act(s,'createDemand',{buyerId:'buyer-1',title:'测试',category:'其他',quantity:1,budget:0,destination:'曼谷',dueDate:'2026-02-31',requirements:'测试'}));
});
