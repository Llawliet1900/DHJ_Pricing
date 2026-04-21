import { useStore } from '../store';
import type { CostCategory } from '../types';
import { Checkbox, NumInput, Select, TextInput } from '../components/Inputs';
import { annualOperationCost, fmtCNY } from '../engine';

const CATEGORIES: { value: CostCategory; label: string; hint: string }[] = [
  { value: 'raw',         label: '原料（生豆）',   hint: '按 元/kg 计，被豆子卡片引用' },
  { value: 'packaging',   label: '包装件',         hint: '按件计价，每款豆子勾选 + 填用量' },
  { value: 'utilities',   label: '水电',           hint: '直接摊到每包' },
  { value: 'logistics',   label: '物流',           hint: '每单快递费，含外箱' },
  { value: 'oneoff',      label: '一次性成本',     hint: '按摊销年数折算到年' },
  { value: 'asset',       label: '固定资产',       hint: '按摊销年数折算到年' },
  { value: 'annual',      label: '年度运营',       hint: '直接计入年度总运营成本' },
  { value: 'consumable',  label: '耗材',           hint: '年度金额' },
  { value: 'rd',          label: '研发/测试',       hint: '年度金额' },
  { value: 'other',       label: '其他',           hint: '' },
];

export default function CostItemsPage() {
  const items = useStore((s) => s.costItems);
  const addCostItem = useStore((s) => s.addCostItem);
  const updateCostItem = useStore((s) => s.updateCostItem);
  const deleteCostItem = useStore((s) => s.deleteCostItem);
  const moveCostItem = useStore((s) => s.moveCostItem);
  const defaultLogId = useStore((s) => s.defaultLogisticsCostItemId);
  const setDefaultLog = useStore((s) => s.setDefaultLogistics);

  const ops = annualOperationCost(useStore.getState());

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">成本项管理</h2>
          <p className="text-sm text-slate-500 mt-1">
            所有单项成本都在这里维护。一次性成本和固定资产会按"摊销年数"自动折算到年。
          </p>
        </div>
        <div className="flex gap-2">
          <button className="dhj dhj-primary" onClick={() => addCostItem()}>
            + 添加成本项
          </button>
        </div>
      </header>

      {/* 分类说明 */}
      <details className="card p-3 text-sm">
        <summary className="cursor-pointer font-medium">📘 分类说明（点开）</summary>
        <ul className="mt-2 ml-4 space-y-0.5 text-slate-600 list-disc">
          {CATEGORIES.map((c) => (
            <li key={c.value}>
              <b>{c.label}</b>：{c.hint}
            </li>
          ))}
        </ul>
      </details>

      <div className="card overflow-hidden">
        <table className="dhj">
          <thead>
            <tr>
              <th className="w-24">启用</th>
              <th className="w-36">类别</th>
              <th>项目</th>
              <th>备注</th>
              <th className="w-28">单价</th>
              <th className="w-24">单位</th>
              <th className="w-32">摊销年数</th>
              <th className="w-28">默认物流</th>
              <th className="w-16">排序</th>
              <th className="w-20">操作</th>
            </tr>
          </thead>
          <tbody>
            {items.map((c, i) => (
              <tr key={c.id}>
                <td>
                  <Checkbox checked={c.enabled} onChange={(b) => updateCostItem(c.id, { enabled: b })} />
                </td>
                <td>
                  <Select
                    value={c.category}
                    onChange={(v) => updateCostItem(c.id, { category: v })}
                    options={CATEGORIES.map((x) => ({ value: x.value, label: x.label }))}
                  />
                </td>
                <td>
                  <TextInput value={c.name} onChange={(v) => updateCostItem(c.id, { name: v })} />
                </td>
                <td>
                  <TextInput value={c.note ?? ''} onChange={(v) => updateCostItem(c.id, { note: v })} />
                </td>
                <td>
                  <NumInput value={c.unitPrice} step={0.1} digits={2} onChange={(v) => updateCostItem(c.id, { unitPrice: v })} />
                </td>
                <td>
                  <TextInput value={c.unit} onChange={(v) => updateCostItem(c.id, { unit: v })} />
                </td>
                <td>
                  {c.category === 'oneoff' || c.category === 'asset' ? (
                    <NumInput value={c.amortYears ?? 5} step={1} digits={0} min={1} onChange={(v) => updateCostItem(c.id, { amortYears: v })} />
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td>
                  {c.category === 'logistics' ? (
                    <label className="inline-flex items-center gap-1 cursor-pointer">
                      <input
                        type="radio"
                        name="defaultLogistics"
                        checked={defaultLogId === c.id}
                        onChange={() => setDefaultLog(c.id)}
                      />
                      <span className="text-xs">默认</span>
                    </label>
                  ) : (
                    <span className="text-slate-400 text-xs">—</span>
                  )}
                </td>
                <td>
                  <div className="flex gap-0.5">
                    <button
                      className="dhj dhj-ghost text-xs px-1.5"
                      onClick={() => moveCostItem(c.id, -1)}
                      disabled={i === 0}
                      title="上移"
                    >↑</button>
                    <button
                      className="dhj dhj-ghost text-xs px-1.5"
                      onClick={() => moveCostItem(c.id, 1)}
                      disabled={i === items.length - 1}
                      title="下移"
                    >↓</button>
                  </div>
                </td>
                <td>
                  <button className="dhj dhj-danger" onClick={() => deleteCostItem(c.id)}>
                    删除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 年度运营成本汇总 */}
      <div className="card p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">年度总运营成本（自动计算）</h3>
          <div className="text-xl font-bold text-blue-600">{fmtCNY(ops.total)}</div>
        </div>
        <table className="dhj mt-2">
          <thead>
            <tr>
              <th>项目</th>
              <th className="w-40">年度金额</th>
              <th className="w-40">来源</th>
            </tr>
          </thead>
          <tbody>
            {ops.breakdown.map((r) => (
              <tr key={r.id}>
                <td>{r.name}</td>
                <td>{fmtCNY(r.yearly)}</td>
                <td className="text-slate-500 text-xs">{r.source}</td>
              </tr>
            ))}
            {ops.breakdown.length === 0 && (
              <tr>
                <td colSpan={3} className="text-center text-slate-400 py-4">
                  还没有启用的运营类成本
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
