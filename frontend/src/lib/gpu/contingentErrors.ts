// The vDC GPU contingent codes the generic guest routes answer a tenant with
// (#672): the hardware, clone and restore dialogs show a sentence for them,
// never the code. Client-safe.

type Translate = (key: string, values?: Record<string, string | number>) => string

const CODES = new Set(['gpu_via_my_vdc', 'quota_exhausted', 'gpu_check_unavailable'])

/**
 * The sentence for a contingent refusal, from a route's JSON body (or an
 * Error whose message is the code); null for any other error, which the
 * caller shows as it already does.
 */
export function gpuContingentMessage(t: Translate, body: unknown): string | null {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : null
  const code = b ? (body instanceof Error ? b.message : b.error) : null
  if (typeof code !== 'string' || !CODES.has(code)) return null
  return t(`hardware.gpuContingent.${code}`, { used: Number(b?.used ?? 0), count: Number(b?.count ?? 0) })
}
