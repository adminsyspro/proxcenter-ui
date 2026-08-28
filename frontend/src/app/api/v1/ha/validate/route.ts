import { haOperationWithBody } from '@/lib/orchestrator/haRoute'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The preflight budgets 150s (45s per node) and legitimately runs far longer
// than a normal API call: it opens an SSH session per node and probes the TCP
// matrix between all three. It must never be reported as an unreachable
// orchestrator just because it took its time (#803).
export const POST = haOperationWithBody('/ha/validate', 'POST')
