import { CoreV1Api, VersionApi } from '@kubernetes/client-node'
import type { ClusterHealth } from '../types'
import type { K8sErrorCode } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'
import { classifyK8sError } from './errors'

export type { K8sErrorCode }

export interface GetClusterHealthInput {
  clusterId: string
  credentialVersion: number
  server: string
  cred: { type: 'client_cert' | 'token'; value: string }
  caData?: string
  serverName?: string
  insecure?: boolean
  skipCache?: boolean
}

function healthStateFor(nodesReady: number, nodesTotal: number): ClusterHealth['state'] {
  if (nodesTotal === 0) return 'unknown'
  if (nodesReady === nodesTotal) return 'healthy'
  if (nodesReady === 0) return 'unreachable'

  return 'degraded'
}

export async function getClusterHealth(
  input: GetClusterHealthInput,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: ClusterHealth }> {
  const clientInput: BuildKubeClientInput = {
    ...(input as any),
    clusterId: input.clusterId,
    credentialVersion: input.credentialVersion,
    server: input.server,
    cred: input.cred,
    caData: input.caData,
    serverName: input.serverName,
    insecure: input.insecure,
    skipCache: input.skipCache,
  }

  const built = buildKubeClient(clientInput)
  if (!built.ok || !built.makeApiClient) {
    return { ok: false, errorCode: 'unreachable', value: { state: 'unreachable' } }
  }

  const versionApi = built.makeApiClient(VersionApi)
  const coreApi = built.makeApiClient(CoreV1Api)

  const [codeResult, nodeResult] = await Promise.allSettled([
    versionApi.getCode(),
    coreApi.listNode(),
  ])

  if (codeResult.status === 'rejected') {
    const errorCode = classifyK8sError(codeResult.reason)
    const state: ClusterHealth['state'] =
      errorCode === 'auth_failed' ? 'auth_failed' : 'unreachable'
    return { ok: false, errorCode, value: { state } }
  }

  // 1.x: getCode() resolves to VersionInfo directly (no .body wrapper)
  const version: string | undefined = codeResult.value?.gitVersion ?? undefined

  // 1.x: listNode() resolves to V1NodeList directly (no .body wrapper)
  const items: any[] = nodeResult.status === 'fulfilled'
    ? (nodeResult.value?.items ?? [])
    : []
  const nodesTotal = items.length
  const nodesReady = items.filter((n: any) => {
    const conds: any[] = n?.status?.conditions ?? []
    return conds.some((c: any) => c.type === 'Ready' && c.status === 'True')
  }).length

  const state = healthStateFor(nodesReady, nodesTotal)

  return {
    ok: true,
    value: { state, version, nodesReady, nodesTotal },
  }
}
