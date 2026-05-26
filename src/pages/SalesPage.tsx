import { useRef, useState } from 'react';
import { useStore } from '../store';
import { parseOrderXlsx } from '../salesImport';
import { Select } from '../components/Inputs';
import {
  computeRunRate,
  computeSalesSummary,
  filterOrdersByWindow,
  fmtCNY,
  fmtNum,
} from '../engine';
import type { SalesOrder } from '../types';

/**
 * 实销分析页（Sales）
 *
 * 上半部分：导入 + 规格映射
 *   - 拖拽/选择 .xlsx → 解析 → 显示导入摘要
 *   - 显示已识别的规格 ID 与豆款映射；未映射的让用户手动指认
 *
 * 下半部分（Step 4-C 续）：KPI + 汇总表 + 折线图
 */
export default function SalesPage() {
  const orders = useStore((s) => s.sales.orders);
  const specMappings = useStore((s) => s.sales.specMappings);
  const importedFiles = useStore((s) => s.sales.importedFiles);
  const salesStartDate = useStore((s) => s.sales.salesStartDate);
  const platformCfg = useStore((s) => s.sales.platformConfig);
  const analysis = useStore((s) => s.sales.analysis);
  const beans = useStore((s) => s.beans);
  const state = useStore((s) => s); // 整体 state 用于 engine 函数

  const importSalesOrders = useStore((s) => s.importSalesOrders);
  const clearSalesOrders = useStore((s) => s.clearSalesOrders);
  const updateSpecMapping = useStore((s) => s.updateSpecMapping);
  const updateSalesPlatform = useStore((s) => s.updateSalesPlatform);
  const updateSalesAnalysis = useStore((s) => s.updateSalesAnalysis);
  const exportJson = useStore((s) => s.exportJson);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importMsg, setImportMsg] = useState<{
    ok: boolean;
    text: string;
    detail?: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // ============ 导入 ============
  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setImportMsg(null);
    try {
      const summaries: string[] = [];
      let totalAdded = 0;
      let totalDup = 0;
      let totalSkipped = 0;
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        const parsed = parseOrderXlsx(buf, file.name);
        const { added, duplicates } = importSalesOrders(parsed.orders, {
          name: file.name,
          rangeStart: parsed.rangeStart,
          rangeEnd: parsed.rangeEnd,
          rows: parsed.orders.length,
        });
        totalAdded += added;
        totalDup += duplicates;
        totalSkipped += parsed.skippedRows;
        const range =
          parsed.rangeStart && parsed.rangeEnd
            ? ` (${parsed.rangeStart}~${parsed.rangeEnd})`
            : '';
        summaries.push(
          `${file.name}${range}：解析 ${parsed.rowCount} 行 → 新增 ${added} / 重复 ${duplicates} / 跳过 ${parsed.skippedRows}`,
        );
        if (parsed.errors.length > 0) {
          for (const e of parsed.errors) summaries.push(`  ⚠ ${e}`);
        }
      }
      setImportMsg({
        ok: true,
        text: `共导入 ${files.length} 个文件：新增 ${totalAdded} 条 / 重复 ${totalDup} 条 / 跳过 ${totalSkipped} 条`,
        detail: summaries,
      });
    } catch (e) {
      setImportMsg({ ok: false, text: `导入失败：${(e as Error).message}` });
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function handleExportBackup() {
    const json = exportJson();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `dhj-pricing-backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // 拖拽
  function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  // ============ 规格映射 ============
  const unmappedCount = specMappings.filter((m) => m.unmapped).length;

  // 该 specId 在订单里出现几次
  const ordersBySpec = new Map<string, number>();
  for (const o of orders) {
    ordersBySpec.set(o.specId, (ordersBySpec.get(o.specId) ?? 0) + 1);
  }

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">实销分析</h2>
          <p className="text-sm text-slate-500 mt-1">
            导入小红书后台导出的订单明细 .xlsx，自动按规格 ID 聚合并对照豆款。
            {salesStartDate && (
              <>
                {' '}销售起始日：<span className="font-medium">{salesStartDate}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="dhj dhj-ghost" onClick={handleExportBackup} title="导出全部数据为 JSON 备份">
            导出备份
          </button>
        </div>
      </header>

      {/* 导入区 */}
      <div
        className="card p-4 space-y-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="font-medium">📥 导入订单数据</h3>
            <p className="text-xs text-slate-500 mt-1">
              支持小红书后台导出的「订单明细数据」.xlsx 文件（22 列格式）。
              按 <code className="text-[11px] bg-slate-100 px-1 rounded">订单ID + 规格ID</code> 自动去重，
              重复导入同月数据不会增加重复记录，可放心增量更新。
            </p>
          </div>
          <div className="flex gap-2 flex-shrink-0">
            <button
              className="dhj dhj-primary"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
            >
              {busy ? '解析中…' : '选择 .xlsx 文件'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls"
              multiple
              hidden
              onChange={(e) => handleFiles(e.target.files)}
            />
          </div>
        </div>

        <div className="text-xs text-slate-500 border-2 border-dashed border-slate-200 rounded p-3 text-center">
          也可以把 .xlsx 文件拖到这里
        </div>

        {importMsg && (
          <div
            className={`text-sm rounded p-3 ${
              importMsg.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'
            }`}
          >
            <div className="font-medium">{importMsg.text}</div>
            {importMsg.detail && importMsg.detail.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs opacity-80">
                {importMsg.detail.map((d, i) => (
                  <li key={i}>{d}</li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 数据现状 + 已导入文件 */}
        <div className="text-xs text-slate-600 grid grid-cols-2 md:grid-cols-4 gap-2 pt-1">
          <div>
            订单条数：<span className="font-medium">{orders.length}</span>
          </div>
          <div>
            涉及规格：<span className="font-medium">{specMappings.length}</span>
          </div>
          <div>
            未映射规格：
            <span className={`font-medium ${unmappedCount > 0 ? 'text-amber-600' : ''}`}>
              {unmappedCount}
            </span>
          </div>
          <div>
            已导入文件：<span className="font-medium">{importedFiles.length}</span>
          </div>
        </div>

        {importedFiles.length > 0 && (
          <details className="text-xs text-slate-500">
            <summary className="cursor-pointer hover:text-slate-700">已导入文件清单</summary>
            <table className="dhj mt-2">
              <thead>
                <tr>
                  <th>文件名</th>
                  <th>区间</th>
                  <th>行数</th>
                  <th>导入时间</th>
                </tr>
              </thead>
              <tbody>
                {importedFiles.map((f) => (
                  <tr key={f.name}>
                    <td className="text-xs">{f.name}</td>
                    <td>
                      {f.rangeStart && f.rangeEnd
                        ? `${f.rangeStart} ~ ${f.rangeEnd}`
                        : '—'}
                    </td>
                    <td>{f.rows}</td>
                    <td>{f.importedAt.slice(0, 16).replace('T', ' ')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}

        {orders.length > 0 && (
          <div className="pt-2 border-t border-slate-100">
            <button
              className="dhj dhj-danger text-xs"
              onClick={() => {
                if (confirm('确定清空所有订单数据吗？规格映射会保留。')) clearSalesOrders();
              }}
            >
              清空订单数据
            </button>
          </div>
        )}
      </div>

      {/* 平台配置 */}
      <div className="card p-4 space-y-2">
        <h3 className="font-medium">🏪 平台配置</h3>
        <p className="text-xs text-slate-500">
          订单中的「支付金额」是 GMV，未扣平台佣金。系统会按下方费率自动扣除。
        </p>
        <div className="flex items-center gap-3 pt-1">
          <span className="text-sm">平台：</span>
          <input
            type="text"
            className="border rounded px-2 py-1 text-sm w-32"
            value={platformCfg.defaultPlatform}
            onChange={(e) => updateSalesPlatform({ defaultPlatform: e.target.value })}
          />
          <span className="text-sm ml-2">佣金率：</span>
          <input
            type="number"
            step="0.001"
            className="border rounded px-2 py-1 text-sm w-24 text-right"
            value={platformCfg.defaultFeeRate}
            onChange={(e) =>
              updateSalesPlatform({ defaultFeeRate: parseFloat(e.target.value) || 0 })
            }
          />
          <span className="text-xs text-slate-500">
            （= {(platformCfg.defaultFeeRate * 100).toFixed(2)}%；小红书约 0.8-1%）
          </span>
        </div>
      </div>

      {/* 规格映射区 */}
      <div className="card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">
            🔗 规格映射
            {unmappedCount > 0 && (
              <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">
                {unmappedCount} 个未映射
              </span>
            )}
          </h3>
        </div>
        <p className="text-xs text-slate-500">
          每个规格 ID 都需要对应到豆款 + 规格变体。系统已尝试自动匹配，
          <span className="text-amber-700">未映射的需要手动指认</span>，否则相关订单会从分析中跳过。
        </p>

        {specMappings.length === 0 ? (
          <div className="text-sm text-slate-400 py-4 text-center">
            还没有数据。请先导入订单文件。
          </div>
        ) : (
          <table className="dhj">
            <thead>
              <tr>
                <th>规格 ID</th>
                <th>原商品名 / 规格</th>
                <th>订单数</th>
                <th>豆款</th>
                <th>规格变体</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {specMappings.map((m) => {
                const bean = beans.find((b) => b.id === m.beanId);
                return (
                  <tr key={m.specId}>
                    <td>
                      <code className="text-[11px] text-slate-500">…{m.specId.slice(-10)}</code>
                    </td>
                    <td className="text-xs">
                      <div className="font-medium text-slate-700">{m.productName}</div>
                      <div className="text-slate-500">{m.specName}</div>
                    </td>
                    <td className="text-center">{ordersBySpec.get(m.specId) ?? 0}</td>
                    <td>
                      <Select
                        value={m.beanId ?? ''}
                        onChange={(v) =>
                          updateSpecMapping(m.specId, {
                            beanId: v || null,
                            // 切换豆款 → 清空 variant
                            variantId: null,
                          })
                        }
                        options={[
                          { value: '', label: '— 未指定 —' },
                          ...beans.map((b) => ({ value: b.id, label: b.name })),
                        ]}
                      />
                    </td>
                    <td>
                      <Select
                        value={m.variantId ?? ''}
                        onChange={(v) => updateSpecMapping(m.specId, { variantId: v || null })}
                        options={[
                          { value: '', label: '— 未指定 —' },
                          ...(bean?.variants.map((v) => ({
                            value: v.id,
                            label: v.label || `${v.weightG}g`,
                          })) ?? []),
                        ]}
                      />
                    </td>
                    <td>
                      {m.unmapped ? (
                        <span className="text-amber-600 text-xs">⚠ 未映射</span>
                      ) : (
                        <span className="text-green-600 text-xs">✓ 已映射</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ============ 分析区（仅当有订单时显示） ============ */}
      {orders.length > 0 && <AnalysisSection state={state} analysis={analysis} onChangeAnalysis={updateSalesAnalysis} />}
    </div>
  );
}

// ===========================================================
// 下方为分析区（KPI / 跑速 / 汇总表 / 折线图）相关组件
// ===========================================================

interface AnalysisProps {
  state: ReturnType<typeof useStore.getState>;
  analysis: ReturnType<typeof useStore.getState>['sales']['analysis'];
  onChangeAnalysis: (patch: Partial<AnalysisProps['analysis']>) => void;
}

function AnalysisSection({ state, analysis, onChangeAnalysis }: AnalysisProps) {
  const orders = state.sales.orders;
  const includeLogistics = analysis.freeShipping; // 包邮 = 物流计入成本

  // 累计（全部历史）
  const summary = computeSalesSummary(state, orders, includeLogistics);

  // 跑速（按窗口）
  const windowOrders = filterOrdersByWindow(
    orders,
    analysis.windowMode,
    analysis.windowDays,
    analysis.customStart,
    analysis.customEnd,
  );
  const runRate = computeRunRate(state, windowOrders, includeLogistics);

  return (
    <>
      {/* ---- 4 张主 KPI ---- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="累计 GMV" value={fmtCNY(summary.totals.grossRevenue)} tone="blue" />
        <Kpi
          label="累计净利润（按天数摊运营）"
          value={fmtCNY(summary.totals.netProfitByDays)}
          tone={summary.totals.netProfitByDays >= 0 ? 'emerald' : 'rose'}
        />
        <Kpi
          label={`近 ${runRate.windowDays || 0} 天年化净利`}
          value={fmtCNY(runRate.annualNetProfit)}
          tone={runRate.annualNetProfit >= 0 ? 'emerald' : 'rose'}
        />
        <Kpi label="累计订单 / 袋数" value={`${orders.length} 单 / ${summary.totals.quantity} 袋`} />
      </div>

      {/* ---- 控制条 ---- */}
      <div className="card p-3 flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">分析参数：</span>

        <span className="text-slate-600">跑速窗口</span>
        <Select
          value={analysis.windowMode}
          onChange={(v) => onChangeAnalysis({ windowMode: v as 'all' | 'days' | 'custom' })}
          options={[
            { value: 'all', label: '全部历史' },
            { value: 'days', label: `最近 N 天` },
            { value: 'custom', label: '自定义区间' },
          ]}
        />
        {analysis.windowMode === 'days' && (
          <input
            type="number"
            min={1}
            className="border rounded px-2 py-1 w-20 text-right"
            value={analysis.windowDays}
            onChange={(e) => onChangeAnalysis({ windowDays: parseInt(e.target.value, 10) || 14 })}
          />
        )}
        {analysis.windowMode === 'custom' && (
          <>
            <input
              type="date"
              className="border rounded px-2 py-1"
              value={analysis.customStart ?? ''}
              onChange={(e) => onChangeAnalysis({ customStart: e.target.value })}
            />
            <span>~</span>
            <input
              type="date"
              className="border rounded px-2 py-1"
              value={analysis.customEnd ?? ''}
              onChange={(e) => onChangeAnalysis({ customEnd: e.target.value })}
            />
          </>
        )}

        <span className="text-slate-600 ml-3">物流</span>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={analysis.freeShipping}
            onChange={() => onChangeAnalysis({ freeShipping: true })}
          />
          包邮（计入成本）
        </label>
        <label className="flex items-center gap-1">
          <input
            type="radio"
            checked={!analysis.freeShipping}
            onChange={() => onChangeAnalysis({ freeShipping: false })}
          />
          不包邮
        </label>
      </div>

      {/* ---- 累计 vs 跑速 双口径对照 ---- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <CumulativeCard summary={summary} platformFee={state.sales.platformConfig.defaultFeeRate} />
        <RunRateCard runRate={runRate} platformFee={state.sales.platformConfig.defaultFeeRate} />
      </div>

      {/* ---- 按 SKU 明细表 ---- */}
      <div className="card overflow-hidden">
        <div className="px-4 py-2 border-b bg-slate-50 font-medium flex items-center justify-between">
          <span>📋 各 SKU 实销明细</span>
          <span className="text-xs text-slate-500">
            累计跨度 {summary.spanDays} 天 · {summary.unmappedCount > 0 ? `${summary.unmappedCount} 笔订单未映射已跳过` : '全部已映射'}
          </span>
        </div>
        <table className="dhj">
          <thead>
            <tr>
              <th>豆款 / 规格</th>
              <th className="w-20 text-right">袋数</th>
              <th className="w-20 text-right">订单数</th>
              <th className="w-24 text-right">累计 GMV</th>
              <th className="w-24 text-right">均价/袋</th>
              <th className="w-20 text-right">最低价</th>
              <th className="w-20 text-right">最高价</th>
              <th className="w-24 text-right">变动成本</th>
              <th className="w-20 text-right">营销</th>
              <th className="w-24 text-right">毛利</th>
              <th className="w-20 text-right">毛利率*</th>
              <th className="w-24 text-right">单袋净利*</th>
            </tr>
          </thead>
          <tbody>
            {summary.rows.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center text-slate-400 py-4">
                  暂无可分析数据（请先映射规格）
                </td>
              </tr>
            ) : (
              summary.rows.map((r) => {
                const margin = r.grossRevenue > 0 ? r.grossProfit / r.grossRevenue : 0;
                const unitNet = r.quantity > 0 ? r.grossProfit / r.quantity : 0;
                // 算这个 SKU 在所有订单里的单袋价格区间
                const mapping = state.sales.specMappings.find(
                  (m) => m.beanId === r.beanId && m.variantId === r.variantId,
                );
                const skuOrders = mapping
                  ? state.sales.orders.filter((o) => o.specId === mapping.specId)
                  : [];
                const prices = skuOrders.map((o) => o.grossAmount / o.quantity);
                const minP = prices.length ? Math.min(...prices) : 0;
                const maxP = prices.length ? Math.max(...prices) : 0;
                return (
                  <tr key={`${r.beanId}_${r.variantId}`}>
                    <td>
                      <span className="font-medium">{r.beanName}</span>
                      <span className="text-slate-500 text-xs ml-1">{r.variantLabel}</span>
                    </td>
                    <td className="text-right">{r.quantity}</td>
                    <td className="text-right">{r.orderCount}</td>
                    <td className="text-right">{fmtCNY(r.grossRevenue)}</td>
                    <td className="text-right">{fmtCNY(r.unitPriceAvg)}</td>
                    <td className="text-right text-slate-600">{prices.length ? fmtCNY(minP) : '—'}</td>
                    <td className="text-right text-slate-600">{prices.length ? fmtCNY(maxP) : '—'}</td>
                    <td className="text-right">{fmtCNY(r.variableCost)}</td>
                    <td className="text-right">{fmtCNY(r.marketing)}</td>
                    <td className={`text-right ${r.grossProfit < 0 ? 'text-rose-600' : ''}`}>
                      {fmtCNY(r.grossProfit)}
                    </td>
                    <td className={`text-right ${margin < 0 ? 'text-rose-600' : ''}`}>
                      {(margin * 100).toFixed(1)}%
                    </td>
                    <td className={`text-right ${unitNet < 0 ? 'text-rose-600' : ''}`}>
                      {fmtCNY(unitNet)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
        <div className="px-4 py-2 text-xs text-slate-500 border-t bg-slate-50">
          * 毛利率与单袋净利 = (净收入 − 变动成本 − 营销) ÷ GMV/袋数；尚未扣运营摊销，运营请看上方"累计/跑速"对照卡。
        </div>
      </div>

      {/* ---- 单袋实收价 时间折线图 ---- */}
      <PriceTrendChart orders={orders} mappings={state.sales.specMappings} platformFee={state.sales.platformConfig.defaultFeeRate} />
    </>
  );
}

function Kpi({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'blue' | 'emerald' | 'rose' | 'slate';
}) {
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

function CumulativeCard({ summary, platformFee }: { summary: ReturnType<typeof computeSalesSummary>; platformFee: number }) {
  const t = summary.totals;
  return (
    <div className="card p-4 space-y-1.5 text-sm">
      <div className="font-medium pb-1 border-b">📈 累计实销（{summary.spanDays} 天）</div>
      <Row label="GMV（支付金额合计）" value={fmtCNY(t.grossRevenue)} />
      <Row label={`− 平台佣金 ${(platformFee * 100).toFixed(2)}%`} value={fmtCNY(-(t.grossRevenue - t.netRevenue))} muted />
      <Row label="= 净收入" value={fmtCNY(t.netRevenue)} bold />
      <Row label={`− 变动成本（生豆+包装+物流）`} value={fmtCNY(-t.variableCost)} muted />
      <Row label="− 营销费" value={fmtCNY(-t.marketing)} muted />
      <Row label="= 毛利" value={fmtCNY(t.grossProfit)} bold tone={t.grossProfit >= 0 ? 'emerald' : 'rose'} />
      <div className="pt-2 border-t border-dashed text-xs space-y-1">
        <div className="text-slate-500 mb-1">运营成本摊销（两种口径并列）：</div>
        <Row
          label={`└ 按天数摊（${summary.spanDays}/365）`}
          value={fmtCNY(-t.operationByDays)}
          muted
        />
        <Row
          label="净利润（按天数摊）"
          value={fmtCNY(t.netProfitByDays)}
          bold
          tone={t.netProfitByDays >= 0 ? 'emerald' : 'rose'}
        />
        <Row label="└ 按销量摊（vs 当前情景）" value={fmtCNY(-t.operationByVolume)} muted />
        <Row
          label="净利润（按销量摊）"
          value={fmtCNY(t.netProfitByVolume)}
          bold
          tone={t.netProfitByVolume >= 0 ? 'emerald' : 'rose'}
        />
      </div>
    </div>
  );
}

function RunRateCard({ runRate, platformFee }: { runRate: ReturnType<typeof computeRunRate>; platformFee: number }) {
  const r = runRate;
  return (
    <div className="card p-4 space-y-1.5 text-sm">
      <div className="font-medium pb-1 border-b">🚀 跑速年化预估</div>
      <div className="text-xs text-slate-500">
        基于窗口内 {r.windowOrders} 单 / {r.windowDays} 天，日均 GMV {fmtCNY(r.dailyGmv)}（约 {fmtNum(r.dailyQuantity, 1)} 袋/天）
      </div>
      <div className="pt-1">
        <Row label="年化 GMV" value={fmtCNY(r.annualGmv)} />
        <Row label={`− 平台佣金 ${(platformFee * 100).toFixed(2)}%`} value={fmtCNY(-(r.annualGmv - r.annualNetRevenue))} muted />
        <Row label="= 年化净收入" value={fmtCNY(r.annualNetRevenue)} bold />
        <Row label="− 年化变动成本" value={fmtCNY(-r.annualVariableCost)} muted />
        <Row label="− 年化营销" value={fmtCNY(-r.annualMarketing)} muted />
        <Row
          label="= 年化毛利"
          value={fmtCNY(r.annualGrossProfit)}
          bold
          tone={r.annualGrossProfit >= 0 ? 'emerald' : 'rose'}
        />
        <Row label="− 全年运营成本" value={fmtCNY(-r.annualOperation)} muted />
        <Row
          label="= 年化净利润"
          value={fmtCNY(r.annualNetProfit)}
          bold
          tone={r.annualNetProfit >= 0 ? 'emerald' : 'rose'}
        />
      </div>
      {r.perVariantAnnualQty.length > 0 && (
        <details className="pt-2 border-t border-dashed text-xs">
          <summary className="cursor-pointer text-slate-500">按 SKU 年化销量</summary>
          <table className="dhj mt-2">
            <thead>
              <tr>
                <th>SKU</th>
                <th className="text-right">年化袋数</th>
                <th className="text-right">年化 kg</th>
              </tr>
            </thead>
            <tbody>
              {r.perVariantAnnualQty.map((v) => (
                <tr key={`${v.beanId}_${v.variantId}`}>
                  <td>
                    {v.beanName} <span className="text-slate-500">{v.variantLabel}</span>
                  </td>
                  <td className="text-right">{fmtNum(v.annualQty, 0)}</td>
                  <td className="text-right">{fmtNum(v.annualKg, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  muted,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  muted?: boolean;
  tone?: 'emerald' | 'rose';
}) {
  const cls = [
    'flex justify-between',
    bold ? 'font-semibold' : '',
    muted ? 'text-slate-500' : '',
    tone === 'emerald' ? 'text-emerald-700' : '',
    tone === 'rose' ? 'text-rose-700' : '',
  ].join(' ');
  return (
    <div className={cls}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

/** 单袋实收价随时间的折线图（SVG，自包含） */
function PriceTrendChart({
  orders,
  mappings,
  platformFee,
}: {
  orders: SalesOrder[];
  mappings: ReturnType<typeof useStore.getState>['sales']['specMappings'];
  platformFee: number;
}) {
  // 仅取已映射的订单；按 (beanId+variantId) 分组
  const mapBySpec = new Map(mappings.map((m) => [m.specId, m]));
  type Pt = { t: number; pricePerPack: number; netPerPack: number; orderCount: number; bagCount: number };
  type Group = {
    beanId: string;
    variantId: string;
    name: string;
    weightG: number;
    pts: Pt[];
    // 同日聚合用：按 YYYY-MM-DD → 累加 GMV / 袋数 / 笔数
    daily: Map<string, { gmv: number; qty: number; orders: number; t: number }>;
  };
  const groups = new Map<string, Group>();

  for (const o of orders) {
    const m = mapBySpec.get(o.specId);
    if (!m || m.unmapped) continue;
    const key = `${m.beanId}__${m.variantId}`;
    let g = groups.get(key);
    if (!g) {
      const weightMatch = m.specName.match(/(\d+)\s*g/i);
      const weightG = weightMatch ? parseInt(weightMatch[1], 10) : 0;
      g = {
        beanId: m.beanId ?? '',
        variantId: m.variantId ?? '',
        name: `${m.productName.slice(0, 12)} · ${m.specName.match(/(\d+\s*g)/)?.[1] ?? ''}`,
        weightG,
        pts: [],
        daily: new Map(),
      };
      groups.set(key, g);
    }
    // 用当天 00:00 作为 bucket key，避免 timezone 问题用 paidAt 头 10 位
    const day = o.paidAt.slice(0, 10);
    const cell = g.daily.get(day) ?? { gmv: 0, qty: 0, orders: 0, t: +new Date(day) };
    cell.gmv += o.grossAmount;
    cell.qty += o.quantity;
    cell.orders += 1;
    g.daily.set(day, cell);
  }

  // 把每组的 daily map 展开为加权均价点
  for (const g of groups.values()) {
    for (const cell of g.daily.values()) {
      const price = cell.qty > 0 ? cell.gmv / cell.qty : 0;
      g.pts.push({
        t: cell.t,
        pricePerPack: price,
        netPerPack: price * (1 - platformFee),
        orderCount: cell.orders,
        bagCount: cell.qty,
      });
    }
    g.pts.sort((a, b) => a.t - b.t);
  }

  if (groups.size === 0) {
    return (
      <div className="card p-4 text-sm text-slate-400 text-center">
        无可绘制的价格趋势（暂无已映射订单）
      </div>
    );
  }

  // 按豆款分组配色：同一 beanId 的多个 variant 用同色系深浅
  // [深色, 浅色] 一组，再多了就回退到默认 palette
  const BEAN_PALETTES: Record<string, string[]> = {};
  const PALETTE_POOL = [
    ['#1d4ed8', '#60a5fa'], // 蓝
    ['#c2410c', '#fdba74'], // 橙
    ['#15803d', '#86efac'], // 绿
    ['#7e22ce', '#c4b5fd'], // 紫
    ['#be123c', '#fda4af'], // 玫红
    ['#0e7490', '#67e8f9'], // 青
  ];
  // 先按 beanId 出现顺序给每个 bean 分配一组色板
  const beanIdOrder: string[] = [];
  for (const g of groups.values()) {
    if (!beanIdOrder.includes(g.beanId)) beanIdOrder.push(g.beanId);
  }
  beanIdOrder.forEach((bid, i) => {
    BEAN_PALETTES[bid] = PALETTE_POOL[i % PALETTE_POOL.length];
  });
  // variant 在 bean 内按重量排序：克重小的用深色，大的用浅色
  const colorOf = (g: Group): string => {
    const palette = BEAN_PALETTES[g.beanId] ?? ['#475569', '#94a3b8'];
    // 同 bean 下的所有 variants 按 weightG 升序
    const siblings = Array.from(groups.values()).filter((x) => x.beanId === g.beanId);
    siblings.sort((a, b) => a.weightG - b.weightG);
    const idx = siblings.findIndex((x) => x.variantId === g.variantId);
    return palette[idx % palette.length] ?? palette[0];
  };

  // 计算 x/y 范围
  let tMin = Infinity;
  let tMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const g of groups.values()) {
    for (const p of g.pts) {
      if (p.t < tMin) tMin = p.t;
      if (p.t > tMax) tMax = p.t;
      if (p.pricePerPack < yMin) yMin = p.pricePerPack;
      if (p.pricePerPack > yMax) yMax = p.pricePerPack;
    }
  }
  if (tMin === tMax) tMax = tMin + 86400_000;
  if (yMin === yMax) yMax = yMin + 10;
  const yRange = yMax - yMin;
  yMin = Math.max(0, yMin - yRange * 0.1);
  yMax = yMax + yRange * 0.15;

  const W = 720;
  const H = 240;
  const padL = 48;
  const padR = 16;
  const padT = 16;
  const padB = 30;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const x = (t: number) => padL + ((t - tMin) / (tMax - tMin)) * plotW;
  const y = (v: number) => padT + (1 - (v - yMin) / (yMax - yMin)) * plotH;

  // y 轴刻度（5 档）
  const ticks: number[] = [];
  for (let i = 0; i <= 4; i++) ticks.push(yMin + (yMax - yMin) * (i / 4));

  // x 轴 4 个日期标签
  const xTicks: number[] = [];
  for (let i = 0; i <= 3; i++) xTicks.push(tMin + (tMax - tMin) * (i / 3));

  const fmtDate = (t: number) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // 排序图例顺序：先按豆款（beanIdOrder），再按克重升序
  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const ai = beanIdOrder.indexOf(a.beanId);
    const bi = beanIdOrder.indexOf(b.beanId);
    if (ai !== bi) return ai - bi;
    return a.weightG - b.weightG;
  });

  return (
    <div className="card p-4">
      <div className="font-medium mb-2">📉 单袋实收价时间趋势</div>
      <div className="text-xs text-slate-500 mb-3">
        每个点代表「该 SKU 在该日」的加权均价（= 当日 ΣGMV ÷ Σ袋数）。同款豆的不同规格用同色系深浅区分。
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: '100%' }}>
        {/* 网格 + y 轴刻度 */}
        {ticks.map((v, i) => (
          <g key={i}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth={1} />
            <text x={padL - 6} y={y(v) + 3} fontSize="10" textAnchor="end" fill="#64748b">
              ¥{v.toFixed(0)}
            </text>
          </g>
        ))}
        {/* x 轴 */}
        <line x1={padL} x2={W - padR} y1={H - padB} y2={H - padB} stroke="#cbd5e1" />
        {xTicks.map((t, i) => (
          <text key={i} x={x(t)} y={H - padB + 14} fontSize="10" textAnchor="middle" fill="#64748b">
            {fmtDate(t)}
          </text>
        ))}
        {/* 每组一条折线 + 散点 */}
        {sortedGroups.map((g) => {
          const color = colorOf(g);
          const d = g.pts
            .map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p.t).toFixed(1)} ${y(p.pricePerPack).toFixed(1)}`)
            .join(' ');
          return (
            <g key={`${g.beanId}_${g.variantId}`}>
              <path d={d} fill="none" stroke={color} strokeWidth={1.5} opacity={0.85} />
              {g.pts.map((p, i) => (
                <circle key={i} cx={x(p.t)} cy={y(p.pricePerPack)} r={3.5} fill={color}>
                  <title>
                    {`${g.name}\n${new Date(p.t).toLocaleDateString()}\n当日均价 ¥${p.pricePerPack.toFixed(2)} / 扣佣 ¥${p.netPerPack.toFixed(2)}\n${p.orderCount} 单 / ${p.bagCount} 袋`}
                  </title>
                </circle>
              ))}
            </g>
          );
        })}
      </svg>
      {/* 图例 */}
      <div className="flex flex-wrap gap-3 mt-2 text-xs">
        {sortedGroups.map((g) => (
          <div key={`${g.beanId}_${g.variantId}`} className="flex items-center gap-1.5">
            <span
              className="inline-block w-3 h-3 rounded-sm"
              style={{ backgroundColor: colorOf(g) }}
            />
            <span className="text-slate-700">{g.name}</span>
            <span className="text-slate-400">（{g.pts.length} 天 / {g.pts.reduce((s, p) => s + p.orderCount, 0)} 单）</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// 抑制未使用变量警告
void fmtCNYNum;
function fmtCNYNum(n: number): string {
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
