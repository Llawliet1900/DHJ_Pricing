/**
 * 独立计算逻辑验证脚本
 *  node + tsx 运行：npx tsx src/verify.ts
 * 不依赖浏览器 API，只在 Node 下验证 engine 的各个公式。
 */
import { defaultState } from './seed';
import {
  annualOperationCost,
  capacityKgPerYear,
  computeProfit,
  packCost,
  rawGramsPerPack,
  suggestedPrice,
  weightedPlatformFee,
} from './engine';

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
  // 期望：oneoff + asset 按摊销年数 + annual + consumable + rd
  // oneoff: 3000/4 + 2000/10 + 15000/5 = 750+200+3000 = 3950
  // asset : 20000/5 = 4000
  // annual: 3000+500+3000+5000 = 11500
  // cons  : 2000
  // rd    : 3000
  // total : 3950 + 4000 + 11500 + 2000 + 3000 = 24450
  const expected = 3950 + 4000 + 11500 + 2000 + 3000;
  assert('年度总运营 = 24450', approxEq(ops.total, expected), `got ${ops.total}, want ${expected}`);
}

console.log('\n=== 4. 平台抽成 ===');
{
  const fee = weightedPlatformFee(s.platforms);
  // 默认微信 100% × 1% = 1%
  assert('默认场景 加权抽成 = 1%', approxEq(fee, 0.01), `got ${fee}`);
}

console.log('\n=== 5. 每包生产成本 ===');
{
  const bean = s.beans.find((b) => b.name === '九尾')!; // 拼配 120/kg
  const v110 = bean.variants.find((v) => v.weightG === 110)!;
  const pc = packCost(s, bean, v110);

  // 生豆 g = 110 / 0.95 / 0.85 ≈ 136.222
  const rawG = 110 / 0.95 / 0.85;
  assert('九尾 110g 生豆用量', approxEq(pc.rawGramsPerPack, rawG), `got ${pc.rawGramsPerPack}`);

  const rawCost = (rawG / 1000) * 120;
  assert('九尾 110g 生豆成本', approxEq(pc.rawCost, rawCost));

  // 包装合计：豆袋1.2+贴纸0.3+小卡0.5+角贴0.2+蜂窝纸0.6+快递盒1.5+胶带0.3 = 4.6
  assert('九尾 包装合计 = 4.6', approxEq(pc.packagingCost, 4.6), `got ${pc.packagingCost}`);

  // 物流 = 快递 15
  assert('九尾 物流 = 15', approxEq(pc.logisticsCost, 15));

  // 生产成本 = (raw+pkg) × 1.05 + logistics
  const prod = (rawCost + 4.6) * 1.05 + 15;
  assert('九尾 110g 生产成本', approxEq(pc.productionCost, prod), `got ${pc.productionCost}, want ${prod}`);
}

console.log('\n=== 6. 建议售价 ===');
{
  const bean = s.beans.find((b) => b.name === '九尾')!;
  const v110 = bean.variants.find((v) => v.weightG === 110)!;
  const pc = packCost(s, bean, v110);
  const price = suggestedPrice(pc.productionCost, 0.5, 0.01, 0.2);
  // 公式：pc / (1 - 0.5 - 0.01 - 0.2) = pc / 0.29
  const expected = pc.productionCost / 0.29;
  assert('九尾 110g 50% 建议售价', approxEq(price, expected));

  // 毛利率反向验证：price × (1 - 0.01 - 0.2) - pc = price × 0.5
  const marginCheck = (price * (1 - 0.01 - 0.2) - pc.productionCost) / price;
  assert('扣平台/营销后毛利率 ≈ 50%', approxEq(marginCheck, 0.5), `got ${marginCheck}`);
}

console.log('\n=== 7. 盈利总览 ===');
{
  const r = computeProfit(s);
  if (!r) { failed++; console.log('  ❌ computeProfit returned null'); }
  else {
    // Mid 产能 = 8×3×55 = 1320 kg
    assert('Mid 年产能 = 1320kg', approxEq(r.annualKgTotal, 1320));

    // 运营分摊合计 ≈ 年度总运营 24450
    assert('运营分摊合计 ≈ 年度总运营', approxEq(r.opsTotal, 24450, 1e-4));

    // 平台抽成 = GMV × 1%
    assert('平台抽成 = GMV × 1%', approxEq(r.platformTotal, r.gmvTotal * 0.01));

    // 营销 = GMV × 20%
    assert('营销 = GMV × 20%', approxEq(r.marketingTotal, r.gmvTotal * 0.2));

    // 退货 = GMV × 1%
    assert('退货 = GMV × 1%', approxEq(r.returnLossTotal, r.gmvTotal * 0.01));

    // 净利润 = GMV - prod - ops - plat - mkt - return
    const calc = r.gmvTotal - r.productionTotal - r.opsTotal - r.platformTotal - r.marketingTotal - r.returnLossTotal;
    assert('净利润 = GMV - prod - ops - plat - mkt - return', approxEq(r.netProfit, calc, 1e-6));

    console.log(`  📊  GMV=${r.gmvTotal.toFixed(0)}  Prod=${r.productionTotal.toFixed(0)}  Ops=${r.opsTotal.toFixed(0)}  Plat=${r.platformTotal.toFixed(0)}  Mkt=${r.marketingTotal.toFixed(0)}  Net=${r.netProfit.toFixed(0)}  Margin=${(r.netMargin*100).toFixed(2)}%`);
    console.log(`  📊  Break-even: kg/年=${r.breakeven.kgPerYear.toFixed(1)}  kg/月=${r.breakeven.kgPerMonth.toFixed(1)}  每 kg 贡献=¥${r.breakeven.contributionPerKg.toFixed(2)}`);
  }
}

console.log('\n=== 8. Break-even 一致性 ===');
{
  const r = computeProfit(s)!;
  // 把固定成本减为 0，breakeven kg 应该也是 0
  const noOps = { ...s, costItems: s.costItems.map((c) => ({ ...c, enabled: ['oneoff','asset','annual','consumable','rd'].includes(c.category) ? false : c.enabled })) };
  const r2 = computeProfit(noOps)!;
  assert('固定成本=0 时 breakeven_kg=0', approxEq(r2.breakeven.kgPerYear, 0));

  // 扩大产能 2 倍，固定成本不变，breakeven 的 kg/年 不应随产能变（它是独立于产能的"为保本需要的年销量"）
  const scUp = { ...s, scenarios: s.scenarios.map((x) => x.id === s.profitInputs.scenarioId ? { ...x, hoursPerWeek: x.hoursPerWeek * 2 } : x) };
  const r3 = computeProfit(scUp)!;
  // 产能翻倍后，每 kg 贡献不变（价格、成本结构不变），breakeven_kg 也应不变
  assert('breakeven_kg 不随产能变', approxEq(r3.breakeven.kgPerYear, r.breakeven.kgPerYear, 1e-6), `got ${r3.breakeven.kgPerYear}, orig ${r.breakeven.kgPerYear}`);
}

console.log(`\n===== Total: ${passed} passed / ${failed} failed =====`);
if (failed > 0) process.exit(1);
