import { haOperationWithBody } from '@/lib/orchestrator/haRoute'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const PUT = withAudit({ category: 'system', resourceType: 'sync_mode' }, haOperationWithBody('/ha/sync-mode', 'PUT'))
