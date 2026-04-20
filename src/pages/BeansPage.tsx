import { useStore } from '../store';
import { Checkbox, NumInput, PctInput, Select, TextInput } from '../components/Inputs';
import type { Bean, BeanVariant } from '../types';
import {
  annualOperationCost,
  capacityKgPerYear,
  fmtCNY,
  fmtPct,
  packCost,
  suggestedPrice,
  weightedPlatformFee,
} from '../engine';

export default function BeansPage() {
  const beans = useStore((s) => s.beans);
  const addBean = useStore((s) => s.addBean);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">豆子配方</h2>
          <p className="text-sm text-slate-500 mt-1">
            每款豆子独立设置：使用的生豆、包装件组合、规格（110g / 225g / 其他）、目标毛利率。
            下面会实时展示每包成本明细和建议售价。
          </p>
        </div>
        <button className="dhj dhj-primary" onClick={addBean}>+ 添加豆款</button>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {beans.map((b) => <BeanCard key={b.id} bean={b} />)}
      </div>
    </div>
  );
}

function BeanCard({ bean }: { bean: Bean }) {
  const state = useStore();
  const update = useStore((s) => s.updateBean);
  const del = useStore((s) => s.deleteBean);
  const setPkg = useStore((s) => s.setBeanPackaging);
  const addVariant = useStore((s) => s.addVariant);
  const updateVariant = useStore((s) => s.updateVariant);
  const deleteVariant = useStore((s) => s.deleteVariant);

  const rawOptions = state.costItems
    .filter((c) => c.category === 'raw')
    .map((c) => ({ value: c.id, label: `${c.name} (${c.unitPrice}${c.unit})` }));

  const packagingCatalog = state.costItems.filter((c) => c.category === 'packaging');
  const platformFee = weightedPlatformFee(state.platforms);
  const marketingShare = state.ratios.marketingOfGmv;

  // 运营成本单位分摊的估计（按当前盈利总览设置）：这里在卡片里只展示"每包生产成本"
  // 运营分摊依赖销量结构，需要在盈利页统一算
  return (
    <div className="card p-4 space-y-3">
      {/* 头部 */}
      <div className="flex flex-wrap items-center gap-3">
        <Checkbox checked={bean.enabled} onChange={(b) => update(bean.id, { enabled: b })} />
        <TextInput value={bean.name} onChange={(v) => update(bean.id, { name: v })} className="max-w-[200px]" />
        <Select<'blend' | 'soe'>
          value={bean.type}
          onChange={(v) => update(bean.id, { type: v })}
          options={[
            { value: 'blend', label: '拼配' },
            { value: 'soe', label: '单品 / SOE' },
          ]}
          className="max-w-[120px]"
        />
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">生豆</span>
          <Select
            value={bean.rawCostItemId}
            onChange={(v) => update(bean.id, { rawCostItemId: v })}
            options={rawOptions}
            className="max-w-[220px]"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">目标毛利率</span>
          <PctInput value={bean.targetMargin} onChange={(v) => update(bean.id, { targetMargin: v })} />
        </div>
        <div className="ml-auto">
          <button className="dhj dhj-danger" onClick={() => del(bean.id)}>删除此豆款</button>
        </div>
      </div>

      {/* 包装组合 */}
      <div>
        <div className="text-sm font-medium mb-1">包装件组合（默认使用，variant 可单独覆盖）</div>
        <table className="dhj">
          <thead>
            <tr>
              <th className="w-10">选</th>
              <th>包装件</th>
              <th className="w-32">单价</th>
              <th className="w-28">用量</th>
              <th className="w-32">小计</th>
            </tr>
          </thead>
          <tbody>
            {packagingCatalog.map((ci) => {
              const cur = bean.packaging.find((p) => p.costItemId === ci.id);
              const checked = !!cur;
              const qty = cur?.qty ?? 1;
              return (
                <tr key={ci.id}>
                  <td>
                    <Checkbox
                      checked={checked}
                      onChange={(on) => {
                        if (on) {
                          setPkg(bean.id, [...bean.packaging, { costItemId: ci.id, qty: 1 }]);
                        } else {
                          setPkg(bean.id, bean.packaging.filter((x) => x.costItemId !== ci.id));
                        }
                      }}
                    />
                  </td>
                  <td>{ci.name} <span className="text-slate-400 text-xs">{ci.note}</span></td>
                  <td>{fmtCNY(ci.unitPrice)}</td>
                  <td>
                    {checked ? (
                      <NumInput
                        value={qty}
                        step={1}
                        digits={0}
                        min={0}
                        onChange={(v) => setPkg(bean.id, bean.packaging.map((x) => (x.costItemId === ci.id ? { ...x, qty: v } : x)))}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </td>
                  <td>{checked ? fmtCNY(ci.unitPrice * qty) : <span className="text-slate-300">—</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 规格 / variants */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium">规格（熟豆克重）+ 成本定价</div>
          <button className="dhj dhj-ghost text-xs" onClick={() => addVariant(bean.id, 110)}>+ 添加规格</button>
        </div>
        <table className="dhj">
          <thead>
            <tr>
              <th className="w-24">熟豆克重</th>
              <th className="w-28">本款内占比</th>
              <th className="w-32">生豆用量</th>
              <th className="w-28">生豆成本</th>
              <th className="w-28">包装成本</th>
              <th className="w-28">物流</th>
              <th className="w-32">生产成本(含损)</th>
              <th className="w-28">建议售价</th>
              <th className="w-36">扣平台/营销后净收入</th>
              <th className="w-28">每包净利</th>
              <th className="w-16">操作</th>
            </tr>
          </thead>
          <tbody>
            {bean.variants.map((v) => <VariantRow key={v.id} bean={bean} variant={v}
              platformFee={platformFee} marketingShare={marketingShare}
              onUpdate={(p) => updateVariant(bean.id, v.id, p)}
              onDelete={() => deleteVariant(bean.id, v.id)} />)}
          </tbody>
        </table>
        <VariantShareSum bean={bean} />
      </div>
    </div>
  );
}

function VariantRow({
  bean, variant, platformFee, marketingShare, onUpdate, onDelete,
}: {
  bean: Bean; variant: BeanVariant; platformFee: number; marketingShare: number;
  onUpdate: (p: Partial<BeanVariant>) => void; onDelete: () => void;
}) {
  const state = useStore();
  const pc = packCost(state, bean, variant);
  const price = suggestedPrice(pc.productionCost, bean.targetMargin, platformFee, marketingShare);
  // 扣除平台和营销后实收
  const netRevenuePerPack = price * (1 - platformFee - marketingShare - state.ratios.returnRate);
  const profitPerPack = netRevenuePerPack - pc.productionCost;

  return (
    <tr>
      <td>
        <NumInput value={variant.weightG} step={5} digits={0} min={1}
          onChange={(v) => onUpdate({ weightG: v })} />
      </td>
      <td>
        <PctInput value={variant.shareInBean} onChange={(v) => onUpdate({ shareInBean: v })} />
      </td>
      <td>{pc.rawGramsPerPack.toFixed(2)} g</td>
      <td>{fmtCNY(pc.rawCost)}</td>
      <td title={pc.packagingDetails.map((d) => `${d.name}×${d.qty}=${d.subtotal.toFixed(2)}`).join('\n')}>
        {fmtCNY(pc.packagingCost)}
      </td>
      <td>{fmtCNY(pc.logisticsCost)}</td>
      <td className="font-semibold">{fmtCNY(pc.productionCost)}</td>
      <td className="text-blue-600 font-semibold">{fmtCNY(price)}</td>
      <td>{fmtCNY(netRevenuePerPack)}</td>
      <td className={profitPerPack >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtCNY(profitPerPack)}</td>
      <td>
        <button className="dhj dhj-danger text-xs" onClick={onDelete}>×</button>
      </td>
    </tr>
  );
}

function VariantShareSum({ bean }: { bean: Bean }) {
  const sum = bean.variants.reduce((s, v) => s + (v.shareInBean || 0), 0);
  if (bean.variants.length === 0) return null;
  const ok = Math.abs(sum - 1) < 0.001;
  return (
    <div className={`text-xs mt-1 ${ok ? 'text-emerald-600' : 'text-amber-600'}`}>
      本款内规格占比合计：{fmtPct(sum)}{!ok && '（非 100%，实际计算时会自动归一化）'}
    </div>
  );
}

// 当前产能下的总 kg（作为展示提示）— 留给盈利页用
export function annualKgForCurrentScenario(state = useStore.getState()) {
  const sc = state.scenarios.find((x) => x.id === state.profitInputs.scenarioId);
  if (!sc) return 0;
  return capacityKgPerYear(sc);
}

export function _opsUsed() {
  return annualOperationCost(useStore.getState()).total;
}
