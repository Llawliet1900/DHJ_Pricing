/**
 * DHJ 咖啡成本与定价核算 — 数据模型
 */

// ============= 成本项 =============
export type CostCategory =
  | 'raw'          // 原料（生豆）
  | 'packaging'    // 包装件
  | 'utilities'    // 水电
  | 'logistics'    // 物流
  | 'oneoff'       // 一次性成本（按摊销年数折算）
  | 'asset'        // 固定资产（按摊销年数折算）
  | 'annual'       // 年度运营成本
  | 'consumable'   // 耗材
  | 'rd'           // 研发/测试
  | 'other';       // 其他

export interface CostItem {
  id: string;
  category: CostCategory;
  name: string;          // 项目名称（如"豆袋"、"烘豆机"、"SC 证办理"）
  note?: string;         // 备注/说明
  unitPrice: number;     // 单价
  unit: string;          // 单位（个、元、kg、元/年 等）
  amortYears?: number;   // 仅 oneoff/asset 有效；按几年摊销
  enabled: boolean;      // 是否启用
}

// ============= 比例参数 =============
export interface Ratios {
  lossSort: number;      // 挑豆/样品损耗（默认 0.05）
  lossRoast: number;     // 烘焙失水（默认 0.15）
  lossPack: number;      // 包装损耗（默认 0.05）
  returnRate: number;    // 退货/破损率（默认 0.01）
  marketingOfGmv: number;// 营销费用占 GMV 比例（默认 0.20）
  // 仅作为"新建豆子"时的默认生豆单价参考
  greenPriceBlendDefault?: number; // 拼配生豆默认单价
  greenPriceSoeDefault?: number;   // SOE 生豆默认单价
}

export interface PlatformRow {
  id: string;
  name: string;          // 平台名，如 微信小程序 / 小红书 / 抖音
  feeRate: number;       // 平台抽成+支付费 综合比例
  salesShare: number;    // 该平台销售占比
}

// ============= 产能 =============
export interface CapacityScenario {
  id: string;
  name: string;           // Low / Mid / High 或自定义
  hoursPerWeek: number;   // 每周工时
  kgPerHour: number;      // 每小时烘焙产出 (kg 熟豆)
  weeksPerYear: number;   // 每年工作周数
}

// ============= 豆子 =============
// 一款豆子下有多个规格（110g / 225g / 自定义）
export interface BeanPackaging {
  costItemId: string;  // 对应 CostItem.id（category=packaging）
  qty: number;         // 用量
}

export interface BeanVariant {
  id: string;
  label?: string;      // 规格名（可选，如 "110g"、"225g"、"1kg"）；空则按克重显示
  weightG: number;     // 熟豆克重
  // 该规格使用的包装组合（默认继承 bean 级别，也可单独覆盖）
  packagingOverride?: BeanPackaging[];
  logisticsCostItemId?: string; // 默认取全局快递费
  shareInBean: number; // 该规格在本款豆子内的销量占比（0-1），同一 bean 下合计需 =1

  // 手动定价（反向定价）：
  //   manualPrice = true 时，使用 manualPriceValue 作为售价；
  //   实际毛利率 = 1 - platformFee - marketing/GMV - 生产成本/售价
  manualPrice?: boolean;
  manualPriceValue?: number;
}

export interface Bean {
  id: string;
  name: string;              // 九尾 / 朏胐 / 精卫 / 鸾鸟
  type: 'blend' | 'soe';     // 拼配 / 单品
  // 生豆价：每款豆子独立维护（元/kg）
  greenPricePerKg: number;
  // rawCostItemId 保留用于兼容/引用（比如"分类名称"），但价格以 greenPricePerKg 为准
  rawCostItemId?: string;
  // 默认包装组合（被 variants 继承，除非 variant 覆盖）
  packaging: BeanPackaging[];
  variants: BeanVariant[];
  targetMargin: number;      // 目标毛利率（0-1），可单独设；总览页也可全局覆盖
  enabled: boolean;
}

// ============= 盈利总览输入 =============
export interface BeanShare {
  beanId: string;
  share: number; // 0-1，该款豆子在总产能里的销量占比（按熟豆 kg 计）
}

export interface ProfitInputs {
  scenarioId: string;        // 选用哪个产能情景
  beanShares: BeanShare[];   // 各款豆子产能占比
  globalMargin?: number;     // 可选：全局覆盖 targetMargin
}

// ============= 顶层状态 =============
export interface AppState {
  costItems: CostItem[];
  ratios: Ratios;
  platforms: PlatformRow[];
  scenarios: CapacityScenario[];
  beans: Bean[];
  profitInputs: ProfitInputs;
  // 全局的"快递单费"快捷引用（物流类的默认项）
  defaultLogisticsCostItemId: string | null;
  // 运营成本分摊里，一次性成本用哪个默认摊销年数（仅作为 UI hint）
  meta: {
    createdAt: string;
    updatedAt: string;
    version: number;
  };
}
