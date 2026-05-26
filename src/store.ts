import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AppState,
  Bean,
  BeanVariant,
  CostItem,
  PlatformRow,
  CapacityScenario,
  Ratios,
  ProfitInputs,
  BeanPackaging,
  SalesOrder,
  SpecMapping,
  SalesAnalysisInputs,
  SalesPlatformConfig,
} from './types';
import { defaultState, uid, DEFAULT_PACKAGING } from './seed';

interface Actions {
  // 成本项
  addCostItem: (item?: Partial<CostItem>) => void;
  updateCostItem: (id: string, patch: Partial<CostItem>) => void;
  deleteCostItem: (id: string) => void;
  moveCostItem: (id: string, dir: -1 | 1) => void;

  // 比例
  updateRatios: (patch: Partial<Ratios>) => void;

  // 平台
  addPlatform: () => void;
  updatePlatform: (id: string, patch: Partial<PlatformRow>) => void;
  deletePlatform: (id: string) => void;

  // 产能
  addScenario: () => void;
  updateScenario: (id: string, patch: Partial<CapacityScenario>) => void;
  deleteScenario: (id: string) => void;

  // 豆子
  addBean: () => void;
  updateBean: (id: string, patch: Partial<Bean>) => void;
  deleteBean: (id: string) => void;
  moveBean: (id: string, dir: -1 | 1) => void;
  // 包装
  setBeanPackaging: (beanId: string, packaging: BeanPackaging[]) => void;
  // 变体（规格）
  addVariant: (beanId: string) => void;
  updateVariant: (beanId: string, variantId: string, patch: Partial<BeanVariant>) => void;
  deleteVariant: (beanId: string, variantId: string) => void;
  duplicateVariant: (beanId: string, variantId: string) => void;

  // 盈利页输入
  updateProfitInputs: (patch: Partial<ProfitInputs>) => void;
  setBeanShare: (beanId: string, share: number) => void;

  // 全局
  setDefaultLogistics: (id: string | null) => void;

  // 实销分析
  importSalesOrders: (incoming: SalesOrder[], fileMeta: { name: string; rangeStart?: string; rangeEnd?: string; rows: number }) => { added: number; duplicates: number };
  clearSalesOrders: () => void;
  upsertSpecMappings: (mappings: SpecMapping[]) => void;
  updateSpecMapping: (specId: string, patch: Partial<SpecMapping>) => void;
  updateSalesAnalysis: (patch: Partial<SalesAnalysisInputs>) => void;
  updateSalesPlatform: (patch: Partial<SalesPlatformConfig>) => void;

  // 导入导出
  exportJson: () => string;
  importJson: (text: string) => { ok: boolean; message: string };
  resetToDefault: () => void;
}

type Store = AppState & Actions;

export const useStore = create<Store>()(
  persist(
    (set, get) => ({
      ...defaultState,

      // ========== 成本项 ==========
      addCostItem: (item) =>
        set((s) => {
          const newItem: CostItem = {
            id: uid('ci'),
            category: 'other',
            name: '新成本项',
            unitPrice: 0,
            unit: '元',
            enabled: true,
            ...item,
          };
          return { costItems: [...s.costItems, newItem], meta: bumpMeta(s) };
        }),
      updateCostItem: (id, patch) =>
        set((s) => ({
          costItems: s.costItems.map((c) => (c.id === id ? { ...c, ...patch } : c)),
          meta: bumpMeta(s),
        })),
      deleteCostItem: (id) =>
        set((s) => ({
          costItems: s.costItems.filter((c) => c.id !== id),
          meta: bumpMeta(s),
        })),
      moveCostItem: (id, dir) =>
        set((s) => ({
          costItems: moveArr(s.costItems, id, dir),
          meta: bumpMeta(s),
        })),

      // ========== 比例 ==========
      updateRatios: (patch) =>
        set((s) => ({ ratios: { ...s.ratios, ...patch }, meta: bumpMeta(s) })),

      // ========== 平台 ==========
      addPlatform: () =>
        set((s) => ({
          platforms: [...s.platforms, { id: uid('pf'), name: '新平台', feeRate: 0.05, salesShare: 0 }],
          meta: bumpMeta(s),
        })),
      updatePlatform: (id, patch) =>
        set((s) => ({ platforms: s.platforms.map((p) => (p.id === id ? { ...p, ...patch } : p)), meta: bumpMeta(s) })),
      deletePlatform: (id) =>
        set((s) => ({ platforms: s.platforms.filter((p) => p.id !== id), meta: bumpMeta(s) })),

      // ========== 产能 ==========
      addScenario: () =>
        set((s) => ({
          scenarios: [...s.scenarios, { id: uid('sc'), name: `情景${s.scenarios.length + 1}`, hoursPerWeek: 8, kgPerHour: 3, weeksPerYear: 50 }],
          meta: bumpMeta(s),
        })),
      updateScenario: (id, patch) =>
        set((s) => ({ scenarios: s.scenarios.map((x) => (x.id === id ? { ...x, ...patch } : x)), meta: bumpMeta(s) })),
      deleteScenario: (id) =>
        set((s) => ({
          scenarios: s.scenarios.filter((x) => x.id !== id),
          profitInputs: s.profitInputs.scenarioId === id
            ? { ...s.profitInputs, scenarioId: (s.scenarios.find((x) => x.id !== id)?.id) ?? '' }
            : s.profitInputs,
          meta: bumpMeta(s),
        })),

      // ========== 豆子 ==========
      addBean: () =>
        set((s) => {
          const id = uid('bn');
          const defaultType: 'blend' | 'soe' = 'blend';
          const defaultGreen =
            defaultType === 'blend'
              ? s.ratios.greenPriceBlendDefault ?? 120
              : s.ratios.greenPriceSoeDefault ?? 150;
          const bean: Bean = {
            id,
            name: `新豆款 ${s.beans.length + 1}`,
            type: defaultType,
            greenPricePerKg: defaultGreen,
            rawCostItemId: 'ci_raw_blend',
            packaging: [...DEFAULT_PACKAGING],
            variants: [
              { id: uid('var'), label: '110g', weightG: 110, shareInBean: 0.6 },
              { id: uid('var'), label: '225g', weightG: 225, shareInBean: 0.4 },
            ],
            targetMargin: 0.5,
            enabled: true,
          };
          return {
            beans: [bean, ...s.beans],
            profitInputs: {
              ...s.profitInputs,
              beanShares: [{ beanId: id, share: 0 }, ...s.profitInputs.beanShares],
            },
            meta: bumpMeta(s),
          };
        }),
      updateBean: (id, patch) =>
        set((s) => ({
          beans: s.beans.map((b) => {
            if (b.id !== id) return b;
            const next = { ...b, ...patch };
            // 如果切换了 type，默认 rawCostItemId 跟着换（用户可再手动改）
            if (patch.type && patch.type !== b.type) {
              next.rawCostItemId = patch.type === 'blend' ? 'ci_raw_blend' : 'ci_raw_soe';
            }
            return next;
          }),
          meta: bumpMeta(s),
        })),
      deleteBean: (id) =>
        set((s) => ({
          beans: s.beans.filter((b) => b.id !== id),
          profitInputs: {
            ...s.profitInputs,
            beanShares: s.profitInputs.beanShares.filter((x) => x.beanId !== id),
          },
          meta: bumpMeta(s),
        })),
      moveBean: (id, dir) =>
        set((s) => ({
          beans: moveArr(s.beans, id, dir),
          meta: bumpMeta(s),
        })),
      setBeanPackaging: (beanId, packaging) =>
        set((s) => ({ beans: s.beans.map((b) => (b.id === beanId ? { ...b, packaging } : b)), meta: bumpMeta(s) })),

      addVariant: (beanId) =>
        set((s) => ({
          beans: s.beans.map((b) => {
            if (b.id !== beanId) return b;
            // 复制最后一个 variant 作为模板，只清空占比让用户重新分配
            const last = b.variants[b.variants.length - 1];
            const newV: BeanVariant = last
              ? {
                  id: uid('var'),
                  label: `${last.weightG}g (copy)`,
                  weightG: last.weightG,
                  shareInBean: 0,
                  packagingOverride: last.packagingOverride ? [...last.packagingOverride] : undefined,
                  logisticsCostItemId: last.logisticsCostItemId,
                  manualPrice: false,
                }
              : { id: uid('var'), label: '新规格', weightG: 110, shareInBean: 0 };
            return { ...b, variants: [...b.variants, newV] };
          }),
          meta: bumpMeta(s),
        })),
      updateVariant: (beanId, variantId, patch) =>
        set((s) => ({
          beans: s.beans.map((b) =>
            b.id === beanId
              ? { ...b, variants: b.variants.map((v) => (v.id === variantId ? { ...v, ...patch } : v)) }
              : b,
          ),
          meta: bumpMeta(s),
        })),
      deleteVariant: (beanId, variantId) =>
        set((s) => ({
          beans: s.beans.map((b) =>
            b.id === beanId ? { ...b, variants: b.variants.filter((v) => v.id !== variantId) } : b,
          ),
          meta: bumpMeta(s),
        })),
      duplicateVariant: (beanId, variantId) =>
        set((s) => ({
          beans: s.beans.map((b) => {
            if (b.id !== beanId) return b;
            const src = b.variants.find((v) => v.id === variantId);
            if (!src) return b;
            const copy: BeanVariant = {
              ...src,
              id: uid('var'),
              label: (src.label || `${src.weightG}g`) + ' 副本',
              shareInBean: 0,
              packagingOverride: src.packagingOverride ? [...src.packagingOverride] : undefined,
            };
            return { ...b, variants: [...b.variants, copy] };
          }),
          meta: bumpMeta(s),
        })),

      // ========== 盈利输入 ==========
      updateProfitInputs: (patch) =>
        set((s) => ({ profitInputs: { ...s.profitInputs, ...patch }, meta: bumpMeta(s) })),
      setBeanShare: (beanId, share) =>
        set((s) => {
          const exists = s.profitInputs.beanShares.find((x) => x.beanId === beanId);
          const beanShares = exists
            ? s.profitInputs.beanShares.map((x) => (x.beanId === beanId ? { ...x, share } : x))
            : [...s.profitInputs.beanShares, { beanId, share }];
          return { profitInputs: { ...s.profitInputs, beanShares }, meta: bumpMeta(s) };
        }),

      // ========== 全局 ==========
      setDefaultLogistics: (id) =>
        set((s) => ({ defaultLogisticsCostItemId: id, meta: bumpMeta(s) })),

      // ========== 实销分析 ==========
      importSalesOrders: (incoming, fileMeta) => {
        let added = 0;
        let duplicates = 0;
        set((s) => {
          const existing = s.sales.orders;
          const keyOf = (o: SalesOrder) => `${o.orderId}__${o.specId}`;
          const map = new Map<string, SalesOrder>();
          for (const o of existing) map.set(keyOf(o), o);
          for (const o of incoming) {
            const k = keyOf(o);
            if (map.has(k)) duplicates++;
            else added++;
            map.set(k, o);
          }
          const merged = Array.from(map.values()).sort(
            (a, b) => +new Date(a.paidAt) - +new Date(b.paidAt),
          );

          // 自动建立 specMappings：新出现的 specId 尝试自动匹配
          const knownSpecIds = new Set(s.sales.specMappings.map((m) => m.specId));
          const newSpecIds = new Map<string, { productName: string; specName: string }>();
          for (const o of incoming) {
            if (!knownSpecIds.has(o.specId) && !newSpecIds.has(o.specId)) {
              newSpecIds.set(o.specId, { productName: o.productName, specName: o.specName });
            }
          }
          const newMappings: SpecMapping[] = [];
          for (const [specId, meta] of newSpecIds) {
            const matched = autoMatchInline(s.beans, meta.productName, meta.specName);
            newMappings.push({
              specId,
              beanId: matched.beanId,
              variantId: matched.variantId,
              unmapped: !matched.beanId || !matched.variantId,
              productName: meta.productName,
              specName: meta.specName,
            });
          }

          // salesStartDate = min(paidAt) across all orders
          const allDates = merged.map((o) => o.paidAt);
          const salesStartDate = allDates.length > 0 ? allDates[0].slice(0, 10) : undefined;

          // 文件登记
          const importedFiles = [
            ...s.sales.importedFiles.filter((f) => f.name !== fileMeta.name),
            {
              name: fileMeta.name,
              rangeStart: fileMeta.rangeStart,
              rangeEnd: fileMeta.rangeEnd,
              rows: fileMeta.rows,
              importedAt: new Date().toISOString(),
            },
          ];

          return {
            sales: {
              ...s.sales,
              orders: merged,
              specMappings: [...s.sales.specMappings, ...newMappings],
              importedFiles,
              salesStartDate,
            },
            meta: bumpMeta(s),
          };
        });
        return { added, duplicates };
      },
      clearSalesOrders: () =>
        set((s) => ({
          sales: { ...s.sales, orders: [], importedFiles: [], salesStartDate: undefined },
          meta: bumpMeta(s),
        })),
      upsertSpecMappings: (mappings) =>
        set((s) => {
          const map = new Map(s.sales.specMappings.map((m) => [m.specId, m]));
          for (const m of mappings) map.set(m.specId, m);
          return { sales: { ...s.sales, specMappings: Array.from(map.values()) }, meta: bumpMeta(s) };
        }),
      updateSpecMapping: (specId, patch) =>
        set((s) => ({
          sales: {
            ...s.sales,
            specMappings: s.sales.specMappings.map((m) =>
              m.specId === specId
                ? { ...m, ...patch, unmapped: !(patch.beanId ?? m.beanId) || !(patch.variantId ?? m.variantId) }
                : m,
            ),
          },
          meta: bumpMeta(s),
        })),
      updateSalesAnalysis: (patch) =>
        set((s) => ({ sales: { ...s.sales, analysis: { ...s.sales.analysis, ...patch } }, meta: bumpMeta(s) })),
      updateSalesPlatform: (patch) =>
        set((s) => ({ sales: { ...s.sales, platformConfig: { ...s.sales.platformConfig, ...patch } }, meta: bumpMeta(s) })),

      // ========== 导入导出 ==========
      exportJson: () => {
        const { costItems, ratios, platforms, scenarios, beans, profitInputs, defaultLogisticsCostItemId, sales, meta } = get();
        return JSON.stringify(
          { costItems, ratios, platforms, scenarios, beans, profitInputs, defaultLogisticsCostItemId, sales, meta },
          null,
          2,
        );
      },
      importJson: (text) => {
        try {
          const data = JSON.parse(text);
          if (!data.costItems || !data.beans || !data.scenarios) {
            return { ok: false, message: '文件格式不符合 DHJ 核算数据结构' };
          }
          // 兼容旧数据：beans 可能没有 greenPricePerKg，尝试从 costItems 里取
          const migratedBeans: Bean[] = (data.beans as Bean[]).map((b) => migrateBean(b, data.costItems));
          set((s) => ({
            costItems: data.costItems,
            ratios: { ...s.ratios, ...(data.ratios ?? {}) },
            platforms: data.platforms ?? s.platforms,
            scenarios: data.scenarios,
            beans: migratedBeans,
            profitInputs: data.profitInputs ?? s.profitInputs,
            defaultLogisticsCostItemId: data.defaultLogisticsCostItemId ?? s.defaultLogisticsCostItemId,
            // sales 字段：v0.4 新加，老 JSON 文件里可能没有，缺失时保留当前 state 的 sales（不要清空已有订单）
            sales: data.sales ?? s.sales,
            meta: bumpMeta(s),
          }));
          return { ok: true, message: '导入成功' };
        } catch (e) {
          return { ok: false, message: 'JSON 解析失败: ' + (e as Error).message };
        }
      },
      resetToDefault: () => set(() => ({ ...defaultState, meta: { ...defaultState.meta, updatedAt: new Date().toISOString() } })),
    }),
    {
      name: 'dhj-cost-calc',
      version: 3,
      // 老版本 localStorage 数据迁移
      //  v1 → v2: 豆子没有 greenPricePerKg，从 costItems 取
      //  v2 → v3: 增加 sales 字段（实销分析）
      migrate: (persistedState: unknown, version: number): Store => {
        const state = persistedState as AppState;
        if (!state) return defaultState as Store;
        let next = state as Store;
        if (version < 2) {
          const beans = (next.beans ?? []).map((b) => migrateBean(b, next.costItems ?? []));
          next = {
            ...next,
            beans,
            meta: { ...(next.meta ?? defaultState.meta), version: 2 },
          };
        }
        if (version < 3) {
          // 没有 sales 字段的老数据，注入默认 sales
          if (!(next as Partial<AppState>).sales) {
            next = {
              ...next,
              sales: defaultState.sales,
              meta: { ...(next.meta ?? defaultState.meta), version: 3 },
            };
          }
        }
        return next;
      },
    },
  ),
);

// ============ 迁移 / 兼容 ============
function migrateBean(b: Bean, costItems: CostItem[]): Bean {
  let greenPrice = (b as Partial<Bean>).greenPricePerKg;
  if (greenPrice === undefined || greenPrice === null) {
    const ci = costItems.find((c) => c.id === b.rawCostItemId);
    greenPrice = ci?.unitPrice ?? (b.type === 'blend' ? 120 : 150);
  }
  const variants = (b.variants || []).map((v) => ({
    ...v,
    label: v.label ?? `${v.weightG}g`,
    manualPrice: v.manualPrice ?? false,
  }));
  return { ...b, greenPricePerKg: greenPrice, variants };
}

function bumpMeta(s: AppState) {
  return { ...s.meta, updatedAt: new Date().toISOString() };
}

/** 在数组中把 id 元素上移(-1)或下移(+1)一格；边界不动 */
function moveArr<T extends { id: string }>(arr: T[], id: string, dir: -1 | 1): T[] {
  const idx = arr.findIndex((x) => x.id === id);
  if (idx < 0) return arr;
  const target = idx + dir;
  if (target < 0 || target >= arr.length) return arr;
  const next = [...arr];
  const [item] = next.splice(idx, 1);
  next.splice(target, 0, item);
  return next;
}

/** 启发式匹配 specId → bean+variant；与 engine.autoMatchSpec 同逻辑，避免 store→engine 循环依赖 */
function autoMatchInline(
  beans: Bean[],
  productName: string,
  specName: string,
): { beanId: string | null; variantId: string | null } {
  const bean = beans.find((b) => productName.includes(b.name) || specName.includes(b.name));
  if (!bean) return { beanId: null, variantId: null };
  const m = specName.match(/(\d+)\s*g/i);
  if (!m) return { beanId: bean.id, variantId: null };
  const targetG = parseInt(m[1], 10);
  const variant = bean.variants.find((v) => v.weightG === targetG);
  return { beanId: bean.id, variantId: variant?.id ?? null };
}
