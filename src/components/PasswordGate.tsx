import { useEffect, useState } from 'react';

/**
 * 前端密码门：
 * - 密码通过 SHA-256 哈希比对（避免明文），hash 在 .env / build 时注入
 * - 通过后在 sessionStorage 存标记，关掉浏览器就需要重新输入
 * - 注意：这只是"展示层的门禁"，不防专业破解。适合阻挡偶然访问的人。
 */

const SESSION_KEY = 'dhj_unlocked';

// 默认密码 'dhj123' 对应的 SHA-256（若未配置环境变量就用这个占位，方便用户首次登录后立刻改）
const DEFAULT_HASH = '6a37392241fa629e32bc7e1b711623d609a93dc9aa3d9b273b480b85ccae991c'; // sha256('dhj123')

export function useAuth() {
  const [unlocked, setUnlocked] = useState<boolean>(() => sessionStorage.getItem(SESSION_KEY) === '1');
  useEffect(() => {
    if (unlocked) sessionStorage.setItem(SESSION_KEY, '1');
  }, [unlocked]);
  return { unlocked, setUnlocked };
}

async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getConfiguredHash(): string {
  // Vite 允许在 build 时用 import.meta.env.VITE_PASSWORD_HASH 注入
  const envHash = (import.meta.env.VITE_PASSWORD_HASH as string | undefined) || '';
  return envHash || DEFAULT_HASH;
}

export default function PasswordGate({ onUnlock }: { onUnlock: () => void }) {
  const [pwd, setPwd] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      const hash = await sha256Hex(pwd);
      if (hash === getConfiguredHash()) {
        onUnlock();
      } else {
        setErr('密码错误');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-4">
        <div>
          <h1 className="text-lg font-semibold">DHJ 咖啡成本 & 定价核算</h1>
          <p className="text-sm text-slate-500 mt-1">请输入访问密码。</p>
        </div>
        <input
          type="password"
          className="dhj"
          placeholder="密码"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
          autoFocus
        />
        {err && <div className="text-sm text-rose-600">{err}</div>}
        <button className="dhj dhj-primary w-full" type="submit" disabled={loading}>
          {loading ? '校验中…' : '进入'}
        </button>
        <div className="text-[11px] text-slate-400 leading-relaxed">
          默认初始密码：<code>dhj123</code>。
          部署时可在 GitHub Secrets 里配置 <code>VITE_PASSWORD_HASH</code>（sha256 哈希）替换默认值。
          <br />生成命令：<code className="bg-slate-100 px-1">echo -n 'your-pwd' | shasum -a 256</code>
        </div>
      </form>
    </div>
  );
}
