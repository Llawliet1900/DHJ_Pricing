import type { AppState, Bean, CostItem } from './types';

const uid = (() => {
  let n = 0;
  return (p = 'id') => `${p}_${Date.now().toString(36)}_${(n++).toString(36)}`;
})();

// ============ 成本项种子 ============
// 来源：用户原 Excel 《成本及定价核算.xlsx》 + 本次约定的新包装件清单
// 新包装件：豆袋 / 贴纸 / 小卡 / 角贴 / 蜂窝纸 / 快递盒 / 胶带
const costItems: CostItem[] = [
  // ---- 原料（生豆）：这里保留作为"分类名称"引用，真实价格以每款豆子自带 greenPricePerKg 为准 ----
  { id: 'ci_raw_blend', category: 'raw', name: '拼配生豆', note: '默认分类，真实单价见豆子页', unitPrice: 120, unit: '元/kg', enabled: true },
  { id: 'ci_raw_soe',   category: 'raw', name: 'SOE 生豆',  note: '默认分类，真实单价见豆子页', unitPrice: 150, unit: '元/kg', enabled: true },

  // ---- 包装件（新清单） ----
  { id: 'ci_pkg_bag',     category: 'packaging', name: '豆袋',   unitPrice: 1.2,  unit: '元/个', enabled: true },
  { id: 'ci_pkg_sticker', category: 'packaging', name: '贴纸',   unitPrice: 0.3,  unit: '元/张', enabled: true },
  { id: 'ci_pkg_card',    category: 'packaging', name: '小卡',   unitPrice: 0.5,  unit: '元/张', enabled: true },
  { id: 'ci_pkg_corner',  category: 'packaging', name: '角贴',   unitPrice: 0.2,  unit: '元/个', enabled: true },
  { id: 'ci_pkg_honey',   category: 'packaging', name: '蜂窝纸', unitPrice: 0.6,  unit: '元/张', enabled: true },
  { id: 'ci_pkg_box',     category: 'packaging', name: '快递盒', unitPrice: 1.5,  unit: '元/个', enabled: true },
  { id: 'ci_pkg_tape',    category: 'packaging', name: '胶带',   unitPrice: 0.3,  unit: '元/单', enabled: true },

  // ---- 水电 ----
  { id: 'ci_util_elec', category: 'utilities', name: '电费(分摊到单包)', unitPrice: 1.0, unit: '元/包', enabled: true },

  // ---- 物流 ----
  { id: 'ci_log_express', category: 'logistics', name: '快递费', note: '每单均价，含外箱运输', unitPrice: 15, unit: '元/单', enabled: true },

  // ---- 一次性成本（按摊销年数折算到年） ----
  { id: 'ci_oneoff_register', category: 'oneoff', name: '公司注册',   unitPrice: 3000,  unit: '元', amortYears: 4,  enabled: true },
  { id: 'ci_oneoff_trademark',category: 'oneoff', name: '商标注册',   unitPrice: 2000,  unit: '元', amortYears: 10, enabled: true },
  { id: 'ci_oneoff_scmod',    category: 'oneoff', name: 'SC 证办理+场地改造', note: '排烟/地面等隐性成本', unitPrice: 15000, unit: '元', amortYears: 5, enabled: true },

  // ---- 固定资产 ----
  { id: 'ci_asset_roaster', category: 'asset', name: '烘豆机', unitPrice: 20000, unit: '元', amortYears: 5, enabled: true },

  // ---- 年度运营 ----
  { id: 'ci_ann_account',   category: 'annual', name: '代理记账',   unitPrice: 3000, unit: '元/年', enabled: true },
  { id: 'ci_ann_sc_annual', category: 'annual', name: 'SC 年检',    unitPrice: 500,  unit: '元/年', enabled: true },
  { id: 'ci_ann_insurance', category: 'annual', name: '产品责任险', unitPrice: 3000, unit: '元/年', enabled: true },
  { id: 'ci_ann_photo',     category: 'annual', name: '摄影/设计',  unitPrice: 5000, unit: '元/年', enabled: true },

  // ---- 耗材 ----
  { id: 'ci_cons_cupping', category: 'consumable', name: '杯测/样品豆', note: '每月留样/杯测消耗', unitPrice: 2000, unit: '元/年', enabled: true },

  // ---- 研发 ----
  { id: 'ci_rd', category: 'rd', name: '新品研发', unitPrice: 3000, unit: '元/年', enabled: true },
];

const DEFAULT_PACKAGING = [
  { costItemId: 'ci_pkg_bag',     qty: 1 },
  { costItemId: 'ci_pkg_sticker', qty: 1 },
  { costItemId: 'ci_pkg_card',    qty: 1 },
  { costItemId: 'ci_pkg_corner',  qty: 1 },
  { costItemId: 'ci_pkg_honey',   qty: 1 },
  { costItemId: 'ci_pkg_box',     qty: 1 },
  { costItemId: 'ci_pkg_tape',    qty: 1 },
];

// 每款豆子默认：两个规格 110g / 225g，包装 7 件，目标毛利 50%
function makeBean(opts: { id: string; name: string; type: 'blend' | 'soe'; greenPrice: number }): Bean {
  return {
    id: opts.id,
    name: opts.name,
    type: opts.type,
    greenPricePerKg: opts.greenPrice,
    rawCostItemId: opts.type === 'blend' ? 'ci_raw_blend' : 'ci_raw_soe',
    packaging: [...DEFAULT_PACKAGING],
    variants: [
      { id: `${opts.id}_v110`, label: '110g', weightG: 110, shareInBean: 0.6 },
      { id: `${opts.id}_v225`, label: '225g', weightG: 225, shareInBean: 0.4 },
    ],
    targetMargin: 0.5,
    enabled: true,
  };
}

export const defaultState: AppState = {
  costItems,

  ratios: {
    lossSort: 0.05,
    lossRoast: 0.15,
    lossPack: 0.05,
    returnRate: 0.01,
    marketingOfGmv: 0.20,
    greenPriceBlendDefault: 120,
    greenPriceSoeDefault: 150,
  },

  // 平台拆分（默认：全部在微信小程序卖，可改）
  platforms: [
    { id: 'pf_wx',  name: '微信小程序', feeRate: 0.01, salesShare: 1.0 },
    { id: 'pf_xhs', name: '小红书',     feeRate: 0.05, salesShare: 0   },
    { id: 'pf_dy',  name: '抖音',       feeRate: 0.06, salesShare: 0   },
  ],

  // 3 个产能情景
  scenarios: [
    { id: 'sc_low',  name: 'Low',  hoursPerWeek: 4,  kgPerHour: 3, weeksPerYear: 40 },
    { id: 'sc_mid',  name: 'Mid',  hoursPerWeek: 8,  kgPerHour: 3, weeksPerYear: 55 },
    { id: 'sc_high', name: 'High', hoursPerWeek: 10, kgPerHour: 3, weeksPerYear: 60 },
  ],

  // 默认 4 款豆子：每款独立生豆单价（可到 Tab4 改）
  beans: [
    makeBean({ id: 'bn_jiuwei',   name: '九尾',  type: 'blend', greenPrice: 120 }),
    makeBean({ id: 'bn_feihu',    name: '朏胐',  type: 'blend', greenPrice: 120 }),
    makeBean({ id: 'bn_jingwei',  name: '精卫',  type: 'soe',   greenPrice: 150 }),
    makeBean({ id: 'bn_luanniao', name: '鸾鸟',  type: 'soe',   greenPrice: 150 }),
  ],

  profitInputs: {
    scenarioId: 'sc_mid',
    beanShares: [
      { beanId: 'bn_jiuwei',   share: 0.25 },
      { beanId: 'bn_feihu',    share: 0.25 },
      { beanId: 'bn_jingwei',  share: 0.25 },
      { beanId: 'bn_luanniao', share: 0.25 },
    ],
    globalMargin: undefined,
  },

  defaultLogisticsCostItemId: 'ci_log_express',

  meta: {
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    version: 2,
  },
};

export { uid, DEFAULT_PACKAGING };
