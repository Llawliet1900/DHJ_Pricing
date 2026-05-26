/**
 * 订单数据导入：解析小红书后台导出的 .xlsx 文件 → SalesOrder[]
 *
 * 输入文件格式（22 列）：
 *   订单ID | 一级载体 | 二级载体 | 渠道 | 规格ID | 规格名称 | 商品ID | 商品名称
 *   订单用户id | 笔记ID | 笔记名称 | 笔记作者名称 | 笔记作者ID
 *   直播间ID | 直播间名称 | 主播
 *   支付时间 | 支付金额 | 支付件数
 *   归属账号小红书号 | 归属账号昵称 | 归属账号ID
 *
 * 文件名格式：`订单明细数据(YYYY-MM-DD~YYYY-MM-DD).xlsx`
 */
import * as XLSX from '@e965/xlsx';
import type { SalesOrder } from './types';

/** 一次导入的解析结果 */
export interface ParseResult {
  orders: SalesOrder[];
  fileName: string;
  rangeStart?: string;     // 从文件名解析
  rangeEnd?: string;
  rowCount: number;        // 原始行数
  skippedRows: number;     // 解析失败/缺关键字段的行数
  errors: string[];        // 仅首 5 条用于提示
}

/** 列名 → 字段映射（容错小写/全角/空格差异） */
const COL_MAP: Record<string, string> = {
  '订单id': 'orderId',
  '订单ID': 'orderId',
  '规格id': 'specId',
  '规格ID': 'specId',
  '规格名称': 'specName',
  '商品名称': 'productName',
  '支付时间': 'paidAt',
  '支付金额': 'grossAmount',
  '支付件数': 'quantity',
  '渠道': 'channel',
  '一级载体': 'carrier',
  '一级载体名称': 'carrier',
};

function normalizeKey(k: string): string {
  return String(k ?? '').trim();
}

/** 从文件名抓取时间区间 `订单明细数据(2026-04-25~2026-05-24).xlsx` */
export function extractRangeFromFilename(name: string): { start?: string; end?: string } {
  const m = name.match(/\((\d{4}-\d{2}-\d{2})\s*[~～\-]\s*(\d{4}-\d{2}-\d{2})\)/);
  if (!m) return {};
  return { start: m[1], end: m[2] };
}

/**
 * 标准化支付时间为 ISO 字符串。
 * 输入可能是 Excel 序号、'YYYY-MM-DD HH:MM:SS' 或 Date。
 */
function normalizePaidAt(v: unknown): string | null {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'number') {
    // Excel 日期序号：1900-01-01 起步（注意闰年 bug 修正）
    // XLSX.SSF.parse_date_code 给出 Date object
    const parsed = XLSX.SSF?.parse_date_code?.(v);
    if (parsed) {
      const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, parsed.S));
      return d.toISOString();
    }
    return null;
  }
  if (typeof v === 'string') {
    const s = v.trim().replace(/\//g, '-');
    // 'YYYY-MM-DD HH:MM:SS' 或 'YYYY-MM-DD'
    const d = new Date(s.includes('T') ? s : s.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return null;
}

function toNumber(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v.replace(/,/g, ''));
    return Number.isFinite(n) ? n : NaN;
  }
  return NaN;
}

/** 把一行（kv 对象）转成 SalesOrder；缺关键字段返回 null */
function rowToOrder(
  row: Record<string, unknown>,
  fileName: string,
  importedAt: string,
  idGen: () => string,
): { order: SalesOrder | null; reason?: string } {
  const get = (logical: string): unknown => {
    // 反向查表：在 row 里找哪些原始列名映射到这个 logical
    for (const [k, v] of Object.entries(COL_MAP)) {
      if (v !== logical) continue;
      const hit = Object.keys(row).find((rk) => normalizeKey(rk) === k);
      if (hit) return row[hit];
    }
    return undefined;
  };

  const orderId = String(get('orderId') ?? '').trim();
  const specId = String(get('specId') ?? '').trim();
  if (!orderId || !specId) return { order: null, reason: '缺少订单ID或规格ID' };

  const paidAt = normalizePaidAt(get('paidAt'));
  if (!paidAt) return { order: null, reason: '支付时间格式无法解析' };

  const grossAmount = toNumber(get('grossAmount'));
  const quantity = toNumber(get('quantity'));
  if (!Number.isFinite(grossAmount) || !Number.isFinite(quantity) || quantity <= 0) {
    return { order: null, reason: '支付金额或件数无效' };
  }

  return {
    order: {
      id: idGen(),
      orderId,
      specId,
      paidAt,
      productName: String(get('productName') ?? '').trim(),
      specName: String(get('specName') ?? '').trim(),
      quantity,
      grossAmount,
      channel: String(get('channel') ?? '').trim() || undefined,
      carrier: String(get('carrier') ?? '').trim() || undefined,
      source: fileName,
      importedAt,
    },
  };
}

/**
 * 解析一个 .xlsx 文件（Browser ArrayBuffer 或 Node Buffer）。
 * - 默认取第一个 sheet
 * - 自动识别表头行（找第一个包含「订单ID」或「订单id」的行）
 */
export function parseOrderXlsx(data: ArrayBuffer | Uint8Array, fileName: string): ParseResult {
  const wb = XLSX.read(data, { type: 'array', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const fileRange = extractRangeFromFilename(fileName);
  if (!sheet) {
    return {
      orders: [],
      fileName,
      rowCount: 0,
      skippedRows: 0,
      errors: ['Excel 文件中没有工作表'],
      rangeStart: fileRange.start,
      rangeEnd: fileRange.end,
    };
  }

  // 用 sheet_to_json 拿到 row[]，第一行作为表头
  const raw: Record<string, unknown>[] = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: true });

  const importedAt = new Date().toISOString();
  let counter = 0;
  const idGen = () => `so_${Date.now().toString(36)}_${(counter++).toString(36)}`;

  const orders: SalesOrder[] = [];
  const errors: string[] = [];
  let skipped = 0;

  for (let i = 0; i < raw.length; i++) {
    const { order, reason } = rowToOrder(raw[i], fileName, importedAt, idGen);
    if (order) orders.push(order);
    else {
      skipped++;
      if (errors.length < 5) errors.push(`第 ${i + 2} 行：${reason}`);
    }
  }

  return {
    orders,
    fileName,
    rowCount: raw.length,
    skippedRows: skipped,
    errors,
    rangeStart: fileRange.start,
    rangeEnd: fileRange.end,
  };
}

/**
 * 把新解析的订单合并到已有订单数组里，按 `orderId__specId` 去重。
 * 后到的覆盖先到的（增量更新如果有数据修正会以最新文件为准）。
 */
export function mergeOrders(existing: SalesOrder[], incoming: SalesOrder[]): {
  merged: SalesOrder[];
  added: number;
  duplicates: number;
} {
  const key = (o: SalesOrder) => `${o.orderId}__${o.specId}`;
  const map = new Map<string, SalesOrder>();
  for (const o of existing) map.set(key(o), o);
  let added = 0;
  let dup = 0;
  for (const o of incoming) {
    const k = key(o);
    if (map.has(k)) {
      dup++;
      map.set(k, o); // 用新版本覆盖
    } else {
      added++;
      map.set(k, o);
    }
  }
  // 排序：按 paidAt 升序
  const merged = Array.from(map.values()).sort(
    (a, b) => +new Date(a.paidAt) - +new Date(b.paidAt),
  );
  return { merged, added, duplicates: dup };
}
