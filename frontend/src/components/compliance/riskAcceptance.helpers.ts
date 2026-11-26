// Pure helpers of the risk acceptance dialog and of the acceptance line shown
// under an accepted check.

export const JUSTIFICATION_MIN_LENGTH = 10
export const JUSTIFICATION_MAX_LENGTH = 1000

export function isJustificationValid(text: string): boolean {
  const length = text.trim().length
  return length >= JUSTIFICATION_MIN_LENGTH && length <= JUSTIFICATION_MAX_LENGTH
}

/** First day the expiry picker accepts (yyyy-mm-dd, local time). */
export function tomorrowIso(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** Body of the acceptance: the picked day counts until its last second, local time. */
export function acceptancePayload(checkId: string, justification: string, expiryDay: string) {
  const expires = expiryDay ? new Date(`${expiryDay}T23:59:59`) : null
  return {
    check_id: checkId,
    justification: justification.trim(),
    expires_at: expires && !Number.isNaN(expires.getTime()) ? expires.toISOString() : null,
  }
}

export interface AcceptanceView {
  justification: string
  acceptedBy: string
  acceptedAt: string
  expiresAt: string | null
}

/** Values of the "accepted by … on …" line, dates in the reader's locale. */
export function acceptanceLineValues(a: AcceptanceView, format: (d: Date) => string = d => d.toLocaleDateString()) {
  return { user: a.acceptedBy, date: format(new Date(a.acceptedAt)), until: a.expiresAt ? format(new Date(a.expiresAt)) : null }
}
