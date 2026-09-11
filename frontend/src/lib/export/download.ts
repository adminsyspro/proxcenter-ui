/**
 * Shared export primitives.
 *
 * Every export built on this hands the browser exactly one file: there is no
 * archive to unzip and no format to pick.
 */

/**
 * One RFC 4180 cell: always quoted, embedded quotes doubled. Config diffs hold
 * commas, quotes and newlines, all three of which split a naively quoted cell
 * into garbage.
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '""'

  return `"${String(value).replace(/"/g, '""')}"`
}

export function toCsv(headers: readonly string[], rows: readonly (readonly unknown[])[]): string {
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n')
}

export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')

  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * Excel reads a UTF-8 CSV as the local codepage unless the file opens with a
 * BOM, which turns every accented or CJK label our six locales produce into
 * mojibake. The BOM is not part of the CSV, so it is added here and never in
 * toCsv().
 */
export function downloadCsv(csv: string, filename: string): void {
  downloadTextFile(`\uFEFF${csv}`, filename, 'text/csv;charset=utf-8')
}

export function downloadJson(value: unknown, filename: string): void {
  downloadTextFile(JSON.stringify(value, null, 2), filename, 'application/json')
}

/** Local date, so the filename carries the user's day and not UTC's. */
export function dateStamp(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Local `YYYY-MM-DD HH:MM:SS`, which spreadsheets parse and sort as a date. */
export function timestampCell(value: string | number | Date): string {
  const d = new Date(value)

  if (Number.isNaN(d.getTime())) return ''

  const pad = (n: number) => String(n).padStart(2, '0')

  return `${dateStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** Strips what a filesystem refuses, so a dashboard name can become a filename. */
export function filenameSlug(value: string): string {
  return (
    String(value)
      .normalize('NFKD')
      .replace(/[^\w.-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export'
  )
}
