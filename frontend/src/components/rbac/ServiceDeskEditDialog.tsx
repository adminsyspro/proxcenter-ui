'use client'

// Change the tenants a service-desk assignment reaches (ui#1336).

import { useEffect, useState } from 'react'

import Alert from '@mui/material/Alert'
import Box from '@mui/material/Box'
import Button from '@mui/material/Button'
import Dialog from '@mui/material/Dialog'
import DialogActions from '@mui/material/DialogActions'
import DialogContent from '@mui/material/DialogContent'
import DialogTitle from '@mui/material/DialogTitle'
import Typography from '@mui/material/Typography'

import type { TenantOption } from './catalogueClient'
import ServiceDeskTargetEditor from './ServiceDeskTargetEditor'

export type ServiceDeskAssignmentWire = {
  id: string
  user: { id: string; email: string; name: string | null }
  role: { id: string; name: string; color: string | null }
  all_tenants: boolean
  tenant_ids: string[]
  tenants: TenantOption[]
  granted_at: string
  granted_by_email: string | null
  expires_at: string | null
}

type Props = {
  open: boolean
  assignment: ServiceDeskAssignmentWire | null
  publishedTenants: TenantOption[]
  onClose: () => void
  onSaved: () => void
  t: (key: string, values?: Record<string, unknown>) => string
}

export default function ServiceDeskEditDialog({ open, assignment, publishedTenants, onClose, onSaved, t }: Readonly<Props>) {
  const [allTenants, setAllTenants] = useState(true)
  const [tenantIds, setTenantIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!open || !assignment) return
    setAllTenants(assignment.all_tenants)
    setTenantIds(assignment.tenant_ids)
    setError('')
  }, [open, assignment])

  const save = async () => {
    if (!assignment) return
    if (!allTenants && tenantIds.length === 0) {
      setError(t('rbacPage.catalogue.noTenantSelected'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/rbac/service-desk-assignments/${assignment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all_tenants: allTenants, tenant_ids: allTenants ? [] : tenantIds }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t('common.error'))
        return
      }
      onSaved()
      onClose()
    } catch {
      setError(t('errors.connectionError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'baseline', gap: 1, minWidth: 0 }}>
        <i className='ri-customer-service-2-line' style={{ alignSelf: 'center' }} />
        <span>{t('rbacPage.catalogue.serviceDeskEditTitle')}</span>
        {assignment && (
          <Typography component='span' variant='body2' noWrap title={`${assignment.user.email} · ${assignment.role.name}`} sx={{ opacity: 0.6, minWidth: 0 }}>
            · {assignment.user.email} · {assignment.role.name}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Box>
          <ServiceDeskTargetEditor
            allTenants={allTenants}
            onAllTenantsChange={setAllTenants}
            tenantIds={tenantIds}
            onTenantIdsChange={setTenantIds}
            publishedTenants={publishedTenants}
            disabled={saving}
            t={t}
          />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={() => void save()} disabled={saving}>
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
