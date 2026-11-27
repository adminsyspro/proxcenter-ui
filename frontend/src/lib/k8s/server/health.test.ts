import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CoreV1Api, VersionApi } from '@kubernetes/client-node'

const buildKubeClientMock = vi.fn()
const classifyK8sErrorMock = vi.fn()

vi.mock('./client', () => ({
  buildKubeClient: (...a: any[]) => buildKubeClientMock(...a),
  invalidateClusterClients: () => {},
}))

vi.mock('./errors', () => ({
  classifyK8sError: (...a: any[]) => classifyK8sErrorMock(...a),
}))

import { getClusterHealth } from './health'

// Real 1.x shapes: getCode() -> VersionInfo directly (no .body), listNode() -> V1NodeList directly (no .body)
function makeClient(versionOverride?: any, nodesOverride?: any) {
  const versionApi = {
    getCode: async () => versionOverride ?? { gitVersion: 'v1.30.0', major: '1', minor: '30', gitCommit: '', gitTreeState: '', buildDate: '', goVersion: '', compiler: '', platform: '' },
  }
  const coreApi = {
    listNode: async () => nodesOverride ?? {
      items: [
        { status: { conditions: [{ type: 'Ready', status: 'True' }] } },
        { status: { conditions: [{ type: 'Ready', status: 'False' }] } },
      ],
    },
  }
  return {
    ok: true,
    makeApiClient: (cls: any) => {
      if (cls === VersionApi) return versionApi
      if (cls === CoreV1Api) return coreApi
      return {}
    },
    api: coreApi,
  }
}

const twoNodes = makeClient()

const allReady = makeClient(
  { gitVersion: 'v1.29.0', major: '1', minor: '29', gitCommit: '', gitTreeState: '', buildDate: '', goVersion: '', compiler: '', platform: '' },
  {
    items: [
      { status: { conditions: [{ type: 'Ready', status: 'True' }] } },
      { status: { conditions: [{ type: 'Ready', status: 'True' }] } },
    ],
  },
)

beforeEach(() => {
  buildKubeClientMock.mockReset().mockReturnValue(twoNodes)
  classifyK8sErrorMock.mockReset().mockReturnValue('unreachable')
})

describe('getClusterHealth', () => {
  it('reports version + nodesReady/nodesTotal', async () => {
    const r = await getClusterHealth({ clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } })
    expect(r.ok).toBe(true)
    expect(r.value?.version).toBe('v1.30.0')
    expect(r.value?.nodesTotal).toBe(2)
    expect(r.value?.nodesReady).toBe(1)
  })

  it('returns state degraded when some nodes not ready', async () => {
    const r = await getClusterHealth({ clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } })
    expect(r.ok).toBe(true)
    expect(r.value?.state).toBe('degraded')
  })

  it('returns state healthy when all nodes ready', async () => {
    buildKubeClientMock.mockReturnValueOnce(allReady)
    const r = await getClusterHealth({ clusterId: 'c2', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } })
    expect(r.ok).toBe(true)
    expect(r.value?.state).toBe('healthy')
  })

  it('returns ok:false with errorCode on client build failure', async () => {
    buildKubeClientMock.mockReturnValueOnce({ ok: false, error: 'bad url' })
    const r = await getClusterHealth({ clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('unreachable')
    expect(r.value?.state).toBe('unreachable')
  })

  it('returns ok:false with auth_failed errorCode on 401', async () => {
    // ApiException 1.x: error has .code (number), not .statusCode
    const e: any = new Error('Unauthorized')
    e.code = 401
    const versionApiThatThrows = { getCode: async () => { throw e } }
    const coreApiEmpty = { listNode: async () => ({ items: [] }) }
    buildKubeClientMock.mockReturnValueOnce({
      ok: true,
      makeApiClient: (cls: any) => {
        if (cls === VersionApi) return versionApiThatThrows
        if (cls === CoreV1Api) return coreApiEmpty
        return {}
      },
      api: coreApiEmpty,
    })
    classifyK8sErrorMock.mockReturnValueOnce('auth_failed')
    const r = await getClusterHealth({ clusterId: 'c1', credentialVersion: 1, server: 'https://k:6443', cred: { type: 'token', value: 't' } })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('auth_failed')
    expect(r.value?.state).toBe('auth_failed')
  })
})
