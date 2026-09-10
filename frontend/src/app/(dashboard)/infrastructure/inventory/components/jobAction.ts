/**
 * POST an operator decision to a running migration and turn a rejection into a
 * thrown Error carrying the route's own reason.
 *
 * The buttons that drive a running migration used to fire and forget, so a
 * 400, a 404 or a 500 looked exactly like success: the dialog closed and
 * nothing else happened. Everything a route can answer has a reason attached,
 * and this is what puts that reason in front of the operator.
 */
export async function postJobAction(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method: 'POST',
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  })
  // Every route in this family answers JSON, both on success ({ data }) and on
  // failure ({ error }). A body that is not JSON at all (a proxy error page,
  // say) still has to surface as the status code rather than as a parse crash.
  const payload = await res.json().catch(() => null)
  if (!res.ok) throw new Error(payload?.error || `HTTP ${res.status}`)

  return payload?.data
}
