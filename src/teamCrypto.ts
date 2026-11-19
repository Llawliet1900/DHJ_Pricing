const keyPattern = /^dhj_[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

type Purpose = 'published' | 'draft';

function fromBase64(value: string) {
  return Uint8Array.from(atob(value), (byte) => byte.charCodeAt(0));
}

function toBase64(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value);
}

export async function openTeamKey(input: string) {
  const value = input.trim();
  if (!keyPattern.test(value)) throw new Error('访问密钥格式不正确，请粘贴完整的团队访问密钥。');
  const bytes = fromBase64(value.slice(4).replace(/-/g, '+').replace(/_/g, '/') + '=');
  const key = await crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  const fingerprint = await crypto.subtle.digest('SHA-256', bytes);
  return { key, draftId: toBase64(new Uint8Array(fingerprint, 0, 12)) };
}

function cipherParams(iv: Uint8Array<ArrayBuffer>, purpose: Purpose) {
  return { name: 'AES-GCM', iv, additionalData: encoder.encode('dhj-pricing/v1/' + purpose) };
}

export async function openPricing(key: CryptoKey, envelope: unknown, purpose: Purpose) {
  if (!envelope || typeof envelope !== 'object' || !('v' in envelope) || envelope.v !== 1
    || !('iv' in envelope) || typeof envelope.iv !== 'string'
    || !('data' in envelope) || typeof envelope.data !== 'string') {
    throw new Error('加密文件格式无效。');
  }
  const iv = fromBase64(envelope.iv);
  const data = fromBase64(envelope.data);
  if (iv.length !== 12 || data.length < 16) throw new Error('加密文件格式无效。');
  const plaintext = await crypto.subtle.decrypt(cipherParams(iv, purpose), key, data);
  return decoder.decode(plaintext);
}

export async function sealDraft(key: CryptoKey, draft: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(cipherParams(iv, 'draft'), key, encoder.encode(draft));
  return JSON.stringify({ v: 1, iv: toBase64(iv), data: toBase64(new Uint8Array(encrypted)) });
}
