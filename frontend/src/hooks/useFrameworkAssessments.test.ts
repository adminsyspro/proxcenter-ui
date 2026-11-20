import { beforeEach, describe, expect, it, vi } from 'vitest'

const { swrMock } = vi.hoisted(() => ({ swrMock: vi.fn() }))

vi.mock('swr', () => ({ default: (...args: unknown[]) => swrMock(...args) }))

import { useFrameworkAssessments } from './useFrameworkAssessments'

beforeEach(() => {
  swrMock.mockReset()
})

describe('useFrameworkAssessments', () => {
  it('reads the assessments of the connection, never again on focus or reconnect', () => {
    swrMock.mockReturnValue({ data: { assessments: [{ frameworkId: 'cmmc-l2' }], nodes: [{ node: 'pve1' }] }, error: undefined, isLoading: false })

    const r = useFrameworkAssessments('conn 1')

    const [key, fetcher, options] = swrMock.mock.calls[0]
    expect(key).toBe('/api/v1/compliance/frameworks?connectionId=conn%201')
    expect(typeof fetcher).toBe('function')
    expect(options).toEqual({ revalidateOnFocus: false, revalidateOnReconnect: false })
    expect(r.assessments).toEqual([{ frameworkId: 'cmmc-l2' }])
    expect(r.nodes).toEqual([{ node: 'pve1' }])
  })

  it('asks nothing without a connection and answers empty lists', () => {
    swrMock.mockReturnValue({ data: undefined, error: undefined, isLoading: false })

    const r = useFrameworkAssessments(null)

    expect(swrMock.mock.calls[0][0]).toBeNull()
    expect(r).toMatchObject({ assessments: [], nodes: [] })
  })

  it('maps the response and refuses an error status', async () => {
    swrMock.mockReturnValue({ data: undefined, error: undefined, isLoading: true })
    useFrameworkAssessments('c1')
    const fetcher = swrMock.mock.calls[0][1] as (url: string) => Promise<unknown>

    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 1 }], nodes: [] }), { status: 200 })))
    await expect(fetcher('/x')).resolves.toEqual({ assessments: [{ id: 1 }], nodes: [] })

    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })))
    await expect(fetcher('/x')).rejects.toThrow('API error: 500')
    vi.unstubAllGlobals()
  })
})
