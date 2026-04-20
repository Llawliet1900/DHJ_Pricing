import { useStore } from '../store';
import { NumInput, PctInput, TextInput } from '../components/Inputs';
import { fmtPct, weightedPlatformFee } from '../engine';

export default function RatiosPage() {
  const ratios = useStore((s) => s.ratios);
  const updateRatios = useStore((s) => s.updateRatios);
  const platforms = useStore((s) => s.platforms);
  const addPlatform = useStore((s) => s.addPlatform);
  const updatePlatform = useStore((s) => s.updatePlatform);
  const deletePlatform = useStore((s) => s.deletePlatform);

  const weighted = weightedPlatformFee(platforms);
  const shareSum = platforms.reduce((s, p) => s + (p.salesShare || 0), 0);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="text-xl font-semibold">比例参数</h2>
        <p className="text-sm text-slate-500 mt-1">
          所有涉及比例的计算参数都在这里。修改后所有页面实时重算。
        </p>
      </header>

      {/* 损耗 / 营销 */}
      <div className="card p-4 grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-3">
        <Row label="挑豆/样品损耗" desc="生豆→挑选后，估计 3%-8%">
          <PctInput value={ratios.lossSort} onChange={(v) => updateRatios({ lossSort: v })} />
        </Row>
        <Row label="烘焙失水" desc="生豆→熟豆 烘焙过程水分蒸发，典型 12%-20%">
          <PctInput value={ratios.lossRoast} onChange={(v) => updateRatios({ lossRoast: v })} />
        </Row>
        <Row label="包装损耗" desc="分装/打包环节破损浪费，典型 3%-5%">
          <PctInput value={ratios.lossPack} onChange={(v) => updateRatios({ lossPack: v })} />
        </Row>
        <Row label="退货/破损率" desc="按 GMV 计提，一般 1%-2%">
          <PctInput value={ratios.returnRate} onChange={(v) => updateRatios({ returnRate: v })} />
        </Row>
        <Row label="营销费用（占 GMV）" desc="按 GMV 百分比扣除（不再按利润计）">
          <PctInput value={ratios.marketingOfGmv} onChange={(v) => updateRatios({ marketingOfGmv: v })} />
        </Row>
      </div>

      {/* 生豆默认单价 */}
      <div className="card p-4">
        <div className="font-medium mb-1">🫘 生豆默认单价（仅作为"新建豆款"的默认值）</div>
        <div className="text-xs text-slate-500 mb-3">
          每款豆子的实际生豆单价在「豆子配方」Tab 里单独设置，这里的值只在你点"+ 添加豆款"时作为初始值带入。
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Row label="拼配默认单价" desc="元/kg">
            <NumInput
              value={ratios.greenPriceBlendDefault ?? 120}
              step={5}
              digits={2}
              min={0}
              onChange={(v) => updateRatios({ greenPriceBlendDefault: v })}
            />
          </Row>
          <Row label="SOE 默认单价" desc="元/kg">
            <NumInput
              value={ratios.greenPriceSoeDefault ?? 150}
              step={5}
              digits={2}
              min={0}
              onChange={(v) => updateRatios({ greenPriceSoeDefault: v })}
            />
          </Row>
        </div>
      </div>

      {/* 生豆用量校验 */}
      <div className="card p-4 text-sm">
        <div className="font-medium mb-2">📐 单包生豆用量示例（帮助你验证损耗设置是否合理）</div>
        <div className="text-slate-600">
          公式：<code className="bg-slate-100 px-1">生豆用量 = 熟豆克重 / (1 − 挑豆损耗) / (1 − 烘焙失水)</code>
        </div>
        <ul className="mt-2 space-y-1">
          {[110, 225].map((w) => {
            const g = w / (1 - ratios.lossSort) / (1 - ratios.lossRoast);
            return (
              <li key={w}>
                熟豆 <b>{w}g</b> → 生豆 <b>{g.toFixed(2)}g</b>{' '}
                <span className="text-slate-400">
                  （每 1000g 生豆能产出 {((1000 * (1 - ratios.lossSort) * (1 - ratios.lossRoast))).toFixed(1)}g 熟豆）
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* 平台抽成 */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="font-semibold">平台抽成 / 支付通道费</h3>
            <p className="text-xs text-slate-500">
              加权平均 =Σ(销售占比 × 抽成率)；占比会自动归一化。
            </p>
          </div>
          <button className="dhj dhj-primary" onClick={addPlatform}>
            + 添加平台
          </button>
        </div>
        <div className="card overflow-hidden">
          <table className="dhj">
            <thead>
              <tr>
                <th>平台名</th>
                <th className="w-40">综合抽成率</th>
                <th className="w-40">销售占比</th>
                <th className="w-24">操作</th>
              </tr>
            </thead>
            <tbody>
              {platforms.map((p) => (
                <tr key={p.id}>
                  <td>
                    <TextInput value={p.name} onChange={(v) => updatePlatform(p.id, { name: v })} />
                  </td>
                  <td>
                    <PctInput value={p.feeRate} onChange={(v) => updatePlatform(p.id, { feeRate: v })} />
                  </td>
                  <td>
                    <PctInput value={p.salesShare} onChange={(v) => updatePlatform(p.id, { salesShare: v })} />
                  </td>
                  <td>
                    <button className="dhj dhj-danger" onClick={() => deletePlatform(p.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="font-medium text-right">合计 / 加权</td>
                <td className="font-semibold text-blue-600">{fmtPct(weighted)}</td>
                <td className={shareSum !== 1 ? 'text-rose-600' : 'text-emerald-600'}>
                  {fmtPct(shareSum)}{' '}
                  {shareSum !== 1 && <span className="text-xs">（不为 100%，将自动归一化）</span>}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>
    </div>
  );
}

function Row({ label, desc, children }: { label: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[1fr,160px] items-center gap-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-slate-500 mt-0.5">{desc}</div>}
      </div>
      <div>{children}</div>
    </div>
  );
}
