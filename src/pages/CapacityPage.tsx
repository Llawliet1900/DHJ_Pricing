import { useStore } from '../store';
import { NumInput, TextInput } from '../components/Inputs';
import { capacityKgPerYear, fmtNum } from '../engine';

export default function CapacityPage() {
  const scenarios = useStore((s) => s.scenarios);
  const addScenario = useStore((s) => s.addScenario);
  const updateScenario = useStore((s) => s.updateScenario);
  const deleteScenario = useStore((s) => s.deleteScenario);

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between">
        <div>
          <h2 className="text-xl font-semibold">产能情景</h2>
          <p className="text-sm text-slate-500 mt-1">
            年产能 (kg) = 每周工时 × 每小时烘焙产出 × 每年工作周数。每个字段都可改。
          </p>
        </div>
        <button className="dhj dhj-primary" onClick={addScenario}>
          + 添加情景
        </button>
      </header>

      <div className="card overflow-hidden">
        <table className="dhj">
          <thead>
            <tr>
              <th>情景名</th>
              <th className="w-32">每周工时 (h)</th>
              <th className="w-32">kg / 小时</th>
              <th className="w-32">年工作周数</th>
              <th className="w-40">年产能 (kg 熟豆)</th>
              <th className="w-24">操作</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((sc) => {
              const kg = capacityKgPerYear(sc);
              return (
                <tr key={sc.id}>
                  <td>
                    <TextInput value={sc.name} onChange={(v) => updateScenario(sc.id, { name: v })} />
                  </td>
                  <td>
                    <NumInput value={sc.hoursPerWeek} step={0.5} digits={2} min={0}
                      onChange={(v) => updateScenario(sc.id, { hoursPerWeek: v })} />
                  </td>
                  <td>
                    <NumInput value={sc.kgPerHour} step={0.1} digits={2} min={0}
                      onChange={(v) => updateScenario(sc.id, { kgPerHour: v })} />
                  </td>
                  <td>
                    <NumInput value={sc.weeksPerYear} step={1} digits={0} min={0} max={52}
                      onChange={(v) => updateScenario(sc.id, { weeksPerYear: v })} />
                  </td>
                  <td className="font-semibold text-blue-600">{fmtNum(kg, 1)} kg</td>
                  <td>
                    <button className="dhj dhj-danger" onClick={() => deleteScenario(sc.id)}>
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="card p-4 text-sm text-slate-600">
        💡 说明：这里定义了 3 个默认情景（Low / Mid / High）。在【盈利总览】里可以切换选用哪个情景，
        以便在不同产能假设下查看盈亏情况。
      </div>
    </div>
  );
}
