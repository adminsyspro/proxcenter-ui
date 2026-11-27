/**
 * `consent-text` of datacenter.cfg is base64-encoded UTF-8: the Proxmox VE
 * GUI always wrote it that way, and Proxmox VE 9.3 refuses anything else.
 * These helpers keep the field readable in ProxCenter.
 */

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/

/**
 * The text to show for a stored value. A value that is not base64 of valid
 * UTF-8 (written in clear by an older ProxCenter) is shown as it is, and
 * saved encoded the next time.
 */
export function decodeConsentText(stored: unknown): string {
  if (typeof stored !== 'string' || stored === '') return ''
  const compact = stored.trim()
  if (compact.length % 4 !== 0 || !BASE64.test(compact)) return stored
  try {
    const bytes = Uint8Array.from(atob(compact), c => c.charCodeAt(0))

    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return stored
  }
}

/** The value to store for a text typed in ProxCenter. */
export function encodeConsentText(text: string): string {
  if (!text) return ''
  let binary = ''
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte)

  return btoa(binary)
}
