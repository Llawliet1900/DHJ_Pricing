/**
 * DHJ 咖啡核算 — 计算引擎
 *
 * 所有计算逻辑集中在这里，保证单一来源。
 * 每个函数都有清晰输入输出和注释，方便验证。
 */
import type {
  AppState,
  Bean,
  BeanVariant,
  CapacityScenario,
  CostItem,
  PlatformRow,
  Ratios,
} from './types';

// ==================== 基础查询 ====================

export function getCostItem(state: AppState, id: string | undefined | null): CostItem | undefined {
  if (!id) return undefined;
  return state.costItems.find((c) => c.id === id);
}

// ==================== 产能 ====================

/** 年产能 (kg 熟豆) = 每周工时 × 每小时产出(kg) × 每年工作周数 */
export function capacityKgPerYear(sc: CapacityScenario): number {
  return sc.hoursPerWeek * sc.kgPerHour * sc.weeksPerYear;
}

// ==================== 运营成本 ====================

/** 把所有启用的一次性/固定资产按摊销折算 + 年度运营 + 耗材 + 研发等，得出"年度总运营成本" */
export function annualOperationCost(state: AppState): {
  total: number;
  breakdown: { id: string; name: string; yearly: number; source: string }[];
} {
  const rows: { id: string; name: string; yearly: number; source: string }[] = [];
  for (const c of state.costItems) {
    if (!c.enabled) continue;
    if (c.category === 'oneoff' || c.category === 'asset') {
      const years = c.amortYears && c.amortYears > 0 ? c.amortYears : 1;
      rows.push({ id: c.id, name: c.name, yearly: c.unitPrice / years, source: `${c.unitPrice} / ${years}年` });
    } else if (c.category === 'annual' || c.category === 'consumable' || c.category === 'rd') {
      rows.push({ id: c.id, name: c.name, yearly: c.unitPrice, source: '年度' });
    }
  }
  const total = rows.reduce((s, r) => s + r.yearly, 0);
  return { total, breakdown: rows };
}

// ==================== 平台综合抽成 ====================

/** 加权平均平台抽成率 = Σ(salesShare × feeRate)；salesShare 会自动归一化 */
export function weightedPlatformFee(platforms: PlatformRow[]): number {
  const totalShare = platforms.reduce((s, p) => s + (p.salesShare || 0), 0);
  if (totalShare <= 0) return 0;
  return platforms.reduce((s, p) => s + ((p.salesShare || 0) / totalShare) * p.feeRate, 0);
}

// ==================== 单包（单 variant）成本 ====================

export interface PackCostBreakdown {
  weightG: number;
  rawGramsPerPack: number;    // 单包生豆用量 (g)
  rawCost: number;            // 生豆成本
  packagingCost: number;      // 包装件合计
  packagingDetails: { name: string; qty: number; unitPrice: number; subtotal: number }[];
  logisticsCost: number;      // 物流（快递）
  productionCost: number;     // 生产成本(含包装损耗) = (raw + pack) × (1+lossPack) + logistics
  // 注意：运营成本分摊不在这里，依赖销量结构，在 profit 里算
}

/** 单包生豆用量 (g) = 熟豆克重 / (1 - 挑豆损耗) / (1 - 烘焙失水) */
export function rawGramsPerPack(weightG: number, r: Ratios): number {
  return weightG / (1 - r.lossSort) / (1 - r.lossRoast);
}

export function packCost(state: AppState, bean: Bean, variant: BeanVariant): PackCostBreakdown {
  const r = state.ratios;
  const raw = getCostItem(state, bean.rawCostItemId);
  const rawGrams = rawGramsPerPack(variant.weightG, r);
  const rawCost = raw ? (rawGrams / 1000) * raw.unitPrice : 0;

  const pkgList = variant.packagingOverride ?? bean.packaging;
  const packagingDetails = pkgList.map((p) => {
    const ci = getCostItem(state, p.costItemId);
    const unitPrice = ci?.unitPrice ?? 0;
    return { name: ci?.name ?? '(未找到)', qty: p.qty, unitPrice, subtotal: unitPrice * p.qty };
  });
  const packagingCost = packagingDetails.reduce((s, d) => s + d.subtotal, 0);

  const logCi = getCostItem(
    state,
    variant.logisticsCostItemId ?? state.defaultLogisticsCostItemId ?? undefined,
  );
  const logisticsCost = logCi?.unitPrice ?? 0;

  // 生产成本（含包装损耗）+ 物流
  const productionCost = (rawCost + packagingCost) * (1 + r.lossPack) + logisticsCost;

  return {
    weightG: variant.weightG,
    rawGramsPerPack: rawGrams,
    rawCost,
    packagingCost,
    packagingDetails,
    logisticsCost,
    productionCost,
  };
}

// ==================== 定价 ====================

/**
 * 目标售价推导：
 *   售价 × (1 − 平台抽成 − 营销占GMV) − 生产成本 = 售价 × 目标毛利
 * 整理：
 *   售价 = 生产成本 / (1 − m − p − s)
 *
 *   其中 m = 目标毛利率, p = 加权平台抽成率, s = 营销/GMV
 * 保证：扣除平台与营销后，毛利率正好是 m
 *
 * 注意：这里的"生产成本"包含了物流；运营成本分摊在 profit 页面另算，
 * 因为分摊依赖销量结构。这里的售价 = 每包"单位毛利"是 m × price。
 */
export function suggestedPrice(productionCost: number, margin: number, platformFee: number, marketingShare: number): number {
  const denom = 1 - margin - platformFee - marketingShare;
  if (denom <= 0) return Infinity;
  return productionCost / denom;
}

// ==================== 盈利总览（按年） ====================

export interface VariantYearStats {
  beanId: string;
  variantId: string;
  beanName: string;
  weightG: number;
  annualKg: number;         // 本 variant 年销量 (kg)
  annualPacks: number;      // 本 variant 年销量 (包)
  productionCost: number;   // 单包生产成本（含损耗+物流）
  price: number;            // 建议售价（含平台抽成/营销覆盖）
  gmv: number;              // 年 GMV = 包数 × 售价
  productionTotal: number;  // 年生产成本
  opsAllocated: number;     // 运营成本分摊
  platformFeeTotal: number; // 平台抽成
  marketingTotal: number;   // 营销费用
  returnLossTotal: number;  // 退货/破损计提
  netProfit: number;        // 净利润
}

export interface ProfitSummary {
  scenario: CapacityScenario;
  annualKgTotal: number;     // 总产能 (kg)
  annualPacksTotal: number;  // 总包数
  gmvTotal: number;
  productionTotal: number;
  opsTotal: number;
  platformTotal: number;
  marketingTotal: number;
  returnLossTotal: number;
  netProfit: number;
  netMargin: number;         // 净利润 / GMV
  weightedPlatformFee: number;
  annualOps: number;         // 年度运营总成本（即 opsTotal）
  variants: VariantYearStats[];
  // Break-even：按当前产品结构/售价下，每年需要卖多少 kg/多少元才保本
  breakeven: {
    kgPerYear: number;       // 年 kg
    kgPerMonth: number;
    gmvPerYear: number;
    gmvPerMonth: number;
    // 每 kg 的"贡献边际"
    contributionPerKg: number;
    // 固定成本（= 年度运营总成本）
    fixedCost: number;
  };
}

/**
 * 计算整体盈利情况。
 *
 * 关键口径：
 *  1) 产能按 scenarioId 取用，得到年熟豆总 kg
 *  2) 按 beanShares 分配给每款豆子（kg）
 *  3) 每款豆子按 variants 内 shareInBean 分配到每个规格（kg）
 *  4) 规格 kg → 规格包数 = kg × 1000 / 克重
 *  5) 每包成本 = productionCost (含损耗+物流)
 *  6) 售价 = 生产成本 / (1 − margin − platformFee − marketing/GMV)
 *  7) 运营成本按"规格 kg 占比"分摊
 *  8) 退货/破损按 GMV × returnRate 计提
 *  9) 净利润 = GMV − 生产成本 − 运营分摊 − 平台抽成 − 营销 − 退货
 *
 * Break-even：
 *   对每个规格定义"贡献边际率" = 1 − 生产成本/售价 − platformFee − marketingShare − returnRate
 *   整体贡献边际按 kg 加权（更直观）
 *   breakeven_kg = 固定成本 / (单位 kg 贡献)
 */
export function computeProfit(state: AppState): ProfitSummary | null {
  const { profitInputs, beans, scenarios, ratios, platforms } = state;
  const scenario = scenarios.find((s) => s.id === profitInputs.scenarioId);
  if (!scenario) return null;

  const totalKg = capacityKgPerYear(scenario);
  const platformFee = weightedPlatformFee(platforms);
  const marketingShare = ratios.marketingOfGmv;

  const annualOps = annualOperationCost(state).total;

  // 归一化 beanShares
  const enabledBeans = beans.filter((b) => b.enabled);
  const shareMap = new Map<string, number>();
  let shareSum = 0;
  for (const bs of profitInputs.beanShares) {
    if (!enabledBeans.find((b) => b.id === bs.beanId)) continue;
    shareMap.set(bs.beanId, bs.share);
    shareSum += bs.share;
  }
  if (shareSum <= 0) {
    // fallback: 平均分配
    const each = 1 / enabledBeans.length;
    enabledBeans.forEach((b) => shareMap.set(b.id, each));
    shareSum = 1;
  }

  // 先算每个 variant 的 annualKg
  interface Row {
    bean: Bean;
    variant: BeanVariant;
    annualKg: number;
  }
  const rows: Row[] = [];
  for (const b of enabledBeans) {
    const beanShare = (shareMap.get(b.id) ?? 0) / shareSum;
    const beanKg = totalKg * beanShare;

    // 归一化 variants
    const vSum = b.variants.reduce((s, v) => s + (v.shareInBean || 0), 0);
    for (const v of b.variants) {
      const vShare = vSum > 0 ? v.shareInBean / vSum : 1 / b.variants.length;
      rows.push({ bean: b, variant: v, annualKg: beanKg * vShare });
    }
  }

  const kgTotal = rows.reduce((s, r) => s + r.annualKg, 0) || 1;

  // 逐行计算
  const variantStats: VariantYearStats[] = rows.map((r) => {
    const pc = packCost(state, r.bean, r.variant);
    const margin = profitInputs.globalMargin ?? r.bean.targetMargin;
    const price = suggestedPrice(pc.productionCost, margin, platformFee, marketingShare);
    const packs = (r.annualKg * 1000) / r.variant.weightG;

    const gmv = packs * price;
    const productionTotal = packs * pc.productionCost;
    const opsAllocated = annualOps * (r.annualKg / kgTotal);
    const platformFeeTotal = gmv * platformFee;
    const marketingTotal = gmv * marketingShare;
    const returnLossTotal = gmv * ratios.returnRate;
    const netProfit = gmv - productionTotal - opsAllocated - platformFeeTotal - marketingTotal - returnLossTotal;

    return {
      beanId: r.bean.id,
      variantId: r.variant.id,
      beanName: r.bean.name,
      weightG: r.variant.weightG,
      annualKg: r.annualKg,
      annualPacks: packs,
      productionCost: pc.productionCost,
      price,
      gmv,
      productionTotal,
      opsAllocated,
      platformFeeTotal,
      marketingTotal,
      returnLossTotal,
      netProfit,
    };
  });

  const sum = (f: (v: VariantYearStats) => number) => variantStats.reduce((s, v) => s + f(v), 0);

  const gmvTotal = sum((v) => v.gmv);
  const productionTotal = sum((v) => v.productionTotal);
  const opsTotal = sum((v) => v.opsAllocated); // ≈ annualOps
  const platformTotal = sum((v) => v.platformFeeTotal);
  const marketingTotal = sum((v) => v.marketingTotal);
  const returnLossTotal = sum((v) => v.returnLossTotal);
  const netProfit = gmvTotal - productionTotal - opsTotal - platformTotal - marketingTotal - returnLossTotal;

  // ===== Break-even =====
  // 对每个 variant 计算"每 kg 贡献边际"
  //   每包贡献 = 售价 × (1 − platformFee − marketing − returnRate) − 生产成本
  //   每 kg 贡献 = 每包贡献 × (1000/克重)
  // 再按 annualKg 占比加权得到整体 每 kg 贡献
  let contribPerKgWeighted = 0;
  for (const v of variantStats) {
    const perPackContrib = v.price * (1 - platformFee - marketingShare - ratios.returnRate) - v.productionCost;
    const perKgContrib = (perPackContrib * 1000) / v.weightG;
    contribPerKgWeighted += perKgContrib * (v.annualKg / kgTotal);
  }
  const fixedCost = annualOps;
  const breakevenKgPerYear = contribPerKgWeighted > 0 ? fixedCost / contribPerKgWeighted : Infinity;
  // Break-even 金额 = kg 占比反推 GMV
  //   对应 scenario 下的 gmv/kg 比率：
  const gmvPerKg = kgTotal > 0 ? gmvTotal / kgTotal : 0;
  const breakevenGmvPerYear = Number.isFinite(breakevenKgPerYear) ? breakevenKgPerYear * gmvPerKg : Infinity;

  return {
    scenario,
    annualKgTotal: kgTotal,
    annualPacksTotal: sum((v) => v.annualPacks),
    gmvTotal,
    productionTotal,
    opsTotal,
    platformTotal,
    marketingTotal,
    returnLossTotal,
    netProfit,
    netMargin: gmvTotal > 0 ? netProfit / gmvTotal : 0,
    weightedPlatformFee: platformFee,
    annualOps,
    variants: variantStats,
    breakeven: {
      kgPerYear: breakevenKgPerYear,
      kgPerMonth: breakevenKgPerYear / 12,
      gmvPerYear: breakevenGmvPerYear,
      gmvPerMonth: breakevenGmvPerYear / 12,
      contributionPerKg: contribPerKgWeighted,
      fixedCost,
    },
  };
}

// ==================== 工具 ====================

export function fmtCNY(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `¥${n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

export function fmtPct(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
