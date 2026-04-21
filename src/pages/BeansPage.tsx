import { useStore } from '../store';
import { Checkbox, NumInput, PctInput, Select, TextInput } from '../components/Inputs';
import type { Bean, BeanVariant } from '../types';
import {
  fmtCNY,
  fmtPct,
  impliedMargin,
  packCost,
  suggestedPrice,
  variantLabel,
  weightedPlatformFee,
} from '../engine';

export default function BeansPage() {
  const beans = useStore((s) => s.beans);
  const addBean = useStore((s) => s.addBean);
  const moveBean = useStore((s) => s.moveBean);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">豆子配方</h2>
          <p className="text-sm text-slate-500 mt-1">
            每款豆子独立设置：生豆单价、包装件组合、规格（可自定义任意克重/SKU）、目标毛利率。
            规格支持"按目标毛利推售价"和"按售价反推毛利"两种模式，逐行切换。
          </p>
        </div>
        <button className="dhj dhj-primary" onClick={addBean}>+ 添加豆款</button>
      </header>

      <div className="grid grid-cols-1 gap-4">
        {beans.map((b, i) => (
          <BeanCard
            key={b.id}
            bean={b}
            canMoveUp={i > 0}
            canMoveDown={i < beans.length - 1}
            onMoveUp={() => moveBean(b.id, -1)}
            onMoveDown={() => moveBean(b.id, 1)}
          />
        ))}
      </div>
    </div>
  );
}

function BeanCard({
  bean,
  canMoveUp,
  canMoveDown,
  onMoveUp,
  onMoveDown,
}: {
  bean: Bean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const state = useStore();
  const update = useStore((s) => s.updateBean);
  const del = useStore((s) => s.deleteBean);
  const setPkg = useStore((s) => s.setBeanPackaging);
  const addVariant = useStore((s) => s.addVariant);
  const updateVariant = useStore((s) => s.updateVariant);
  const deleteVariant = useStore((s) => s.deleteVariant);
  const duplicateVariant = useStore((s) => s.duplicateVariant);

  const packagingCatalog = state.costItems.filter((c) => c.category === 'packaging');
  const platformFee = weightedPlatformFee(state.platforms);
  const marketingShare = state.ratios.marketingOfGmv;

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
          <span className="text-xs text-slate-500">生豆单价</span>
          <NumInput
            value={bean.greenPricePerKg}
            step={5}
            digits={2}
            min={0}
            onChange={(v) => update(bean.id, { greenPricePerKg: v })}
            className="max-w-[100px]"
          />
          <span className="text-xs text-slate-500">元/kg</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-xs text-slate-500">目标毛利率</span>
          <PctInput value={bean.targetMargin} onChange={(v) => update(bean.id, { targetMargin: v })} />
        </div>
        <div className="ml-auto flex items-center gap-1">
          <button
            className="dhj dhj-ghost text-xs px-2"
            onClick={onMoveUp}
            disabled={!canMoveUp}
            title="上移"
          >↑</button>
          <button
            className="dhj dhj-ghost text-xs px-2"
            onClick={onMoveDown}
            disabled={!canMoveDown}
            title="下移"
          >↓</button>
          <button className="dhj dhj-danger" onClick={() => del(bean.id)}>删除此豆款</button>
        </div>
      </div>

      {/* 包装组合 */}
      <details className="group">
        <summary className="cursor-pointer text-sm font-medium select-none">
          📦 包装件组合（默认用于所有规格，可折叠）
          <span className="text-xs text-slate-400 ml-2">
            当前共 {bean.packaging.length} 件，合计 {fmtCNY(sumPackagingCost(bean, state.costItems))}
          </span>
        </summary>
        <table className="dhj mt-2">
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
      </details>

      {/* 规格 / variants */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-medium">规格 SKU</div>
          <button className="dhj dhj-ghost text-xs" onClick={() => addVariant(bean.id)}>+ 添加规格</button>
        </div>
        <table className="dhj">
          <thead>
            <tr>
              <th className="w-32">规格名</th>
              <th className="w-24">熟豆(g)</th>
              <th className="w-28">本款占比</th>
              <th className="w-28">生豆用量</th>
              <th className="w-24">生豆成本</th>
              <th className="w-24">包装</th>
              <th className="w-20">物流</th>
              <th className="w-28">生产成本</th>
              <th className="w-28">定价模式</th>
              <th className="w-28">售价</th>
              <th className="w-24">实际毛利</th>
              <th className="w-24">每包净利</th>
              <th className="w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {bean.variants.map((v) => (
              <VariantRow
                key={v.id}
                bean={bean}
                variant={v}
                platformFee={platformFee}
                marketingShare={marketingShare}
                onUpdate={(p) => updateVariant(bean.id, v.id, p)}
                onDelete={() => deleteVariant(bean.id, v.id)}
                onDuplicate={() => duplicateVariant(bean.id, v.id)}
              />
            ))}
          </tbody>
        </table>
        <VariantShareSum bean={bean} />
      </div>
    </div>
  );
}

function VariantRow({
  bean, variant, platformFee, marketingShare, onUpdate, onDelete, onDuplicate,
}: {
  bean: Bean;
  variant: BeanVariant;
  platformFee: number;
  marketingShare: number;
  onUpdate: (p: Partial<BeanVariant>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const state = useStore();
  const pc = packCost(state, bean, variant);

  const suggested = suggestedPrice(pc.productionCost, bean.targetMargin, platformFee, marketingShare);
  const isManual = !!variant.manualPrice;
  const price = isManual ? (variant.manualPriceValue ?? 0) : suggested;
  const actualMargin = isManual
    ? impliedMargin(price, pc.productionCost, platformFee, marketingShare)
    : bean.targetMargin;

  // 每包净利 = 售价 × (1 - 平台 - 营销 - 退货) - 生产成本
  const profitPerPack = price * (1 - platformFee - marketingShare - state.ratios.returnRate) - pc.productionCost;

  return (
    <tr>
      <td>
        <TextInput
          value={variant.label ?? variantLabel(variant)}
          onChange={(v) => onUpdate({ label: v })}
          className="max-w-[110px]"
        />
      </td>
      <td>
        <NumInput value={variant.weightG} step={5} digits={0} min={1}
          onChange={(v) => onUpdate({ weightG: v })} />
      </td>
      <td>
        <PctInput value={variant.shareInBean} onChange={(v) => onUpdate({ shareInBean: v })} />
      </td>
      <td className="text-slate-600">{pc.rawGramsPerPack.toFixed(1)} g</td>
      <td>{fmtCNY(pc.rawCost)}</td>
      <td title={pc.packagingDetails.map((d) => `${d.name}×${d.qty}=${d.subtotal.toFixed(2)}`).join('\n')}>
        {fmtCNY(pc.packagingCost)}
      </td>
      <td>{fmtCNY(pc.logisticsCost)}</td>
      <td className="font-semibold">{fmtCNY(pc.productionCost)}</td>
      <td>
        <label className="flex items-center gap-1 text-xs">
          <input
            type="checkbox"
            checked={isManual}
            onChange={(e) => {
              const on = e.target.checked;
              onUpdate({
                manualPrice: on,
                manualPriceValue: on ? (variant.manualPriceValue ?? Math.round(suggested)) : variant.manualPriceValue,
              });
            }}
          />
          <span>{isManual ? '手动' : '目标毛利'}</span>
        </label>
      </td>
      <td>
        {isManual ? (
          <NumInput
            value={variant.manualPriceValue ?? 0}
            step={1}
            digits={2}
            min={0}
            onChange={(v) => onUpdate({ manualPriceValue: v })}
          />
        ) : (
          <span className="text-blue-600 font-semibold">{fmtCNY(suggested)}</span>
        )}
      </td>
      <td className={actualMargin >= 0 ? 'text-slate-700' : 'text-rose-600'}>
        {Number.isFinite(actualMargin) ? fmtPct(actualMargin) : '—'}
      </td>
      <td className={profitPerPack >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtCNY(profitPerPack)}</td>
      <td>
        <div className="flex gap-1">
          <button className="dhj dhj-ghost text-xs" onClick={onDuplicate} title="复制此规格">复制</button>
          <button className="dhj dhj-danger text-xs" onClick={onDelete} title="删除">×</button>
        </div>
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
      本款内规格占比合计：{fmtPct(sum)}{!ok && '（非 100%，计算时会自动归一化）'}
    </div>
  );
}

function sumPackagingCost(bean: Bean, costItems: { id: string; unitPrice: number }[]): number {
  return bean.packaging.reduce((s, p) => {
    const ci = costItems.find((c) => c.id === p.costItemId);
    return s + (ci?.unitPrice ?? 0) * p.qty;
  }, 0);
}
