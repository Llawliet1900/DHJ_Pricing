import { randomBytes, createCipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const [sourcePath, outputPath] = process.argv.slice(2);
if (!sourcePath || !outputPath) {
  throw new Error('Usage: node scripts/seal-team-pricing.mjs <source JSON> <encrypted output JSON>');
}

const accessKey = readFileSync(0, 'utf-8').trim();
if (!/^dhj_[A-Za-z0-9_-]{43}$/.test(accessKey)) {
  throw new Error('Provide the full team access key on stdin.');
}

const source = readFileSync(sourcePath);
const pricing = JSON.parse(source);
if (!Array.isArray(pricing?.costItems) || !Array.isArray(pricing.beans)
  || !Array.isArray(pricing.sales?.orders) || !pricing.meta?.updatedAt) {
  throw new Error('Expected a complete DHJ pricing export.');
}

const key = Buffer.from(accessKey.slice(4), 'base64url');
const iv = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', key, iv);
cipher.setAAD(Buffer.from('dhj-pricing/v1/published'));
const data = Buffer.concat([cipher.update(source), cipher.final(), cipher.getAuthTag()]);
writeFileSync(outputPath, JSON.stringify({ v: 1, iv: iv.toString('base64'), data: data.toString('base64') }) + '\n');
