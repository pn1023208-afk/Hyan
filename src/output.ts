import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type Row = Record<string, unknown>

/** Rút gọn chuỗi dài để bảng trên terminal không bị vỡ. */
export function truncate(value: unknown, length = 60): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

export function table(rows: Row[]): void {
  if (rows.length === 0) {
    console.log('(không có dữ liệu)')
    return
  }
  console.table(rows)
}

function escapeCell(value: unknown): string {
  const text = String(value ?? '')
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return ''
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))]
  const lines = [columns.join(',')]
  for (const row of rows) {
    lines.push(columns.map((column) => escapeCell(row[column])).join(','))
  }
  return lines.join('\n')
}

export async function writeCsv(filePath: string, rows: Row[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true })
  // BOM để Excel trên Windows đọc đúng tiếng Việt.
  await writeFile(filePath, `﻿${toCsv(rows)}`, 'utf8')
  console.log(`Đã ghi ${rows.length} dòng vào ${filePath}`)
}
