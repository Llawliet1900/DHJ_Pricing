import { useState } from 'react';
import { unlockTeamPricing } from '../teamPricing';
import type { TeamPricingSession } from '../teamPricing';

export default function PasswordGate({ onUnlock }: { onUnlock: (session: TeamPricingSession) => void }) {
  const [accessKey, setAccessKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const session = await unlockTeamPricing(accessKey);
      setAccessKey('');
      onUnlock(session);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '无法加载团队定价。');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-4">
        <h1 className="text-lg font-semibold">DHJ 咖啡成本 &amp; 定价核算</h1>
        <div>
          <label htmlFor="team-access-key" className="block text-sm font-medium mb-1">团队访问密钥</label>
          <input
            id="team-access-key"
            type="password"
            className="dhj w-full"
            autoComplete="current-password"
            autoCapitalize="none"
            spellCheck={false}
            required
            autoFocus
            value={accessKey}
            onChange={(event) => setAccessKey(event.target.value)}
          />
        </div>
        {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
        <button className="dhj dhj-primary w-full" type="submit" disabled={loading}>
          {loading ? '正在加载团队定价…' : '解锁团队定价'}
        </button>
      </form>
    </div>
  );
}
