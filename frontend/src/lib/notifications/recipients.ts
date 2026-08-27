/**
 * Recipient lists are free text typed by humans, and humans separate addresses
 * with whatever their mail client taught them: a comma, a semicolon (Outlook),
 * or one address per line in a multiline field. Accept all three on input and
 * always hand the backend one address per array entry.
 *
 * This matters beyond cosmetics: the orchestrator passes each entry straight to
 * `RCPT TO`, so a glued entry such as "a@x.tld; b@y.tld" is rejected by the SMTP
 * server and the whole notification fails to leave, for every recipient.
 */

const SEPARATORS = /[,;\r\n]+/

/** Split raw field text into trimmed, non-empty addresses. */
export function parseRecipients(raw: string | null | undefined): string[] {
  return String(raw ?? '')
    .split(SEPARATORS)
    .map(part => part.trim())
    .filter(Boolean)
}

/** Render a stored list back into the text the field displays. */
export function formatRecipients(list: readonly string[] | null | undefined): string {
  return (Array.isArray(list) ? list : []).join(', ')
}

/**
 * Re-split a stored list. Configurations saved before the field accepted commas
 * hold a single glued entry; splitting it on read repairs the list as soon as
 * the user saves again.
 */
export function normalizeRecipients(list: readonly string[] | null | undefined): string[] {
  return (Array.isArray(list) ? list : []).flatMap(entry => parseRecipients(entry))
}

/**
 * Deliberately permissive: internal setups legitimately notify `root@localhost`,
 * so only shape errors are flagged (missing or duplicated `@`, empty side,
 * embedded whitespace). Invalid entries are surfaced as a warning, never as a
 * hard block.
 */
export function isValidRecipient(value: string): boolean {
  if (!value || /\s/.test(value)) return false
  const parts = value.split('@')

  return parts.length === 2 && parts[0].length > 0 && parts[1].length > 0
}

/** The subset of a list that does not look like an address. */
export function invalidRecipients(list: readonly string[] | null | undefined): string[] {
  return (Array.isArray(list) ? list : []).filter(entry => !isValidRecipient(entry))
}
