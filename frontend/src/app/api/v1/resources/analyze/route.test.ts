import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

// The route derives the analysis language from the NEXT_LOCALE cookie:
// useResourceData.runAiAnalysis posts no locale in the body.
let cookieLocale: string | undefined

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === 'NEXT_LOCALE' && cookieLocale !== undefined ? { value: cookieLocale } : undefined,
  }),
}))

let fetchMock: ReturnType<typeof vi.fn>

const kpis = {
  cpu: { used: 42.5, allocated: 64, total: 128, trend: 3 },
  ram: { used: 71.25, allocated: 137438953472, total: 274877906944, trend: -2 },
  storage: { used: 5497558138880, total: 10995116277760, trend: 1 },
  vms: { total: 30, running: 24, stopped: 6 },
  efficiency: 62,
}

const topCpuVms = [
  { id: '1', name: 'web-01', node: 'pve1', cpu: 88, ram: 40, cpuAllocated: 8, ramAllocated: 8589934592 },
]

const topRamVms = [
  { id: '2', name: 'db-01', node: 'pve2', cpu: 30, ram: 91, cpuAllocated: 4, ramAllocated: 34359738368 },
]

const modelReply = JSON.stringify({
  summary: 'Alles in Ordnung.',
  recommendations: [{ id: 'rec_1', type: 'overprovisioned', severity: 'medium', title: 'Zu viele vCPUs', description: '...' }],
})

/** Ollama reachable (/api/tags) + a JSON answer on /api/chat. */
function stubOllama(reply = modelReply) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).endsWith('/api/tags')) return new Response('{}', { status: 200 })

    return new Response(JSON.stringify({ message: { content: reply } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  })
}

/** Prompt sent to Ollama's /api/chat. */
function sentPrompt(): string {
  const chatCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/api/chat'))

  return JSON.parse(chatCall![1].body as string).messages[0].content
}

async function importHandler() {
  const mod = await import('./route')

  return mod.POST
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  cookieLocale = 'en'
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

describe('POST /api/v1/resources/analyze', () => {
  it('honours an RBAC denial from checkPermission', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })

    checkPermissionMock.mockResolvedValueOnce(denied as any)

    const handler = await importHandler()
    const res = await callRoute(handler, { body: { kpis } })

    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a body without KPIs', async () => {
    const handler = await importHandler()
    const res = await callRoute(handler, { body: {} })

    expect(res.status).toBe(400)
  })

  // #686: the whole prompt was written in French, so the summary and the
  // recommendations rendered by AiInsightsCard came back in French for every
  // user. The reply is JSON-parsed, hence the two constraints asserted here:
  // the "JSON only" instruction survives and the keys stay in English.
  describe('prompt language (#686)', () => {
    it('keeps the JSON-only contract while asking for values in the UI language', async () => {
      cookieLocale = 'de'
      stubOllama()

      const handler = await importHandler()
      const res = await callRoute(handler, { body: { kpis, topCpuVms, topRamVms } })

      expect(res.status).toBe(200)

      const prompt = sentPrompt()

      // JSON contract intact
      expect(prompt).toContain('Reply ONLY with valid JSON')
      expect(prompt).toContain('"summary"')
      expect(prompt).toContain('"recommendations"')

      // Language instruction present, values only
      expect(prompt).toMatch(/keep every JSON key/i)
      expect(prompt).toMatch(/value in German/)

      // No French left in the prompt body
      expect(prompt).not.toMatch(/Réponds UNIQUEMENT|Tu es un expert|Données de l'infrastructure/)
    })

    it('falls back to English when the cookie is absent or unsupported', async () => {
      cookieLocale = 'it'
      stubOllama()

      const handler = await importHandler()

      await callRoute(handler, { body: { kpis, topCpuVms, topRamVms } })

      expect(sentPrompt()).toMatch(/value in English/)
    })

    it('still carries the infrastructure data alongside the instruction', async () => {
      stubOllama()

      const handler = await importHandler()

      await callRoute(handler, { body: { kpis, topCpuVms, topRamVms } })

      const prompt = sentPrompt()

      expect(prompt).toContain('web-01')
      expect(prompt).toContain('db-01')
      expect(prompt).toContain('42.5% used')
    })
  })

  it('returns the model summary and recommendations when Ollama answers', async () => {
    cookieLocale = 'de'
    stubOllama()

    const handler = await importHandler()
    const res = await callRoute(handler, { body: { kpis, topCpuVms, topRamVms } })

    expect(await readJson<any>(res)).toMatchObject({
      data: {
        summary: 'Alles in Ordnung.',
        provider: 'ollama',
        recommendations: [{ id: 'rec_1', severity: 'medium' }],
      },
    })
  })

  it('falls back to the i18n-keyed basic recommendations when Ollama is unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const handler = await importHandler()
    const res = await callRoute(handler, { body: { kpis, topCpuVms, topRamVms } })

    const json = await readJson<any>(res)

    expect(json.data.provider).toBe('basic')

    // The fallback path returns keys, not prose: nothing to translate.
    expect(json.data.summaryKey).toMatch(/^resources\.rec\./)
  })
})
