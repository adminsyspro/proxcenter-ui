// Date formatting for the License tab, in the UI locale. Invalid or missing
// dates read as a dash, never "Invalid Date".

const valid = (value) => {
  if (!value) return null
  const d = new Date(value)

  return Number.isFinite(d.getTime()) ? d : null
}

export function formatDate(value, locale, style = 'short') {
  const d = valid(value)

  return d ? new Intl.DateTimeFormat(locale, { dateStyle: style }).format(d) : '—'
}

export function formatDateTime(value, locale) {
  const d = valid(value)

  return d ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(d) : '—'
}

// "3 minutes ago", "2 days ago": the largest unit that is at least 1.
export function formatAgo(value, locale, now = Date.now()) {
  const d = valid(value)

  if (!d) return '—'
  const seconds = Math.round((d.getTime() - now) / 1000)
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const units = [['day', 86400], ['hour', 3600], ['minute', 60]]

  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit)
  }

  return rtf.format(0, 'minute')
}

// The portal page where a customer manages, renews or reassigns licenses:
// the portal this instance talks to, else proxcenter.io.
export function portalAccountUrl(portalUrl) {
  try {
    return new URL('/account/license', portalUrl).toString()
  } catch {
    return 'https://proxcenter.io/account/license'
  }
}

export const SUBSCRIBE_URL = 'https://proxcenter.io/account/subscribe'
