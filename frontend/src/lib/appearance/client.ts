// src/lib/appearance/client.ts
//
// Browser-side write of the appearance settings (issue #696). The cookie stays
// the local cache that makes the next render instant; this call is what makes
// the choice outlive the cookie.

export const APPEARANCE_ENDPOINT = '/api/v1/settings/appearance'

type SaveOptions = {
  /**
   * Let the request outlive the page. Used when flushing a pending save as the
   * tab is being hidden or closed, where a normal fetch would be cancelled and
   * the user's last change would be lost.
   */
  keepalive?: boolean
}

/**
 * Persist the given appearance keys for the signed-in user. Never rejects:
 * appearance is cosmetic, the value is already applied locally and kept in the
 * cookie, so a failed save is not worth interrupting anyone over.
 */
export async function saveAppearance(appearance: Record<string, unknown>, options: SaveOptions = {}): Promise<boolean> {
  try {
    const response = await fetch(APPEARANCE_ENDPOINT, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(appearance),
      keepalive: options.keepalive === true,
    })

    return response.ok
  } catch {
    return false
  }
}
