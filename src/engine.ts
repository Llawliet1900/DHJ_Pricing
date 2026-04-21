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

/** 规格显示名（label > weightG） */
export function variantLabel(v: BeanVariant): string {
  return v.label?.trim() ? v.label.trim() : `${v.weightG}g`;
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

/**
 * 计算单包成本。
 * @param includeLogistics 是否把物流计入生产成本；默认 true。
 *   - true  = 包邮：物流算在生产成本里（卖家承担运费）
 *   - false = 不包邮：物流不计入（由用户另付运费，卖家不承担）
 */
export function packCost(
  state: AppState,
  bean: Bean,
  variant: BeanVariant,
  includeLogistics = true,
): PackCostBreakdown {
  const r = state.ratios;
  // 生豆价：优先使用 bean.greenPricePerKg；如果 0 且有 rawCostItemId 就 fallback 到成本项
  let greenPrice = bean.greenPricePerKg;
  if ((!greenPrice || greenPrice <= 0) && bean.rawCostItemId) {
    greenPrice = getCostItem(state, bean.rawCostItemId)?.unitPrice ?? 0;
  }
  const rawGrams = rawGramsPerPack(variant.weightG, r);
  const rawCost = (rawGrams / 1000) * greenPrice;

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
  const logisticsRaw = logCi?.unitPrice ?? 0;
  const logisticsCost = includeLogistics ? logisticsRaw : 0;

  // 生产成本（含包装损耗）+ 物流（按 includeLogistics 决定是否计入）
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
 * 正向定价：给定目标毛利率，推导售价
 *
 *   售价 × (1 − 平台抽成 − 营销占GMV) − 生产成本 = 售价 × 目标毛利
 *   => 售价 = 生产成本 / (1 − m − p − s)
 *
 * 其中 m = 目标毛利率, p = 加权平台抽成率, s = 营销/GMV
 * 保证：扣除平台与营销后，毛利率正好是 m
 */
export function suggestedPrice(productionCost: number, margin: number, platformFee: number, marketingShare: number): number {
  const denom = 1 - margin - platformFee - marketingShare;
  if (denom <= 0) return Infinity;
  return productionCost / denom;
}

/**
 * 反向定价：给定售价，反推实际毛利率
 *
 *   实际毛利率 = 1 − 平台抽成 − 营销/GMV − 生产成本/售价
 *
 * 注意：这里的"毛利率"口径与 suggestedPrice 一致 —— 指的是"扣掉平台和营销后剩下的毛利 / 售价"。
 * 如果实际毛利率 < 0，说明这个售价连平台 + 营销 + 生产成本都覆盖不了。
 */
export function impliedMargin(price: number, productionCost: number, platformFee: number, marketingShare: number): number {
  if (!Number.isFinite(price) || price <= 0) return NaN;
  return 1 - platformFee - marketingShare - productionCost / price;
}

/**
 * 根据 variant 的手动定价开关，返回 { price, margin, isManual } —— 算 GMV/净利润时统一入口
 */
export function resolveVariantPricing(
  variant: BeanVariant,
  productionCost: number,
  bean: Bean,
  platformFee: number,
  marketingShare: number,
  globalMargin?: number,
): { price: number; margin: number; isManual: boolean } {
  if (variant.manualPrice && Number.isFinite(variant.manualPriceValue) && (variant.manualPriceValue ?? 0) > 0) {
    const price = variant.manualPriceValue as number;
    const margin = impliedMargin(price, productionCost, platformFee, marketingShare);
    return { price, margin, isManual: true };
  }
  const margin = globalMargin ?? bean.targetMargin;
  const price = suggestedPrice(productionCost, margin, platformFee, marketingShare);
  return { price, margin, isManual: false };
}

// ==================== 盈利总览（按年） ====================

export interface VariantYearStats {
  beanId: string;
  variantId: string;
  beanName: string;
  variantLabel: string;
  weightG: number;
  annualKg: number;         // 本 variant 年销量 (kg)
  annualPacks: number;      // 本 variant 年销量 (包)
  productionCost: number;   // 单包生产成本（含损耗+物流）
  price: number;            // 售价（手动 or 建议）
  margin: number;           // 实际/目标毛利率
  isManualPrice: boolean;   // 是否手动定价
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
    contributionPerKg: number;
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
 *  6) 售价：手动定价时用 variant.manualPriceValue；否则 = 生产成本 / (1 − margin − platformFee − marketing/GMV)
 *  7) 运营成本按"规格 kg 占比"分摊
 *  8) 退货/破损按 GMV × returnRate 计提
 *  9) 净利润 = GMV − 生产成本 − 运营分摊 − 平台抽成 − 营销 − 退货
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
    const each = enabledBeans.length > 0 ? 1 / enabledBeans.length : 0;
    enabledBeans.forEach((b) => shareMap.set(b.id, each));
    shareSum = enabledBeans.length > 0 ? 1 : 0;
  }

  // 先算每个 variant 的 annualKg
  interface Row {
    bean: Bean;
    variant: BeanVariant;
    annualKg: number;
  }
  const rows: Row[] = [];
  for (const b of enabledBeans) {
    const beanShare = shareSum > 0 ? (shareMap.get(b.id) ?? 0) / shareSum : 0;
    const beanKg = totalKg * beanShare;

    // 归一化 variants
    const vSum = b.variants.reduce((s, v) => s + (v.shareInBean || 0), 0);
    for (const v of b.variants) {
      const vShare = vSum > 0 ? v.shareInBean / vSum : (b.variants.length > 0 ? 1 / b.variants.length : 0);
      rows.push({ bean: b, variant: v, annualKg: beanKg * vShare });
    }
  }

  const kgTotal = rows.reduce((s, r) => s + r.annualKg, 0) || 1;

  // 逐行计算
  // 默认包邮（和 v0.2 行为一致）；不包邮时只把"生产成本中的物流"扣掉，售价不变。
  const freeShipping = profitInputs.freeShipping ?? true;
  const variantStats: VariantYearStats[] = rows.map((r) => {
    // 售价始终按"含物流的成本"推（切换包邮开关时售价保持不变）
    const pcWithLog = packCost(state, r.bean, r.variant, true);
    // 实际计入利润的成本：不包邮时扣掉物流
    const pc = freeShipping ? pcWithLog : packCost(state, r.bean, r.variant, false);
    const { price, margin, isManual } = resolveVariantPricing(
      r.variant,
      pcWithLog.productionCost,
      r.bean,
      platformFee,
      marketingShare,
      profitInputs.globalMargin,
    );
    const packs = r.variant.weightG > 0 ? (r.annualKg * 1000) / r.variant.weightG : 0;

    const gmv = Number.isFinite(price) ? packs * price : 0;
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
      variantLabel: variantLabel(r.variant),
      weightG: r.variant.weightG,
      annualKg: r.annualKg,
      annualPacks: packs,
      productionCost: pc.productionCost,
      price,
      margin,
      isManualPrice: isManual,
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
  let contribPerKgWeighted = 0;
  for (const v of variantStats) {
    const perPackContrib = Number.isFinite(v.price)
      ? v.price * (1 - platformFee - marketingShare - ratios.returnRate) - v.productionCost
      : 0;
    const perKgContrib = v.weightG > 0 ? (perPackContrib * 1000) / v.weightG : 0;
    contribPerKgWeighted += perKgContrib * (v.annualKg / kgTotal);
  }
  const fixedCost = annualOps;
  const breakevenKgPerYear = contribPerKgWeighted > 0 ? fixedCost / contribPerKgWeighted : Infinity;
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
