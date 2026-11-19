import { openPricing, openTeamKey, sealDraft } from './teamCrypto';
import type { AppState } from './types';

const LEGACY_STORAGE = 'dhj-cost-calc';

function readPublishedState(json: string): AppState {
  const data: AppState = JSON.parse(json);
  if (!data || !Array.isArray(data.costItems) || !Array.isArray(data.beans)
    || !Array.isArray(data.scenarios) || !Array.isArray(data.platforms)
    || !data.ratios || !data.profitInputs || !data.meta?.updatedAt
    || !Array.isArray(data.sales?.orders) || !Array.isArray(data.sales.specMappings)
    || !Array.isArray(data.sales.importedFiles) || !data.sales.analysis || !data.sales.platformConfig) {
    throw new Error('团队定价数据格式无效。');
  }
  return data;
}

export async function unlockTeamPricing(accessKey: string) {
  if (!globalThis.crypto?.subtle) throw new Error('请用支持 HTTPS 加密的浏览器打开网页。');
  const { key, draftId } = await openTeamKey(accessKey);
  const response = await fetch(import.meta.env.BASE_URL + 'team-pricing.encrypted.json', { cache: 'no-store' })
    .catch(() => null);
  if (!response?.ok) throw new Error('暂时无法加载团队定价，请稍后重试。');
  const envelope: unknown = await response.json();
  const json = await openPricing(key, envelope, 'published').catch(() => {
    throw new Error('无法解锁团队定价，请检查访问密钥。');
  });
  const publishedState = readPublishedState(json);
  const storageName = 'dhj-pricing-draft-v1-' + draftId;
  let previousDraft: string | null = null;
  let draftWarning = '';

  try {
    const saved = localStorage.getItem(storageName);
    if (saved) previousDraft = await openPricing(key, JSON.parse(saved), 'draft');

    const legacy = localStorage.getItem(LEGACY_STORAGE);
    if (legacy && !saved) {
      const oldDraft: { state?: AppState } = JSON.parse(legacy);
      if (oldDraft.state) {
        previousDraft = JSON.stringify(oldDraft.state);
        localStorage.setItem(storageName, await sealDraft(key, previousDraft));
        localStorage.removeItem(LEGACY_STORAGE);
      }
    }
  } catch {
    draftWarning = '本机草稿读取或迁移失败，团队定价已加载。';
  }

  let draftWrite = 0;
  return {
    publishedState,
    previousDraft,
    draftWarning,
    async saveDraft(content: string) {
      const write = ++draftWrite;
      const encrypted = await sealDraft(key, content);
      if (write === draftWrite) localStorage.setItem(storageName, encrypted);
    },
  };
}

export type TeamPricingSession = Awaited<ReturnType<typeof unlockTeamPricing>>;
