// CSV cell formatting for the audit export.
//
// The journal stores what the client sent: the actor column of a failed
// login is the raw email typed on the form, so a row can start with `=`,
// `+`, `-` or `@`. Opened in a spreadsheet, such a cell is evaluated as a
// formula (CSV injection, OWASP), and an embedded quote used to break the
// quoting of the whole line. Every cell is therefore quoted, quotes doubled,
// and a leading formula trigger neutralised with a quote prefix, which the
// spreadsheet shows as text.

/** First characters a spreadsheet interprets as the start of a formula. */
const FORMULA_TRIGGERS = new Set(['=', '+', '-', '@', '\t', '\r'])

export function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  const neutral = text.length > 0 && FORMULA_TRIGGERS.has(text[0]) ? `'${text}` : text

  return `"${neutral.replaceAll('"', '""')}"`
}

/** Rows (header first) to CSV text, one line per row, every cell quoted. */
export function toCsv(rows: readonly (readonly unknown[])[]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\n')
}
