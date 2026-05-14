/**
 * Strip CR/LF/control characters from a value before interpolating it into a
 * log line. Prevents log injection (CodeQL js/log-injection) when user-supplied
 * data flows into console.* calls.
 */
export function safeLog(v: unknown): string {
  const s = typeof v === "string" ? v : String(v)


return s.replace(/[\r\n\t\v\f\x00-\x1f\x7f]/g, " ").slice(0, 1024)
}
