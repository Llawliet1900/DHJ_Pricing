import { useStore } from '../store';
import { PctInput, Select } from '../components/Inputs';
import { computeProfit, fmtCNY, fmtNum, fmtPct } from '../engine';

export default function ProfitPage() {
  const state = useStore();
  const scenarios = state.scenarios;
  const beans = state.beans.filter((b) => b.enabled);
  const pi = state.profitInputs;
  const setPI = useStore((s) => s.updateProfitInputs);
  const setShare = useStore((s) => s.setBeanShare);

  const summary = computeProfit(state);

  const shareSum = pi.beanShares
    .filter((bs) => beans.find((b) => b.id === bs.beanId))
    .reduce((s, x) => s + (x.share || 0), 0);

  return (
    <div className="space-y-5">
      <header>
        <h2 className="text-xl font-semibold">盈利总览</h2>
        <p className="text-sm text-slate-500 mt-1">
          选产能情景 + 调整各款豆子的销量占比 → 立刻看到年度盈亏、Break-even、净利润率。
        </p>
      </header>

      {/* 输入区 */}
      <div className="card p-4 space-y-3">
        <div className="flex flex-wrap gap-4 items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">产能情景</span>
            <Select
              value={pi.scenarioId}
              onChange={(v) => setPI({ scenarioId: v })}
              options={scenarios.map((s) => ({ value: s.id, label: `${s.name}` }))}
              className="min-w-[200px]"
            />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">全局覆盖目标毛利率</span>
            <label className="text-xs text-slate-500 flex items-center gap-1">
              <input
                type="checkbox"
                checked={pi.globalMargin !== undefined}
                onChange={(e) => setPI({ globalMargin: e.target.checked ? 0.5 : undefined })}
              />
              启用
            </label>
            {pi.globalMargin !== undefined && (
              <PctInput
                value={pi.globalMargin}
                onChange={(v) => setPI({ globalMargin: v })}
              />
            )}
            <span className="text-xs text-slate-400">（不启用时按各豆款单独设的毛利率）</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-sm text-slate-500">物流口径</span>
            <label className="text-xs text-slate-600 flex items-center gap-1">
              <input
                type="radio"
                name="freeShipping"
                checked={(pi.freeShipping ?? true) === true}
                onChange={() => setPI({ freeShipping: true })}
              />
              包邮（物流计入成本）
            </label>
            <label className="text-xs text-slate-600 flex items-center gap-1">
              <input
                type="radio"
                name="freeShipping"
                checked={(pi.freeShipping ?? true) === false}
                onChange={() => setPI({ freeShipping: false })}
              />
              不包邮（用户另付运费）
            </label>
            <span className="text-xs text-slate-400">（切换不改动售价，仅影响成本侧）</span>
          </div>
        </div>

        <div>
          <div className="text-sm font-medium mb-1">各豆款产能占比（按熟豆 kg）</div>
          <table className="dhj">
            <thead>
              <tr>
                <th>豆款</th>
                <th className="w-40">产能占比</th>
                <th className="w-36">分配年产能 (kg)</th>
                <th className="w-32">该款毛利率</th>
              </tr>
            </thead>
            <tbody>
              {beans.map((b) => {
                const s = pi.beanShares.find((x) => x.beanId === b.id)?.share ?? 0;
                const totalKg = summary?.annualKgTotal ?? 0;
                const allocKg = shareSum > 0 ? (s / shareSum) * totalKg : 0;
                return (
                  <tr key={b.id}>
                    <td>
                      <span className="font-medium">{b.name}</span>
                      <span className="ml-2 text-xs text-slate-400">
                        {b.type === 'blend' ? '拼配' : '单品'}
                      </span>
                    </td>
                    <td>
                      <PctInput value={s} onChange={(v) => setShare(b.id, v)} />
                    </td>
                    <td>{fmtNum(allocKg, 1)} kg</td>
                    <td>{fmtPct(pi.globalMargin ?? b.targetMargin)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td className="text-right">合计</td>
                <td className={Math.abs(shareSum - 1) < 0.001 ? 'text-emerald-600' : 'text-amber-600'}>
                  {fmtPct(shareSum)}
                  {Math.abs(shareSum - 1) > 0.001 && (
                    <span className="text-xs ml-1">（不为 100%，会自动归一化）</span>
                  )}
                </td>
                <td>{fmtNum(summary?.annualKgTotal ?? 0, 1)} kg</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {!summary ? (
        <div className="text-slate-500">请选择一个产能情景。</div>
      ) : (
        <>
          {/* KPI 卡片 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Kpi label="年 GMV" value={fmtCNY(summary.gmvTotal)} tone="blue" />
            <Kpi label="年净利润" value={fmtCNY(summary.netProfit)} tone={summary.netProfit >= 0 ? 'emerald' : 'rose'} />
            <Kpi label="净利润率" value={fmtPct(summary.netMargin)} tone={summary.netProfit >= 0 ? 'emerald' : 'rose'} />
            <Kpi label="加权平台抽成" value={fmtPct(summary.weightedPlatformFee)} />
            <Kpi label="年产量 (kg)" value={fmtNum(summary.annualKgTotal, 1)} />
            <Kpi label="年包数" value={fmtNum(summary.annualPacksTotal, 0)} />
            <Kpi label="年度总运营" value={fmtCNY(summary.annualOps)} tone="slate" />
            <Kpi label="年度总生产成本" value={fmtCNY(summary.productionTotal)} tone="slate" />
          </div>

          {/* 按 SKU 明细 */}
          <div className="card overflow-hidden">
            <div className="px-4 py-2 border-b bg-slate-50 font-medium">各 SKU 年度明细</div>
            <table className="dhj">
              <thead>
                <tr>
                  <th>豆款 / 规格</th>
                  <th className="w-24">年 kg</th>
                  <th className="w-24">年包数</th>
                  <th className="w-28">单包生产成本</th>
                  <th className="w-24">建议售价</th>
                  <th className="w-28">年 GMV</th>
                  <th className="w-28">年生产成本</th>
                  <th className="w-28">运营分摊</th>
                  <th className="w-24">平台抽成</th>
                  <th className="w-24">营销</th>
                  <th className="w-24">退货计提</th>
                  <th className="w-28">净利润</th>
                </tr>
              </thead>
              <tbody>
                {summary.variants.map((v) => (
                  <tr key={v.variantId}>
                    <td>
                      {v.beanName} / {v.variantLabel}
                      {v.isManualPrice && <span className="ml-1 text-xs text-amber-600" title="手动定价">✏️</span>}
                    </td>
                    <td>{fmtNum(v.annualKg, 1)}</td>
                    <td>{fmtNum(v.annualPacks, 0)}</td>
                    <td>{fmtCNY(v.productionCost)}</td>
                    <td className="text-blue-600 font-medium">
                      {fmtCNY(v.price)}
                      <div className="text-[10px] text-slate-400 font-normal">
                        毛利 {fmtPct(v.margin)}
                      </div>
                    </td>
                    <td>{fmtCNY(v.gmv, 0)}</td>
                    <td>{fmtCNY(v.productionTotal, 0)}</td>
                    <td>{fmtCNY(v.opsAllocated, 0)}</td>
                    <td>{fmtCNY(v.platformFeeTotal, 0)}</td>
                    <td>{fmtCNY(v.marketingTotal, 0)}</td>
                    <td>{fmtCNY(v.returnLossTotal, 0)}</td>
                    <td className={v.netProfit >= 0 ? 'text-emerald-600 font-medium' : 'text-rose-600 font-medium'}>
                      {fmtCNY(v.netProfit, 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="text-right">合计</td>
                  <td>{fmtNum(summary.annualKgTotal, 1)}</td>
                  <td>{fmtNum(summary.annualPacksTotal, 0)}</td>
                  <td />
                  <td />
                  <td>{fmtCNY(summary.gmvTotal, 0)}</td>
                  <td>{fmtCNY(summary.productionTotal, 0)}</td>
                  <td>{fmtCNY(summary.opsTotal, 0)}</td>
                  <td>{fmtCNY(summary.platformTotal, 0)}</td>
                  <td>{fmtCNY(summary.marketingTotal, 0)}</td>
                  <td>{fmtCNY(summary.returnLossTotal, 0)}</td>
                  <td className={summary.netProfit >= 0 ? 'text-emerald-700 font-semibold' : 'text-rose-700 font-semibold'}>
                    {fmtCNY(summary.netProfit, 0)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Break-even */}
          <div className="card p-4">
            <h3 className="font-semibold mb-2">Break-even（保本点）</h3>
            <div className="text-sm text-slate-500 mb-3">
              固定成本（= 年度总运营 {fmtCNY(summary.breakeven.fixedCost)}）需要由每 kg 的贡献边际来覆盖。
              贡献边际率考虑了平台抽成、营销、退货。
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Kpi label="每 kg 贡献边际" value={fmtCNY(summary.breakeven.contributionPerKg)} />
              <Kpi label="保本年销量" value={`${fmtNum(summary.breakeven.kgPerYear, 1)} kg`} />
              <Kpi label="保本月销量" value={`${fmtNum(summary.breakeven.kgPerMonth, 1)} kg`} />
              <Kpi label="保本月 GMV" value={fmtCNY(summary.breakeven.gmvPerMonth)} />
            </div>
            {summary.breakeven.contributionPerKg <= 0 && (
              <div className="mt-3 text-rose-600 text-sm">
                ⚠️ 当前产品结构下，每 kg 贡献边际 ≤ 0，无论卖多少都无法覆盖固定成本。
                建议：提高目标毛利率，或降低损耗/平台/营销比例，或提高产能。
              </div>
            )}
          </div>

          {/* 敏感性分析 */}
          <SensitivityTable />
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'blue' | 'emerald' | 'rose' | 'slate' }) {
  const toneCls = {
    default: 'bg-white',
    blue: 'bg-blue-50 text-blue-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    rose: 'bg-rose-50 text-rose-700',
    slate: 'bg-slate-50',
  }[tone];
  return (
    <div className={`card p-3 ${toneCls}`}>
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-semibold mt-0.5">{value}</div>
    </div>
  );
}

/** 简单的敏感性测试：生豆 ±20%、快递 ±50%、营销 ±5pp */
function SensitivityTable() {
  const baseState = useStore.getState();
  const baseSummary = computeProfit(baseState);
  if (!baseSummary) return null;

  const scenarios: { name: string; mutate: (s: typeof baseState) => typeof baseState }[] = [
    { name: '基准', mutate: (s) => s },
    { name: '生豆 +20%', mutate: (s) => patchGreenPrice(s, 1.2) },
    { name: '生豆 -20%', mutate: (s) => patchGreenPrice(s, 0.8) },
    { name: '快递 +50%', mutate: (s) => patchCost(s, 'logistics', 1.5) },
    { name: '营销 +5pp', mutate: (s) => ({ ...s, ratios: { ...s.ratios, marketingOfGmv: s.ratios.marketingOfGmv + 0.05 } }) },
    { name: '营销 -5pp', mutate: (s) => ({ ...s, ratios: { ...s.ratios, marketingOfGmv: Math.max(0, s.ratios.marketingOfGmv - 0.05) } }) },
    { name: '平台抽成 +3pp', mutate: (s) => ({ ...s, platforms: s.platforms.map((p) => ({ ...p, feeRate: p.feeRate + 0.03 })) }) },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-2 border-b bg-slate-50 font-medium">敏感性分析（对比基准的净利润变化）</div>
      <table className="dhj">
        <thead>
          <tr>
            <th>场景</th>
            <th className="w-36">年 GMV</th>
            <th className="w-36">年净利润</th>
            <th className="w-28">净利润率</th>
            <th className="w-36">相对基准</th>
          </tr>
        </thead>
        <tbody>
          {scenarios.map((sc) => {
            const mutated = sc.mutate(deepClone(baseState));
            const r = computeProfit(mutated);
            if (!r) return null;
            const delta = r.netProfit - baseSummary.netProfit;
            return (
              <tr key={sc.name}>
                <td>{sc.name}</td>
                <td>{fmtCNY(r.gmvTotal, 0)}</td>
                <td className={r.netProfit >= 0 ? 'text-emerald-600' : 'text-rose-600'}>{fmtCNY(r.netProfit, 0)}</td>
                <td>{fmtPct(r.netMargin)}</td>
                <td className={delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}>
                  {sc.name === '基准' ? '—' : `${delta >= 0 ? '+' : ''}${fmtCNY(delta, 0)}`}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function patchCost(s: ReturnType<typeof useStore.getState>, cat: string, factor: number) {
  return {
    ...s,
    costItems: s.costItems.map((c) => (c.category === cat ? { ...c, unitPrice: c.unitPrice * factor } : c)),
  };
}

/** 对所有豆子的 greenPricePerKg 等比例调整 */
function patchGreenPrice(s: ReturnType<typeof useStore.getState>, factor: number) {
  return {
    ...s,
    beans: s.beans.map((b) => ({ ...b, greenPricePerKg: b.greenPricePerKg * factor })),
  };
}

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v));
}
