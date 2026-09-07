/**
 * Human form of an alert's measured value: at most one decimal, no trailing
 * ".0", the unit glued for a percentage and spaced otherwise. A stale
 * snapshot reads "8.8 days", not "8.789080648219757%" (discussion #875).
 *
 * The dashboard widgets used to append "%" to every value, which was wrong
 * for anything the orchestrator measures in days, ms or minutes, so the unit
 * now travels with the alert and an absent unit prints the bare number.
 * Returns null when there is nothing to show.
 */
export function formatAlertValue(value: unknown, unit?: string | null): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const num = String(Math.round(value * 10) / 10)
  if (!unit) return num
  return unit === '%' ? `${num}%` : `${num} ${unit}`
}
