'use client'

import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import { Alert, Box, Button, Chip, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material'

import { BLOCKING_KINDS, type ConnectionUsage, type UsageKind } from '@/lib/connections/connectionUsageKinds'

/** The links named by a 409 from DELETE /api/v1/connections/[id] (ui#1394), or null for another error. */
export function usageConflictOf(body: unknown): ConnectionUsage | null {
  const b = body as { code?: string; usage?: ConnectionUsage } | null

  return b?.code === 'CONNECTION_IN_USE' && b.usage ? b.usage : null
}

/** Each kind wears the icon of the page where the operator removes it. */
const KIND_ICONS: Record<UsageKind, string> = {
  tenantOwner: 'ri-building-line',
  vdcs: 'ri-cloud-line',
  pbsVdcs: 'ri-file-copy-line',
  replicationJobs: 'ri-refresh-line',
  recoveryPlans: 'ri-file-shield-2-line',
  microseg: 'ri-shield-flash-line',
  drsRules: 'ri-loop-left-line',
  migrations: 'ri-swap-box-line',
  vdcMoves: 'ri-arrow-left-right-line',
  complianceProfiles: 'ri-shield-check-line',
  slaWindows: 'ri-heart-pulse-line',
  restoreDrillSchedules: 'ri-calendar-schedule-line',
}

const fetchUsage = async (url: string): Promise<ConnectionUsage> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)

  return res.json()
}

/** One kind of link: icon, title and count on one line, its items below. */
function UsageSection({ icon, title, items, color }: { icon: string; title: string; items: string[]; color: 'error' | 'warning' }) {
  return (
    <Box role='group' aria-label={title}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box component='i' className={icon} aria-hidden sx={{ fontSize: 18, color: `${color}.main` }} />
        <Typography variant='body2' sx={{ fontWeight: 600 }}>{title}</Typography>
        <Chip size='small' label={items.length} sx={{ height: 18, fontSize: '0.65rem' }} />
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75, pl: 3.25 }}>
        {items.map(item => (
          <Chip key={item} size='small' variant='outlined' label={item} sx={{ height: 22, fontSize: '0.75rem' }} />
        ))}
      </Box>
    </Box>
  )
}

interface Props {
  open: boolean
  connectionId: string | null
  typeName: string
  deleting: boolean
  /** Links returned by a refused deletion: they may have appeared since the dialog opened. */
  conflict: ConnectionUsage | null
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

export default function DeleteConnectionDialog({ open, connectionId, typeName, deleting, conflict, error, onCancel, onConfirm }: Props) {
  const t = useTranslations()
  // Read when the dialog opens, so every link shows before Delete is clicked.
  // A read that fails leaves the decision to the server, which checks again.
  const { data, isLoading } = useSWR(open && connectionId ? `/api/v1/connections/${encodeURIComponent(connectionId)}/usage` : null, fetchUsage, {
    revalidateOnMount: true,
    revalidateOnFocus: false,
  })
  const usage = conflict || data || null
  const kinds = BLOCKING_KINDS.filter(kind => (usage?.blocking[kind]?.length || 0) > 0)
  const blocked = kinds.length > 0
  const checking = isLoading && !conflict
  const tokens = checking ? [] : usage?.apiTokens || []

  return (
    <Dialog open={open} onClose={() => !deleting && onCancel()} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, color: 'error.main' }}>
        <i className='ri-delete-bin-line' style={{ fontSize: 20 }} />
        {t('settings.deleteConnectionConfirm', { type: typeName })}
      </DialogTitle>
      <DialogContent>
        {checking ? (
          <Alert severity='info' sx={{ mt: 1 }}>{t('settings.connectionUsage.checking')}</Alert>
        ) : blocked ? (
          <>
            <Alert severity='error' sx={{ mt: 1 }}>{t('settings.connectionUsage.intro')}</Alert>
            <Stack spacing={1.75} sx={{ mt: 2 }}>
              {kinds.map(kind => (
                <UsageSection
                  key={kind}
                  icon={KIND_ICONS[kind]}
                  title={t(`settings.connectionUsage.titles.${kind}`)}
                  items={usage?.blocking[kind] || []}
                  color='error'
                />
              ))}
            </Stack>
          </>
        ) : (
          <Alert severity='warning' sx={{ mt: 1 }}>{t('common.deleteConfirmation')}</Alert>
        )}
        {tokens.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <UsageSection icon='ri-code-box-line' title={t('settings.connectionUsage.apiTokensTitle')} items={tokens} color='warning' />
            <Typography variant='caption' sx={{ display: 'block', color: 'text.secondary', mt: 0.5, pl: 3.25 }}>
              {t('settings.connectionUsage.apiTokensHint')}
            </Typography>
          </Box>
        )}
        {error && <Alert severity='error' sx={{ mt: 2 }}>{error}</Alert>}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={deleting}>
          {t('common.cancel')}
        </Button>
        <Button variant='contained' color='error' onClick={onConfirm} disabled={deleting || checking || blocked}>
          {deleting ? t('common.loading') : t('common.delete')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
