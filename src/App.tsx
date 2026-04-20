import { useRef, useState } from 'react';
import PasswordGate, { useAuth } from './components/PasswordGate';
import CostItemsPage from './pages/CostItemsPage';
import RatiosPage from './pages/RatiosPage';
import CapacityPage from './pages/CapacityPage';
import BeansPage from './pages/BeansPage';
import ProfitPage from './pages/ProfitPage';
import AuditPage from './pages/AuditPage';
import { useStore } from './store';

type TabKey = 'cost' | 'ratio' | 'cap' | 'beans' | 'profit' | 'audit';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'cost',   label: '1. 成本项' },
  { key: 'ratio',  label: '2. 比例参数' },
  { key: 'cap',    label: '3. 产能' },
  { key: 'beans',  label: '4. 豆子配方' },
  { key: 'profit', label: '5. 盈利总览' },
  { key: 'audit',  label: '6. 计算校验' },
];

export default function App() {
  const { unlocked, setUnlocked } = useAuth();
  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />;
  return <Main />;
}

function Main() {
  const [tab, setTab] = useState<TabKey>('cost');
  const fileRef = useRef<HTMLInputElement>(null);
  const exportJson = useStore((s) => s.exportJson);
  const importJson = useStore((s) => s.importJson);
  const resetToDefault = useStore((s) => s.resetToDefault);

  function handleExport() {
    const text = exportJson();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.href = url;
    a.download = `dhj-pricing-${ts}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      const res = importJson(String(reader.result || ''));
      if (res.ok) alert('导入成功');
      else alert('导入失败：' + res.message);
    };
    reader.readAsText(f);
    e.target.value = '';
  }

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <h1 className="font-semibold">☕ DHJ 咖啡成本 &amp; 定价核算</h1>
          <nav className="flex gap-1 flex-wrap">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  tab === t.key ? 'bg-blue-600 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="ml-auto flex gap-2">
            <button className="dhj dhj-ghost" onClick={handleExport}>导出 JSON</button>
            <button className="dhj dhj-ghost" onClick={() => fileRef.current?.click()}>导入 JSON</button>
            <input ref={fileRef} type="file" accept="application/json" onChange={handleImport} hidden />
            <button
              className="dhj dhj-danger"
              onClick={() => {
                if (confirm('确定要重置为默认数据？当前的所有修改会丢失。建议先导出备份。')) resetToDefault();
              }}
            >重置默认</button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-4">
        {tab === 'cost' && <CostItemsPage />}
        {tab === 'ratio' && <RatiosPage />}
        {tab === 'cap' && <CapacityPage />}
        {tab === 'beans' && <BeansPage />}
        {tab === 'profit' && <ProfitPage />}
        {tab === 'audit' && <AuditPage />}
      </main>

      <footer className="max-w-7xl mx-auto p-4 text-center text-xs text-slate-400">
        数据保存在本地浏览器 localStorage；清缓存前记得导出 JSON 备份。
      </footer>
    </div>
  );
}
