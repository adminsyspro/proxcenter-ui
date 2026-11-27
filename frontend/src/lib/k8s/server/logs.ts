import { CoreV1Api } from '@kubernetes/client-node'
import type { K8sErrorCode } from '../types'
import { classifyK8sError } from './errors'
import { buildKubeClient, type BuildKubeClientInput } from './client'

export const DEFAULT_TAIL = 200
export const MAX_TAIL_LINES = 5000
export const LOG_BYTE_CAP = 1 << 20 // 1 MiB

export interface LogParams {
  container: string
  tailLines: number
  limitBytes: number
  previous: boolean
}

export function buildLogParams(
  container: string,
  opts: { tailLines?: number; previous?: boolean },
): LogParams {
  let tail = opts.tailLines ?? 0
  if (tail <= 0) tail = DEFAULT_TAIL
  if (tail > MAX_TAIL_LINES) tail = MAX_TAIL_LINES
  return {
    container,
    tailLines: tail,
    limitBytes: LOG_BYTE_CAP,
    previous: opts.previous ?? false,
  }
}

// LogFetcher is the testable seam (mirrors logs.go logStreamer interface).
// Production: delegates to CoreV1Api; tests: injects controlled responses.
export interface LogFetcher {
  getFirstContainerName(namespace: string, pod: string): Promise<string>
  fetchLogs(namespace: string, pod: string, params: LogParams): Promise<string>
}

// CoreV1LogFetcher is the production implementation.
class CoreV1LogFetcher implements LogFetcher {
  constructor(private api: CoreV1Api) {}

  async getFirstContainerName(namespace: string, pod: string): Promise<string> {
    const p = await this.api.readNamespacedPod({ name: pod, namespace })
    const containers = (p as any).spec?.containers ?? []
    return containers[0]?.name ?? ''
  }

  async fetchLogs(namespace: string, pod: string, params: LogParams): Promise<string> {
    return this.api.readNamespacedPodLog({
      name: pod,
      namespace,
      container: params.container || undefined,
      tailLines: params.tailLines,
      limitBytes: params.limitBytes,
      previous: params.previous,
    })
  }
}

function capLog(raw: string): string {
  if (raw.length <= LOG_BYTE_CAP) return raw
  return raw.slice(0, LOG_BYTE_CAP)
}

export async function getPodLogs(
  input: BuildKubeClientInput,
  namespace: string,
  pod: string,
  opts: { container?: string; tailLines?: number; previous?: boolean },
  _fetcher?: LogFetcher,
): Promise<{ ok: boolean; errorCode?: K8sErrorCode; value?: { logs: string; truncated: boolean; container: string } }> {
  let fetcher: LogFetcher

  if (_fetcher) {
    fetcher = _fetcher
  } else {
    const built = buildKubeClient(input)
    if (!built.ok || !built.makeApiClient) return { ok: false, errorCode: 'config' }
    fetcher = new CoreV1LogFetcher(built.makeApiClient(CoreV1Api))
  }

  let container = opts.container ?? ''
  if (!container) {
    try {
      container = await fetcher.getFirstContainerName(namespace, pod)
    } catch (err) {
      return { ok: false, errorCode: classifyK8sError(err) }
    }
  }

  const params = buildLogParams(container, opts)

  let raw: string
  try {
    raw = await fetcher.fetchLogs(namespace, pod, params)
  } catch (err) {
    return { ok: false, errorCode: classifyK8sError(err) }
  }

  const truncated = raw.length > LOG_BYTE_CAP
  return { ok: true, value: { logs: capLog(raw), truncated, container } }
}
