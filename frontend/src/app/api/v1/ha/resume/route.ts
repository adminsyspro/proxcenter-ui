import { haOperation } from '@/lib/orchestrator/haRoute'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withAudit({ category: 'system', resourceType: 'ha', action: 'enable' }, haOperation('/ha/resume', 'POST'))
