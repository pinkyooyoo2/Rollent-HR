import type { Response } from 'express';

const BOM = '﻿';

function cell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Excel 호환 UTF-8 BOM CSV 문자열 생성 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  return BOM + [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function sendCsv(res: Response, filename: string, headers: string[], rows: unknown[][]) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="export.csv"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.send(toCsv(headers, rows));
}
