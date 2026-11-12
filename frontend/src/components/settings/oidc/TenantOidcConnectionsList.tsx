'use client'

import { useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Card,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Pagination,
  Typography,
} from '@mui/material'

const PAGE_SIZE = 10

/** One line of GET /api/v1/auth/oidc/connections. */
export type TenantConnectionRow = {
  tenant_id: string
  name: string
  tenant_enabled: boolean
  configured: boolean
  enabled: boolean
  self_service: boolean
  provider_name?: string | null
  issuer_url?: string | null
}

type StatusKey = 'statusNotConfigured' | 'statusActive' | 'statusDisabled'

// Status dot of a tenant's own IdP: live, saved but off, or nothing yet.
function statusOf(row: TenantConnectionRow): { key: StatusKey; color: string } {
  if (!row.configured) return { key: 'statusNotConfigured', color: 'text.disabled' }
  if (row.enabled && row.tenant_enabled) return { key: 'statusActive', color: 'success.main' }
  return { key: 'statusDisabled', color: 'warning.main' }
}

/**
 * Customer tenants and the state of their own OIDC connection (issue #1289),
 * one line each, the connection form behind the chevron.
 */
export default function TenantOidcConnectionsList({ onOpen }: { onOpen: (row: TenantConnectionRow) => void }) {
  const t = useTranslations()
  const [rows, setRows] = useState<TenantConnectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/oidc/connections')
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data.error || t('oidc.tenantConnections.loadError'))
        return
      }
      setRows(data.data || [])
    } catch {
      setError(t('oidc.tenantConnections.loadError'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const visible = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <Typography variant='body2' sx={{ opacity: 0.7 }}>
        {t('oidc.tenantConnections.listDescription')}
      </Typography>

      {error && <Alert severity='error' onClose={() => setError('')}>{error}</Alert>}

      {!error && rows.length === 0 && <Alert severity='info'>{t('oidc.tenantConnections.empty')}</Alert>}

      {rows.length > 0 && (
        <Card variant='outlined'>
          <List disablePadding>
            {visible.map((row, index) => {
              const status = statusOf(row)
              return (
                <ListItemButton key={row.tenant_id} divider={index < visible.length - 1} onClick={() => onOpen(row)}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <i className='ri-building-line' style={{ fontSize: 20 }} />
                  </ListItemIcon>
                  <Box
                    component='span'
                    title={t(`oidc.tenantConnections.${status.key}`)}
                    sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: status.color, mr: 1.5, flexShrink: 0 }}
                  />
                  <ListItemText
                    primary={row.name}
                    secondary={row.configured ? row.provider_name || row.issuer_url : null}
                    slotProps={{
                      primary: { noWrap: true, sx: { fontWeight: 600 } },
                      secondary: { noWrap: true },
                    }}
                    sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, my: 0, minWidth: 0 }}
                  />
                  {row.self_service && (
                    <Typography variant='caption' sx={{ opacity: 0.7, ml: 2, whiteSpace: 'nowrap' }}>
                      {t('oidc.tenantConnections.selfServiceShort')}
                    </Typography>
                  )}
                  <Typography variant='caption' sx={{ opacity: 0.7, mx: 2, whiteSpace: 'nowrap' }}>
                    {t(`oidc.tenantConnections.${status.key}`)}
                  </Typography>
                  <i className='ri-arrow-right-s-line' style={{ fontSize: 20, opacity: 0.6 }} />
                </ListItemButton>
              )
            })}
          </List>
        </Card>
      )}

      {pages > 1 && (
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <Pagination count={pages} page={page} onChange={(_e, value: number) => setPage(value)} size='small' />
        </Box>
      )}
    </Box>
  )
}
