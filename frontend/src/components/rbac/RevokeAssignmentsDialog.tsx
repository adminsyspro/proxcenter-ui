'use client'

// Confirmation before a publication change revokes assignments (ui#1336):
// one line per tenant leaving the publication, with the assignments lost there.

import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Chip from '@mui/material/Chip'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'

export type RevokedTenant = { tenant_id: string; tenant_name: string; count: number }

type Props = {
  open: boolean
  roleName: string
  revoked: RevokedTenant[]
  loading?: boolean
  onCancel: () => void
  onConfirm: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}

export default function RevokeAssignmentsDialog({ open, roleName, revoked, loading = false, onCancel, onConfirm, t }: Readonly<Props>) {
  return (
    <Dialog open={open} onClose={onCancel} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
        <i className='ri-error-warning-line' style={{ color: '#f59e0b', alignSelf: 'center' }} />
        <span>{t('rbacPage.catalogue.revokeTitle')}</span>
        <Typography component='span' variant='body2' noWrap title={roleName} sx={{ opacity: 0.6, minWidth: 0 }}>
          · {roleName}
        </Typography>
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        <Typography variant='body2' sx={{ mb: 1.5 }}>{t('rbacPage.catalogue.revokeIntro')}</Typography>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {revoked.map(r => (
            <Box key={r.tenant_id} sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
              <i className='ri-building-line' style={{ fontSize: 16, opacity: 0.7, flexShrink: 0 }} />
              <Typography variant='body2' noWrap title={r.tenant_name} sx={{ flex: 1, minWidth: 0 }}>{r.tenant_name}</Typography>
              <Chip size='small' color='warning' variant='outlined' label={t('rbacPage.catalogue.revokeCount', { count: r.count })} />
            </Box>
          ))}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>{t('common.cancel')}</Button>
        <Button variant='contained' color='warning' onClick={onConfirm} disabled={loading}>
          {t('rbacPage.catalogue.revokeConfirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
