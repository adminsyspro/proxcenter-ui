// src/lib/microseg/useLastRevision.ts

import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from './api'
import type { MicrosegRevision } from './types'

/**
 * The newest revision WITH its snapshot (GET /policy returns it without).
 * Idle (no request) while `revisionId` is empty. The key carries the revision
 * id: a revision never changes, so one read serves until a new one is applied.
 * The answer only counts when it is the revision the draft was compared with.
 */
export function useLastRevisionSnapshot(connId: string | null | undefined, revisionId: string | null | undefined) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId && revisionId ? `${microsegBaseUrl(connId)}/revisions?limit=1#${revisionId}` : null
  const { data, error } = useSWR<MicrosegRevision | null, MicrosegApiError>(
    key,
    async () => {
      const [head] = await api!.listRevisions(1)
      return head && head.id === revisionId && head.snapshot ? head : null
    },
    { revalidateOnFocus: false, shouldRetryOnError: false },
  )
  // True while the asked revision is still being read (false when nothing is asked, once read, or on an error).
  const loading = !!key && data === undefined && !error
  return { revision: data ?? null, error, loading }
}
