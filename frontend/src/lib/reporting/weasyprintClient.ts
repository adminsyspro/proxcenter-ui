// weasyprintClient.ts
export async function renderPdf(html: string): Promise<{ ok: boolean; pdf?: Buffer; error?: string }> {
  const base = process.env.PROXCENTER_REPORTING_URL
  if (!base) return { ok: false, error: 'PDF renderer not configured (PROXCENTER_REPORTING_URL unset)' }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30_000)
  try {
    const res = await fetch(`${base}/render`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/html' },
      body: html,
      signal: controller.signal,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      return { ok: false, error: `renderer returned ${res.status}: ${body.slice(0, 200)}` }
    }
    return { ok: true, pdf: Buffer.from(await res.arrayBuffer()) }
  } catch (e: any) {
    return { ok: false, error: e?.name === 'AbortError' ? 'renderer timed out' : (e?.message || String(e)) }
  } finally {
    clearTimeout(timer)
  }
}
