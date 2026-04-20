import { useStore } from '../store';
import {
  annualOperationCost,
  capacityKgPerYear,
  fmtCNY,
  fmtNum,
  fmtPct,
  impliedMargin,
  packCost,
  rawGramsPerPack,
  resolveVariantPricing,
  variantLabel,
  weightedPlatformFee,
} from '../engine';

/** 校验页：展示每一步计算的中间值，便于手工核对 */
export default function AuditPage() {
  const state = useStore();
  const r = state.ratios;
  const fee = weightedPlatformFee(state.platforms);
  const ops = annualOperationCost(state);

  return (
    <div className="space-y-5 text-sm">
      <header>
        <h2 className="text-xl font-semibold">计算逻辑校验</h2>
        <p className="text-slate-500 mt-1">
          这里把每一步的公式和当前数值都列出来，方便你对照手算结果验证。
        </p>
      </header>

      {/* 1. 生豆用量 */}
      <Section title="1. 单包生豆用量">
        <Formula>生豆用量 (g) = 熟豆克重 / (1 − 挑豆损耗) / (1 − 烘焙失水)</Formula>
        <table className="dhj mt-2">
          <thead>
            <tr>
              <th>熟豆克重</th>
              <th>挑豆损耗</th>
              <th>烘焙失水</th>
              <th>生豆用量</th>
            </tr>
          </thead>
          <tbody>
            {[110, 225, 250, 500].map((w) => (
              <tr key={w}>
                <td>{w} g</td>
                <td>{fmtPct(r.lossSort)}</td>
                <td>{fmtPct(r.lossRoast)}</td>
                <td>{rawGramsPerPack(w, r).toFixed(2)} g</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 2. 产能 */}
      <Section title="2. 产能">
        <Formula>年产能 (kg 熟豆) = 每周工时 × 每小时产出 × 每年工作周数</Formula>
        <table className="dhj mt-2">
          <thead>
            <tr>
              <th>情景</th>
              <th>每周工时</th>
              <th>kg/小时</th>
              <th>年周数</th>
              <th>年产能</th>
            </tr>
          </thead>
          <tbody>
            {state.scenarios.map((sc) => (
              <tr key={sc.id}>
                <td>{sc.name}</td>
                <td>{sc.hoursPerWeek} h</td>
                <td>{sc.kgPerHour}</td>
                <td>{sc.weeksPerYear}</td>
                <td className="font-semibold">{fmtNum(capacityKgPerYear(sc), 1)} kg</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      {/* 3. 运营成本 */}
      <Section title="3. 年度总运营成本">
        <Formula>
          年运营 = Σ(一次性/固定资产 单价 / 摊销年数) + Σ(年度/耗材/研发 金额)
        </Formula>
        <table className="dhj mt-2">
          <thead>
            <tr><th>项目</th><th className="w-32">年度金额</th><th>来源</th></tr>
          </thead>
          <tbody>
            {ops.breakdown.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td>{fmtCNY(row.yearly)}</td>
                <td className="text-xs text-slate-500">{row.source}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="text-right">合计</td>
              <td className="font-semibold">{fmtCNY(ops.total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Section>

      {/* 4. 平台抽成 */}
      <Section title="4. 加权平台抽成">
        <Formula>加权抽成 = Σ(销售占比 × 抽成率) / Σ(销售占比)</Formula>
        <table className="dhj mt-2">
          <thead><tr><th>平台</th><th>抽成</th><th>占比</th></tr></thead>
          <tbody>
            {state.platforms.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{fmtPct(p.feeRate)}</td>
                <td>{fmtPct(p.salesShare)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={2} className="text-right">加权</td><td className="font-semibold">{fmtPct(fee)}</td></tr>
          </tfoot>
        </table>
      </Section>

      {/* 5. 每包成本与售价 */}
      <Section title="5. 每包生产成本 + 售价（按当前各豆款 / SKU）">
        <Formula>
          生豆成本 = 生豆用量(g) ÷ 1000 × 该豆款生豆单价(元/kg) <br />
          生产成本 = (生豆成本 + 包装成本) × (1 + 包装损耗) + 物流 <br />
          建议售价（目标毛利模式）= 生产成本 / (1 − 目标毛利 − 加权平台抽成 − 营销/GMV) <br />
          实际毛利（手动定价模式）= 1 − 平台抽成 − 营销/GMV − 生产成本 / 实际售价
        </Formula>
        <div className="text-xs text-slate-500 mt-1">
          目标毛利模式下，扣除平台和营销后的毛利率正好等于"目标毛利"。手动定价模式直接取用户输入的售价并反推实际毛利率。
        </div>
        <table className="dhj mt-2">
          <thead>
            <tr>
              <th>豆款 / 规格</th>
              <th>生豆单价</th>
              <th>生豆(g)</th>
              <th>生豆成本</th>
              <th>包装</th>
              <th>物流</th>
              <th>生产成本</th>
              <th>模式</th>
              <th>售价</th>
              <th>实际毛利</th>
            </tr>
          </thead>
          <tbody>
            {state.beans.flatMap((b) =>
              b.variants.map((v) => {
                const pc = packCost(state, b, v);
                const pricing = resolveVariantPricing(v, pc.productionCost, b, fee, r.marketingOfGmv);
                const margin = pricing.isManual
                  ? impliedMargin(pricing.price, pc.productionCost, fee, r.marketingOfGmv)
                  : b.targetMargin;
                return (
                  <tr key={`${b.id}_${v.id}`}>
                    <td>{b.name} / {variantLabel(v)}</td>
                    <td>{fmtCNY(b.greenPricePerKg)}/kg</td>
                    <td>{pc.rawGramsPerPack.toFixed(1)}</td>
                    <td>{fmtCNY(pc.rawCost)}</td>
                    <td>{fmtCNY(pc.packagingCost)}</td>
                    <td>{fmtCNY(pc.logisticsCost)}</td>
                    <td>{fmtCNY(pc.productionCost)}</td>
                    <td className={pricing.isManual ? 'text-amber-600' : 'text-slate-500'}>
                      {pricing.isManual ? '手动' : '目标毛利'}
                    </td>
                    <td className="text-blue-600 font-medium">{fmtCNY(pricing.price)}</td>
                    <td className={margin >= 0 ? 'text-slate-700' : 'text-rose-600'}>
                      {Number.isFinite(margin) ? fmtPct(margin) : '—'}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </Section>

      {/* 6. 盈利页公式总览 */}
      <Section title="6. 盈利总览的计算链">
        <Formula>
          每 variant 年 kg = 年总产能 × 豆款占比(归一) × variant占比(归一) <br />
          每 variant 年包数 = 年 kg × 1000 / 克重 <br />
          年 GMV = 年包数 × 建议售价 <br />
          运营分摊 = 年度总运营 × (本 variant 年 kg / 总年 kg) <br />
          平台抽成 = 年 GMV × 加权抽成 <br />
          营销 = 年 GMV × 营销比例 <br />
          退货计提 = 年 GMV × 退货率 <br />
          净利润 = GMV − 年生产成本 − 运营分摊 − 平台抽成 − 营销 − 退货
        </Formula>
      </Section>

      {/* 7. Break-even */}
      <Section title="7. Break-even（保本点）">
        <Formula>
          每包贡献 = 售价 × (1 − 平台抽成 − 营销/GMV − 退货率) − 生产成本 <br />
          每 kg 贡献 = 每包贡献 × (1000 / 克重) <br />
          整体 kg 贡献 = Σ(每 kg 贡献 × 本 variant 年 kg / 总年 kg) <br />
          保本年销量 = 年度总运营 / 整体 kg 贡献
        </Formula>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card p-4">
      <h3 className="font-semibold mb-2">{title}</h3>
      {children}
    </section>
  );
}
function Formula({ children }: { children: React.ReactNode }) {
  return (
    <pre className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700 whitespace-pre-wrap">
      {children}
    </pre>
  );
}
