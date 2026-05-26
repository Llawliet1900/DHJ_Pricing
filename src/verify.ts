/**
 * 独立计算逻辑验证脚本
 *  node + tsx 运行：npm run verify
 * 不依赖浏览器 API，只在 Node 下验证 engine 的各个公式。
 */
import { defaultState } from './seed';
import {
  aggregateSales,
  annualOperationCost,
  autoMatchSpec,
  capacityKgPerYear,
  computeProfit,
  computeRunRate,
  computeSalesSummary,
  filterOrdersByWindow,
  impliedMargin,
  packCost,
  rawGramsPerPack,
  resolveVariantPricing,
  spanDays,
  suggestedPrice,
  weightedPlatformFee,
} from './engine';
import type { Bean, BeanVariant, SalesOrder, SpecMapping } from './types';

let passed = 0;
let failed = 0;

function assert(name: string, cond: boolean, detail?: string) {
  if (cond) {
    passed++;
    console.log(`  ✅  ${name}`);
  } else {
    failed++;
    console.log(`  ❌  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}
function approxEq(a: number, b: number, tol = 1e-6) {
  return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
}

const s = defaultState;

console.log('\n=== 1. 生豆用量 ===');
{
  const g = rawGramsPerPack(110, s.ratios);
  const expected = 110 / 0.95 / 0.85; // 挑豆 5% + 烘焙 15%
  assert('110g 熟豆 → 生豆 g', approxEq(g, expected), `got ${g}, want ${expected}`);
}

console.log('\n=== 2. 产能 ===');
{
  const low = s.scenarios.find((x) => x.name === 'Low')!;
  const kg = capacityKgPerYear(low);
  assert('Low 年产能', approxEq(kg, 4 * 3 * 40), `${kg} vs ${4 * 3 * 40}`);
  const high = s.scenarios.find((x) => x.name === 'High')!;
  assert('High 年产能', approxEq(capacityKgPerYear(high), 10 * 3 * 60));
}

console.log('\n=== 3. 年度运营成本 ===');
{
  const ops = annualOperationCost(s);
  // oneoff: 3000/4 + 2000/10 + 15000/5 = 750+200+3000 = 3950
  // asset : 20000/5 = 4000
  // annual: 3000+500+3000+5000 = 11500
  // cons  : 2000
  // rd    : 3000
  // total : 24450
  const expected = 3950 + 4000 + 11500 + 2000 + 3000;
  assert('年度总运营 = 24450', approxEq(ops.total, expected), `got ${ops.total}, want ${expected}`);
}

console.log('\n=== 4. 平台抽成 ===');
{
  const fee = weightedPlatformFee(s.platforms);
  assert('默认场景 加权抽成 = 1%', approxEq(fee, 0.01), `got ${fee}`);
}

console.log('\n=== 5. 每包生产成本（用 bean 独立生豆价） ===');
{
  const bean = s.beans.find((b) => b.name === '九尾')!;
  assert('九尾 生豆单价 = 120/kg', approxEq(bean.greenPricePerKg, 120), `got ${bean.greenPricePerKg}`);

  const v110 = bean.variants.find((v) => v.weightG === 110)!;
  const pc = packCost(s, bean, v110);

  const rawG = 110 / 0.95 / 0.85;
  assert('九尾 110g 生豆用量', approxEq(pc.rawGramsPerPack, rawG), `got ${pc.rawGramsPerPack}`);

  const rawCost = (rawG / 1000) * 120;
  assert('九尾 110g 生豆成本（用 bean.greenPricePerKg）', approxEq(pc.rawCost, rawCost), `got ${pc.rawCost} vs ${rawCost}`);

  // 包装合计：豆袋1.2+贴纸0.3+小卡0.5+角贴0.2+蜂窝纸0.6+快递盒1.5+胶带0.3 = 4.6
  assert('九尾 包装合计 = 4.6', approxEq(pc.packagingCost, 4.6), `got ${pc.packagingCost}`);
  assert('九尾 物流 = 15', approxEq(pc.logisticsCost, 15));

  const prod = (rawCost + 4.6) * 1.05 + 15;
  assert('九尾 110g 生产成本', approxEq(pc.productionCost, prod), `got ${pc.productionCost}, want ${prod}`);
}

console.log('\n=== 6. 单豆独立价格生效（改九尾生豆价不影响朏胐/精卫） ===');
{
  // 模拟修改九尾的生豆价到 200，检查朏胐（还是 120）不变
  const mutated = {
    ...s,
    beans: s.beans.map((b) => (b.name === '九尾' ? { ...b, greenPricePerKg: 200 } : b)),
  };
  const jw = mutated.beans.find((b) => b.name === '九尾')!;
  const fh = mutated.beans.find((b) => b.name === '朏胐')!;

  const pcJw = packCost(mutated, jw, jw.variants[0]);
  const pcFh = packCost(mutated, fh, fh.variants[0]);

  const rawG = jw.variants[0].weightG / 0.95 / 0.85;
  assert('九尾 生豆成本随新价 (200)', approxEq(pcJw.rawCost, (rawG / 1000) * 200));
  assert('朏胐 生豆成本不受影响（仍 120）', approxEq(pcFh.rawCost, (rawG / 1000) * 120));
}

console.log('\n=== 7. 正向定价（目标毛利 → 售价） ===');
{
  const bean = s.beans.find((b) => b.name === '九尾')!;
  const v110 = bean.variants.find((v) => v.weightG === 110)!;
  const pc = packCost(s, bean, v110);
  const price = suggestedPrice(pc.productionCost, 0.5, 0.01, 0.2);
  const expected = pc.productionCost / 0.29;
  assert('九尾 110g 50% 建议售价', approxEq(price, expected));

  // 毛利率反向验证：price × (1 - 0.01 - 0.2) - pc = price × 0.5
  const marginCheck = (price * (1 - 0.01 - 0.2) - pc.productionCost) / price;
  assert('扣平台/营销后毛利率 ≈ 50%', approxEq(marginCheck, 0.5), `got ${marginCheck}`);
}

console.log('\n=== 8. 反向定价（售价 → 实际毛利） ===');
{
  const bean = s.beans.find((b) => b.name === '九尾')!;
  const v110 = bean.variants.find((v) => v.weightG === 110)!;
  const pc = packCost(s, bean, v110);

  // 建议售价下，impliedMargin 应等于 targetMargin
  const suggested = suggestedPrice(pc.productionCost, 0.5, 0.01, 0.2);
  const implied = impliedMargin(suggested, pc.productionCost, 0.01, 0.2);
  assert('建议售价 ↔ 反推毛利一致', approxEq(implied, 0.5), `got ${implied}`);

  // 手动把售价设得更高，实际毛利 > 目标
  const higher = suggested * 1.2;
  const m2 = impliedMargin(higher, pc.productionCost, 0.01, 0.2);
  assert('售价 +20% → 实际毛利 > 50%', m2 > 0.5, `got ${m2}`);

  // 手动把售价设得更低，实际毛利 < 目标
  const lower = suggested * 0.8;
  const m3 = impliedMargin(lower, pc.productionCost, 0.01, 0.2);
  assert('售价 -20% → 实际毛利 < 50%', m3 < 0.5, `got ${m3}`);
}

console.log('\n=== 9. resolveVariantPricing（手动/自动分叉） ===');
{
  const bean = s.beans.find((b) => b.name === '九尾')!;
  const v110 = bean.variants.find((v) => v.weightG === 110)!;
  const pc = packCost(s, bean, v110);

  // 自动模式
  const autoResult = resolveVariantPricing(v110, pc.productionCost, bean, 0.01, 0.2);
  assert('自动模式 isManual=false', autoResult.isManual === false);
  assert('自动模式 margin = targetMargin', approxEq(autoResult.margin, 0.5));

  // 手动模式
  const vManual: BeanVariant = { ...v110, manualPrice: true, manualPriceValue: 100 };
  const manualResult = resolveVariantPricing(vManual, pc.productionCost, bean, 0.01, 0.2);
  assert('手动模式 isManual=true', manualResult.isManual === true);
  assert('手动模式 price=100', approxEq(manualResult.price, 100));
  const expectedImplied = 1 - 0.01 - 0.2 - pc.productionCost / 100;
  assert('手动模式 margin = impliedMargin', approxEq(manualResult.margin, expectedImplied));
}

console.log('\n=== 10. 盈利总览 ===');
{
  const r = computeProfit(s);
  if (!r) { failed++; console.log('  ❌ computeProfit returned null'); }
  else {
    assert('Mid 年产能 = 1320kg', approxEq(r.annualKgTotal, 1320));
    assert('运营分摊合计 ≈ 年度总运营', approxEq(r.opsTotal, 24450, 1e-4));
    assert('平台抽成 = GMV × 1%', approxEq(r.platformTotal, r.gmvTotal * 0.01));
    assert('营销 = GMV × 20%', approxEq(r.marketingTotal, r.gmvTotal * 0.2));
    assert('退货 = GMV × 1%', approxEq(r.returnLossTotal, r.gmvTotal * 0.01));

    const calc = r.gmvTotal - r.productionTotal - r.opsTotal - r.platformTotal - r.marketingTotal - r.returnLossTotal;
    assert('净利润 = GMV - prod - ops - plat - mkt - return', approxEq(r.netProfit, calc, 1e-6));

    console.log(`  📊  GMV=${r.gmvTotal.toFixed(0)}  Prod=${r.productionTotal.toFixed(0)}  Ops=${r.opsTotal.toFixed(0)}  Plat=${r.platformTotal.toFixed(0)}  Mkt=${r.marketingTotal.toFixed(0)}  Net=${r.netProfit.toFixed(0)}  Margin=${(r.netMargin*100).toFixed(2)}%`);
    console.log(`  📊  Break-even: kg/年=${r.breakeven.kgPerYear.toFixed(1)}  kg/月=${r.breakeven.kgPerMonth.toFixed(1)}  每 kg 贡献=¥${r.breakeven.contributionPerKg.toFixed(2)}`);
  }
}

console.log('\n=== 11. SKU 自定义规格（可增减） ===');
{
  // 给九尾加一个 1kg 规格，检查盈利页能计算
  const bean = s.beans.find((b) => b.name === '九尾')!;
  const extraV: BeanVariant = { id: 'var_test_1kg', label: '1kg', weightG: 1000, shareInBean: 0 };
  const mutated = {
    ...s,
    beans: s.beans.map((b) => (b.id === bean.id ? { ...b, variants: [...b.variants, extraV] } as Bean : b)),
  };
  const pc = packCost(mutated, mutated.beans.find((b) => b.name === '九尾')!, extraV);

  const rawG = 1000 / 0.95 / 0.85;
  assert('1kg 生豆用量', approxEq(pc.rawGramsPerPack, rawG));
  assert('1kg 生产成本 > 110g 生产成本', pc.productionCost > packCost(s, bean, bean.variants[0]).productionCost);

  // 盈利页仍可计算（shareInBean=0 时不会报错）
  const r = computeProfit(mutated);
  assert('加新规格后 profit 仍可计算', !!r);
}

console.log('\n=== 12. 手动定价下的净利润正确性 ===');
{
  // 把九尾 110g 改为手动定价 80 元，检查该 variant 的毛利率/净利润口径
  const bean = s.beans.find((b) => b.name === '九尾')!;
  const mutated = {
    ...s,
    beans: s.beans.map((b) =>
      b.id === bean.id
        ? {
            ...b,
            variants: b.variants.map((v) =>
              v.weightG === 110 ? { ...v, manualPrice: true, manualPriceValue: 80 } : v,
            ),
          }
        : b,
    ),
  };
  const r = computeProfit(mutated)!;
  const row = r.variants.find((v) => v.beanId === bean.id && v.weightG === 110)!;
  assert('手动定价 price = 80', approxEq(row.price, 80));
  assert('手动定价标记 isManualPrice', row.isManualPrice === true);
  // 反推毛利率一致
  const expectedMargin = 1 - r.weightedPlatformFee - s.ratios.marketingOfGmv - row.productionCost / 80;
  assert('手动定价 margin = impliedMargin', approxEq(row.margin, expectedMargin));
}

console.log('\n=== 13. Break-even 一致性 ===');
{
  const r = computeProfit(s)!;
  const noOps = { ...s, costItems: s.costItems.map((c) => ({ ...c, enabled: ['oneoff','asset','annual','consumable','rd'].includes(c.category) ? false : c.enabled })) };
  const r2 = computeProfit(noOps)!;
  assert('固定成本=0 时 breakeven_kg=0', approxEq(r2.breakeven.kgPerYear, 0));

  const scUp = { ...s, scenarios: s.scenarios.map((x) => x.id === s.profitInputs.scenarioId ? { ...x, hoursPerWeek: x.hoursPerWeek * 2 } : x) };
  const r3 = computeProfit(scUp)!;
  assert('breakeven_kg 不随产能变', approxEq(r3.breakeven.kgPerYear, r.breakeven.kgPerYear, 1e-6));
}

console.log('\n=== 14. 实销分析 - 自动映射 ===');
{
  const s = defaultState;
  const m1 = autoMatchSpec(s, '【大荒记】九尾 子夜 | 意式拼配 中深烘焙咖啡豆', '【大荒记】九尾 子夜 | 意式拼配 中深烘焙咖啡豆 110g');
  assert('九尾110g → 命中', m1.beanId === 'bn_jiuwei' && m1.variantId !== null);
  const m2 = autoMatchSpec(s, '【大荒记】精卫 衔果 | 精品咖啡豆 埃塞 手冲推荐', '【大荒记】精卫 衔果 | 精品咖啡豆 埃塞 手冲推荐 225g');
  assert('精卫225g → 命中', m2.beanId === 'bn_jingwei' && m2.variantId !== null);
  const m3 = autoMatchSpec(s, '某未知豆', '某未知豆 110g');
  assert('未知豆 → 不命中', m3.beanId === null);
}

console.log('\n=== 15. 实销分析 - 时间窗口过滤 ===');
{
  const orders: SalesOrder[] = [
    mkOrder('o1', 'spec_jw_110', '2026-05-01', 1, 53.65),
    mkOrder('o2', 'spec_jw_110', '2026-05-15', 2, 107.77),
    mkOrder('o3', 'spec_jw_110', '2026-05-24', 1, 53.65),
  ];
  const all = filterOrdersByWindow(orders, 'all', 0);
  assert('all 模式返回全部', all.length === 3);
  const last14 = filterOrdersByWindow(orders, 'days', 14);
  assert('14 天窗口包含 o2/o3', last14.length === 2);
  const last7 = filterOrdersByWindow(orders, 'days', 7);
  assert('7 天窗口仅含 o3', last7.length === 1);
  const sd = spanDays(orders);
  assert('spanDays = 24', sd === 24);
}

console.log('\n=== 16. 实销分析 - 聚合与利润 ===');
{
  const s = defaultState;
  const beanJw = s.beans.find((b) => b.id === 'bn_jiuwei')!;
  const v110 = beanJw.variants.find((v) => v.weightG === 110)!;
  const v225 = beanJw.variants.find((v) => v.weightG === 225)!;
  const mappings: SpecMapping[] = [
    { specId: 'spec_jw_110', beanId: 'bn_jiuwei', variantId: v110.id, unmapped: false, productName: '九尾', specName: '九尾 110g' },
    { specId: 'spec_jw_225', beanId: 'bn_jiuwei', variantId: v225.id, unmapped: false, productName: '九尾', specName: '九尾 225g' },
  ];
  const orders: SalesOrder[] = [
    mkOrder('o1', 'spec_jw_110', '2026-05-01', 1, 53.65),
    mkOrder('o2', 'spec_jw_110', '2026-05-15', 2, 107.77),
    mkOrder('o3', 'spec_jw_225', '2026-05-10', 1, 95.0),
    mkOrder('o4', 'spec_unknown',  '2026-05-20', 1, 100.0),
  ];
  const sWithSales = { ...s, sales: { ...s.sales, specMappings: mappings } };
  const agg = aggregateSales(sWithSales, orders, true);
  assert('聚合后有 2 个 SKU', agg.rows.length === 2);
  assert('未映射 = 1', agg.unmappedCount === 1);
  const row110 = agg.rows.find((r) => r.variantId === v110.id)!;
  assert('九尾110g 袋数 = 3', row110.quantity === 3);
  assert('九尾110g GMV = 161.42', approxEq(row110.grossRevenue, 53.65 + 107.77, 1e-6));
  assert('九尾110g 涉及订单数 = 2', row110.orderCount === 2);
  assert('九尾110g 净收入 = GMV × 0.99', approxEq(row110.netRevenue, row110.grossRevenue * 0.99));

  const summary = computeSalesSummary(sWithSales, orders, true);
  assert('summary 累计 GMV 含已映射 SKU', approxEq(summary.totals.grossRevenue, 53.65 + 107.77 + 95.0));
  // orders 包含 o1=05-01 / o2=05-15 / o3=05-10 / o4=05-20（未映射但仍参与时间跨度计算）
  // min=05-01, max=05-20 → span = 20 天
  assert('summary spanDays = 20', summary.spanDays === 20);
  const expectedMkt = summary.totals.grossRevenue * s.ratios.marketingOfGmv;
  assert('营销费 = GMV × marketingOfGmv', approxEq(summary.totals.marketing, expectedMkt));
  assert(
    'grossProfit = netRev - varCost - mkt',
    approxEq(summary.totals.grossProfit, summary.totals.netRevenue - summary.totals.variableCost - summary.totals.marketing),
  );
  const opAnnual = annualOperationCost(sWithSales).total;
  assert('运营按天数摊 = opAnnual × 20/365', approxEq(summary.totals.operationByDays, opAnnual * (20 / 365), 1e-3));
}

console.log('\n=== 17. 实销分析 - 跑速年化 ===');
{
  const s = defaultState;
  const beanJw = s.beans.find((b) => b.id === 'bn_jiuwei')!;
  const v110 = beanJw.variants.find((v) => v.weightG === 110)!;
  const mappings: SpecMapping[] = [
    { specId: 'spec_jw_110', beanId: 'bn_jiuwei', variantId: v110.id, unmapped: false, productName: '九尾', specName: '九尾 110g' },
  ];
  const orders: SalesOrder[] = [
    mkOrder('o1', 'spec_jw_110', '2026-05-01', 1, 53.65),
    mkOrder('o2', 'spec_jw_110', '2026-05-15', 2, 107.77),
    mkOrder('o3', 'spec_jw_110', '2026-05-24', 1, 53.65),
  ];
  const sWithSales = { ...s, sales: { ...s.sales, specMappings: mappings } };
  const rr = computeRunRate(sWithSales, orders, true);
  const expectedDaily = (53.65 + 107.77 + 53.65) / 24;
  assert('日均 GMV 正确', approxEq(rr.dailyGmv, expectedDaily, 1e-6));
  assert('年化 GMV = 日均 × 365', approxEq(rr.annualGmv, expectedDaily * 365, 1e-6));
  assert('年化运营 = 全年运营', approxEq(rr.annualOperation, annualOperationCost(sWithSales).total));
  assert('年化净利润 = 毛利 - 全年运营', approxEq(rr.annualNetProfit, rr.annualGrossProfit - rr.annualOperation));
  assert('perVariant 有 1 项', rr.perVariantAnnualQty.length === 1);
  const pv = rr.perVariantAnnualQty[0];
  assert('年化袋数 = 4/24 × 365', approxEq(pv.annualQty, (4 / 24) * 365, 1e-6));
  assert('年化 kg 与年化袋数一致', approxEq(pv.annualKg, (pv.annualQty * 110) / 1000));
}

console.log(`\n===== Total: ${passed} passed / ${failed} failed =====`);
if (failed > 0) process.exit(1);

// ============ Sales 测试辅助 ============
function mkOrder(orderId: string, specId: string, paidAt: string, quantity: number, grossAmount: number): SalesOrder {
  return {
    id: `s_${orderId}_${specId}`,
    orderId,
    specId,
    paidAt: paidAt + 'T12:00:00',
    productName: 'mock',
    specName: 'mock',
    quantity,
    grossAmount,
    source: 'test',
    importedAt: new Date().toISOString(),
  };
}
