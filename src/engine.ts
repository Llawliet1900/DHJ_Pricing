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
  SalesOrder,
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

// ==================== 实销分析（Sales） ====================

/** 一行汇总（按 bean × variant 聚合，或仅按 bean 聚合时 variantId 为 null） */
export interface SalesAggRow {
  beanId: string;
  variantId: string | null;
  beanName: string;
  variantLabel: string;
  quantity: number;          // 总袋数
  grossRevenue: number;      // Σ 支付金额（GMV）
  netRevenue: number;        // GMV × (1 - 平台佣金率)
  unitPriceAvg: number;      // 加权均价 = grossRevenue / quantity
  variableCost: number;      // Σ (单包变动成本 × 袋数)
  marketing: number;         // GMV × marketingOfGmv
  grossProfit: number;       // netRevenue - variableCost - marketing
  orderCount: number;        // 涉及订单数（去重 orderId）
}

/** 过滤订单到时间窗口 */
export function filterOrdersByWindow(
  orders: SalesOrder[],
  mode: 'all' | 'days' | 'custom',
  windowDays: number,
  customStart?: string,
  customEnd?: string,
): SalesOrder[] {
  if (orders.length === 0) return [];
  if (mode === 'all') return orders;
  const dates = orders.map((o) => +new Date(o.paidAt));
  const maxT = Math.max(...dates);
  if (mode === 'days') {
    const cutoff = maxT - (windowDays - 1) * 86400_000;
    return orders.filter((o) => +new Date(o.paidAt) >= cutoff);
  }
  // custom
  const s = customStart ? +new Date(customStart) : -Infinity;
  const e = customEnd ? +new Date(customEnd) + 86400_000 - 1 : Infinity;
  return orders.filter((o) => {
    const t = +new Date(o.paidAt);
    return t >= s && t <= e;
  });
}

/** 实际跨越的天数 = ceil((max - min) / day) + 1，至少为 1 */
export function spanDays(orders: SalesOrder[]): number {
  if (orders.length === 0) return 0;
  const ts = orders.map((o) => +new Date(o.paidAt));
  const min = Math.min(...ts);
  const max = Math.max(...ts);
  return Math.max(1, Math.floor((max - min) / 86400_000) + 1);
}

/**
 * 按 bean × variant 聚合订单。
 *  - 变动成本采用 packCost(includeLogistics) 即"含/不含物流"
 *  - 平台佣金率取 state.sales.platformConfig.defaultFeeRate
 *  - 营销按 GMV × ratios.marketingOfGmv
 *  - 未映射的订单（specMapping.unmapped=true 或缺映射）会被跳过
 */
export function aggregateSales(
  state: AppState,
  orders: SalesOrder[],
  includeLogistics: boolean,
): { rows: SalesAggRow[]; unmappedCount: number; skipped: SalesOrder[] } {
  const feeRate = state.sales.platformConfig.defaultFeeRate;
  const mktRate = state.ratios.marketingOfGmv;
  const mappingBySpec = new Map(state.sales.specMappings.map((m) => [m.specId, m]));

  type Key = string;
  const map = new Map<Key, { beanId: string; variantId: string; orderIds: Set<string>; q: number; gross: number; varCost: number }>();
  const skipped: SalesOrder[] = [];

  for (const o of orders) {
    const m = mappingBySpec.get(o.specId);
    if (!m || m.unmapped || !m.beanId || !m.variantId) {
      skipped.push(o);
      continue;
    }
    const bean = state.beans.find((b) => b.id === m.beanId);
    const variant = bean?.variants.find((v) => v.id === m.variantId);
    if (!bean || !variant) {
      skipped.push(o);
      continue;
    }
    const pc = packCost(state, bean, variant, includeLogistics);
    const key = `${bean.id}__${variant.id}`;
    let cell = map.get(key);
    if (!cell) {
      cell = { beanId: bean.id, variantId: variant.id, orderIds: new Set(), q: 0, gross: 0, varCost: 0 };
      map.set(key, cell);
    }
    cell.orderIds.add(o.orderId);
    cell.q += o.quantity;
    cell.gross += o.grossAmount;
    cell.varCost += pc.productionCost * o.quantity;
  }

  const rows: SalesAggRow[] = [];
  for (const cell of map.values()) {
    const bean = state.beans.find((b) => b.id === cell.beanId);
    const variant = bean?.variants.find((v) => v.id === cell.variantId);
    if (!bean || !variant) continue;
    const netRev = cell.gross * (1 - feeRate);
    const mkt = cell.gross * mktRate;
    rows.push({
      beanId: cell.beanId,
      variantId: cell.variantId,
      beanName: bean.name,
      variantLabel: variantLabel(variant),
      quantity: cell.q,
      grossRevenue: cell.gross,
      netRevenue: netRev,
      unitPriceAvg: cell.q > 0 ? cell.gross / cell.q : 0,
      variableCost: cell.varCost,
      marketing: mkt,
      grossProfit: netRev - cell.varCost - mkt,
      orderCount: cell.orderIds.size,
    });
  }
  // 排序：按豆子顺序 + 规格顺序
  const beanOrder = new Map(state.beans.map((b, i) => [b.id, i]));
  rows.sort((a, b) => {
    const ba = beanOrder.get(a.beanId) ?? 999;
    const bb = beanOrder.get(b.beanId) ?? 999;
    if (ba !== bb) return ba - bb;
    return a.variantLabel.localeCompare(b.variantLabel);
  });
  return { rows, unmappedCount: skipped.length, skipped };
}

/** 累计实销摘要 */
export interface SalesSummary {
  rows: SalesAggRow[];
  totals: {
    quantity: number;
    grossRevenue: number;       // 累计 GMV
    netRevenue: number;          // 扣平台佣金后
    variableCost: number;
    marketing: number;
    grossProfit: number;         // = netRevenue - variableCost - marketing
    // 运营摊销（两个口径）
    operationByDays: number;     // 年度运营 × (销售天数/365)
    operationByVolume: number;   // 年度运营 × (累计 kg / 当前情景产能 kg)
    netProfitByDays: number;     // grossProfit - operationByDays
    netProfitByVolume: number;   // grossProfit - operationByVolume
  };
  spanDays: number;
  unmappedCount: number;
}

export function computeSalesSummary(
  state: AppState,
  orders: SalesOrder[],
  includeLogistics: boolean,
): SalesSummary {
  const agg = aggregateSales(state, orders, includeLogistics);
  const totalQ = agg.rows.reduce((s, r) => s + r.quantity, 0);
  const totalGmv = agg.rows.reduce((s, r) => s + r.grossRevenue, 0);
  const totalNet = agg.rows.reduce((s, r) => s + r.netRevenue, 0);
  const totalVar = agg.rows.reduce((s, r) => s + r.variableCost, 0);
  const totalMkt = agg.rows.reduce((s, r) => s + r.marketing, 0);
  const grossProfit = totalNet - totalVar - totalMkt;

  const opAnnual = annualOperationCost(state).total;
  const days = spanDays(orders);
  const operationByDays = days > 0 ? opAnnual * (days / 365) : 0;

  // 累计已售熟豆 kg
  const totalKg = agg.rows.reduce((s, r) => {
    const bean = state.beans.find((b) => b.id === r.beanId);
    const variant = bean?.variants.find((v) => v.id === r.variantId);
    return s + (variant ? (variant.weightG * r.quantity) / 1000 : 0);
  }, 0);
  const sc = state.scenarios.find((x) => x.id === state.profitInputs.scenarioId);
  const scKgYear = sc ? capacityKgPerYear(sc) : 0;
  const operationByVolume = scKgYear > 0 ? opAnnual * (totalKg / scKgYear) : 0;

  return {
    rows: agg.rows,
    totals: {
      quantity: totalQ,
      grossRevenue: totalGmv,
      netRevenue: totalNet,
      variableCost: totalVar,
      marketing: totalMkt,
      grossProfit,
      operationByDays,
      operationByVolume,
      netProfitByDays: grossProfit - operationByDays,
      netProfitByVolume: grossProfit - operationByVolume,
    },
    spanDays: days,
    unmappedCount: agg.unmappedCount,
  };
}

/** 跑速年化：取窗口内日均，× 365；运营成本扣全年 */
export interface RunRateProjection {
  windowOrders: number;
  windowDays: number;
  windowGmv: number;
  windowQuantity: number;
  dailyGmv: number;
  dailyQuantity: number;
  // 年化指标
  annualGmv: number;
  annualNetRevenue: number;
  annualVariableCost: number;
  annualMarketing: number;
  annualGrossProfit: number;
  annualOperation: number;       // 全年运营成本
  annualNetProfit: number;
  // 按豆款 × 规格的年化销量（袋）
  perVariantAnnualQty: { beanId: string; variantId: string; beanName: string; variantLabel: string; annualQty: number; annualKg: number }[];
}

export function computeRunRate(
  state: AppState,
  orders: SalesOrder[],
  includeLogistics: boolean,
): RunRateProjection {
  const days = spanDays(orders);
  const safeDays = days || 1;
  const agg = aggregateSales(state, orders, includeLogistics);
  const winGmv = agg.rows.reduce((s, r) => s + r.grossRevenue, 0);
  const winQ = agg.rows.reduce((s, r) => s + r.quantity, 0);
  const winVar = agg.rows.reduce((s, r) => s + r.variableCost, 0);

  const feeRate = state.sales.platformConfig.defaultFeeRate;
  const mktRate = state.ratios.marketingOfGmv;

  const dailyGmv = winGmv / safeDays;
  const dailyQ = winQ / safeDays;

  const annualGmv = dailyGmv * 365;
  const annualNet = annualGmv * (1 - feeRate);
  const annualVar = (winVar / safeDays) * 365;
  const annualMkt = annualGmv * mktRate;
  const annualGP = annualNet - annualVar - annualMkt;
  const annualOp = annualOperationCost(state).total;

  const perVariant = agg.rows.map((r) => {
    const bean = state.beans.find((b) => b.id === r.beanId)!;
    const variant = bean.variants.find((v) => v.id === r.variantId!)!;
    const annualQty = (r.quantity / safeDays) * 365;
    return {
      beanId: r.beanId,
      variantId: r.variantId!,
      beanName: r.beanName,
      variantLabel: r.variantLabel,
      annualQty,
      annualKg: (annualQty * variant.weightG) / 1000,
    };
  });

  return {
    windowOrders: orders.length,
    windowDays: days,
    windowGmv: winGmv,
    windowQuantity: winQ,
    dailyGmv,
    dailyQuantity: dailyQ,
    annualGmv,
    annualNetRevenue: annualNet,
    annualVariableCost: annualVar,
    annualMarketing: annualMkt,
    annualGrossProfit: annualGP,
    annualOperation: annualOp,
    annualNetProfit: annualGP - annualOp,
    perVariantAnnualQty: perVariant,
  };
}

/** 根据商品名/规格名启发式自动映射 specId → beanId+variantId */
export function autoMatchSpec(
  state: AppState,
  productName: string,
  specName: string,
): { beanId: string | null; variantId: string | null } {
  // 1. 匹配豆款：商品名里包含豆子 name
  const bean = state.beans.find((b) => productName.includes(b.name) || specName.includes(b.name));
  if (!bean) return { beanId: null, variantId: null };
  // 2. 匹配规格：从规格名里找 "Ng" 数字 g
  const m = specName.match(/(\d+)\s*g/i);
  if (!m) return { beanId: bean.id, variantId: null };
  const targetG = parseInt(m[1], 10);
  const variant = bean.variants.find((v) => v.weightG === targetG);
  return { beanId: bean.id, variantId: variant?.id ?? null };
}

