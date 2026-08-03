'use client'

import { useEffect, useState } from 'react'

import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle,
  FormControlLabel, FormGroup, IconButton, MenuItem, Stack, TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'
import { ALL_SCOPE_IDS } from '@/lib/api-tokens/scopes'
import { copyToClipboard } from '@/lib/clipboard'
import { selectableTenants, sortTenantsProviderFirst } from '@/lib/storage/tenantFacets'

type Props = {
  open: boolean
  onClose: () => void
  onCreated: () => void
}

type TenantOption = { id: string; name: string }
type ConnectionOption = { id: string; tenantId: string; name: string }

/**
 * Fix round 3, finding 1: the tenant-change effect (below) already clears
 * `connectionIds` synchronously, so no UI sequence has ever been shown to
 * submit a stale id (React flushes the effect before the next user event
 * can fire Create). This filter is the structural backstop anyway: the
 * invariant "only ids visible for the currently selected tenant are ever
 * submitted" then holds regardless of *how* `connectionIds` state was
 * populated, rather than depending on effect timing staying correct.
 * Exported for a focused unit test (CreateTokenDialog.test.tsx).
 */
export function filterToVisibleConnectionIds(selectedIds: string[], visible: ConnectionOption[]): string[] {
  const visibleIds = new Set(visible.map(c => c.id))
  return selectedIds.filter(id => visibleIds.has(id))
}

// Reuses the app's existing icon vocabulary for each domain (the VM/node/
// storage inventory tabs, the automation + alert-thresholds settings tabs,
// the compliance pages) rather than inventing a new one. Keyed by scope id
// so a future addition to SCOPE_DEFINITIONS without a matching entry here
// still renders a row -- via DEFAULT_SCOPE_ICON -- instead of a blank one.
const SCOPE_ICONS: Record<string, string> = {
  'vms:read': 'ri-computer-line',
  'nodes:read': 'ri-server-line',
  'storage:read': 'ri-hard-drive-2-line',
  'backups:read': 'ri-save-line',
  'automation:read': 'ri-robot-line',
  'alerts:read': 'ri-alarm-warning-line',
  'reports:read': 'ri-file-list-3-line',
  'compliance:read': 'ri-shield-check-line',
}
const DEFAULT_SCOPE_ICON = 'ri-key-line'

const EXPIRATION_CHOICES = [
  { value: 'none', labelKey: 'expirationNone', days: null as number | null },
  { value: '30', labelKey: 'expiration30', days: 30 },
  { value: '90', labelKey: 'expiration90', days: 90 },
  { value: '365', labelKey: 'expiration365', days: 365 },
  { value: 'custom', labelKey: 'expirationCustom', days: null as number | null },
]

// Best-effort JSON fetch used only for the tenant/connection/vDC plumbing
// below: never throws, flat { ok, value } shape (tsconfig strict:false has
// no reliable discriminated-union narrowing).
async function fetchJsonArray(url: string): Promise<{ ok: boolean; value: any[] }> {
  try {
    const res = await fetch(url)
    if (!res.ok) return { ok: false, value: [] }
    const json = await res.json()
    return Array.isArray(json?.data) ? { ok: true, value: json.data } : { ok: false, value: [] }
  } catch {
    return { ok: false, value: [] }
  }
}

export default function CreateTokenDialog({ open, onClose, onCreated }: Props) {
  const t = useTranslations('settings.apiTokens')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expiration, setExpiration] = useState('none')
  const [customDays, setCustomDays] = useState('180')
  const [scopes, setScopes] = useState<string[]>([])
  // Fallback free-text field, used only when the tenant selector could not
  // load (degrade to the pre-fix behaviour: ambient tenant, hand-typed ids).
  const [connectionsText, setConnectionsText] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [secret, setSecret] = useState('')
  const [copied, setCopied] = useState(false)

  // Tenant + connection plumbing (fix round 1, finding 1). A missing
  // tenantId on the request defaults to the ambient tenant server-side,
  // which for a provider admin is the fleet-wide "default" tenant — the
  // dropdown makes the scope explicit and lets it be narrowed. Everything
  // here degrades independently and never blocks token creation.
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [tenantsAvailable, setTenantsAvailable] = useState(false)
  const [tenantId, setTenantId] = useState('')
  const [connectionOptions, setConnectionOptions] = useState<ConnectionOption[]>([])
  const [connectionsAvailable, setConnectionsAvailable] = useState(false)
  const [connectionIds, setConnectionIds] = useState<string[]>([])

  useEffect(() => {
    if (!open) return
    let active = true

    ;(async () => {
      const [tenantsRes, vdcsRes, connectionsRes] = await Promise.all([
        fetchJsonArray('/api/v1/tenants'),
        fetchJsonArray('/api/v1/admin/vdcs'),
        fetchJsonArray('/api/v1/admin/connections?type=pve'),
      ])
      if (!active) return

      setConnectionOptions(connectionsRes.value)
      setConnectionsAvailable(connectionsRes.ok)

      if (!tenantsRes.ok) {
        setTenants([])
        setTenantsAvailable(false)
        return
      }

      const enabled = tenantsRes.value.filter((tenant: any) => tenant?.enabled)
      // vDC-only exclusion needs to know real connection owners; without a
      // reliable connections fetch we cannot tell a legitimately-empty
      // tenant from a vDC-only one, so we skip the exclusion rather than
      // risk hiding a valid tenant (issue #609's rule, best-effort here).
      const selectable = connectionsRes.ok
        ? selectableTenants(enabled, vdcsRes.value.map((vdc: any) => vdc.tenantId), connectionsRes.value)
        : enabled
      const sorted = sortTenantsProviderFirst(selectable)

      setTenants(sorted)
      setTenantsAvailable(true)
      setTenantId(prev => (prev && sorted.some(tn => tn.id === prev) ? prev : sorted[0]?.id || ''))
    })()

    return () => {
      active = false
    }
  }, [open])

  // Changing the tenant clears the connection selection: a selection carried
  // over from another tenant would be rejected or, worse, silently scope
  // the token against the wrong tenant's connections.
  useEffect(() => {
    setConnectionIds([])
  }, [tenantId])

  function toggleScope(scope: string) {
    setScopes(prev => (prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]))
  }

  function reset() {
    setName('')
    setDescription('')
    setExpiration('none')
    setCustomDays('180')
    setScopes([])
    setConnectionsText('')
    setConnectionIds([])
    setTenantId('')
    setError('')
    setSecret('')
    setCopied(false)
  }

  function expiresInDays(): number | null {
    if (expiration === 'custom') {
      const parsed = Number(customDays)
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null
    }
    return EXPIRATION_CHOICES.find(c => c.value === expiration)?.days ?? null
  }

  // The multi-select is filtered by the selected tenant (visibleConnections
  // below), so it is only meaningful once BOTH fetches succeeded: showing it
  // with an unset tenantId (tenants unavailable) would list zero
  // connections and be as much of a dead end as the bug this fixes.
  // handleCreate must read the same boolean the render uses, or the two can
  // disagree about which value (connectionIds vs connectionsText) is live.
  const connectionSelectorAvailable = tenantsAvailable && connectionsAvailable
  const visibleConnections = connectionOptions.filter(c => c.tenantId === tenantId)

  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const fallbackConnectionIds = connectionsText
        .split(',')
        .map(c => c.trim())
        .filter(Boolean)
      const resolvedConnectionIds = connectionSelectorAvailable
        ? filterToVisibleConnectionIds(connectionIds, visibleConnections)
        : fallbackConnectionIds

      const res = await fetch('/api/v1/settings/api-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          scopes,
          connectionIds: resolvedConnectionIds.length ? resolvedConnectionIds : null,
          expiresInDays: expiresInDays(),
          ...(tenantsAvailable && tenantId ? { tenantId } : {}),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || t('createError'))
      // ONE-TIME reveal: keep it in local state only, never re-fetchable.
      setSecret(json.data.secret)
      onCreated()
    } catch (e: any) {
      setError(e?.message || t('createError'))
    } finally {
      setSaving(false)
    }
  }

  function handleClose() {
    reset()
    onClose()
  }

  return (
    <Dialog open={open} onClose={secret ? undefined : handleClose} fullWidth maxWidth='sm'>
      <DialogTitle>{secret ? t('reveal.title') : t('dialog.title')}</DialogTitle>
      <DialogContent>
        {secret ? (
          <Stack spacing={2}>
            <Alert severity='warning'>{t('reveal.warning')}</Alert>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, bgcolor: 'action.hover', borderRadius: 1, p: 1.5 }}>
              <Typography sx={{ fontFamily: 'monospace', wordBreak: 'break-all', flex: 1 }}>{secret}</Typography>
              <Tooltip title={copied ? t('reveal.copied') : t('reveal.copy')} slotProps={tooltipSlotProps}>
                <IconButton
                  aria-label={t('reveal.copy')}
                  onClick={async () => setCopied(await copyToClipboard(secret))}
                >
                  <i className='ri-file-copy-line' />
                </IconButton>
              </Tooltip>
            </Box>
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error && <Alert severity='error'>{error}</Alert>}
            <TextField label={t('dialog.name')} value={name} onChange={e => setName(e.target.value)} fullWidth required />
            <TextField label={t('dialog.description')} value={description} onChange={e => setDescription(e.target.value)} fullWidth />
            <TextField select label={t('dialog.expiration')} value={expiration} onChange={e => setExpiration(e.target.value)} fullWidth>
              {EXPIRATION_CHOICES.map(choice => (
                <MenuItem key={choice.value} value={choice.value}>{t(`dialog.${choice.labelKey}`)}</MenuItem>
              ))}
            </TextField>
            {expiration === 'custom' && (
              <TextField label={t('dialog.customDays')} type='number' value={customDays} onChange={e => setCustomDays(e.target.value)} fullWidth />
            )}
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('dialog.scopes')}</Typography>
              {/* FormGroup (block-level) rather than the FormControlLabels'
                  own inline-flex flow, one scope per row: rendered bare, the
                  eight labels ran together on a single line with no
                  separation between them. */}
              <FormGroup>
                {ALL_SCOPE_IDS.map(scope => (
                  <FormControlLabel
                    key={scope}
                    sx={{ width: '100%', mr: 0 }}
                    control={<Checkbox checked={scopes.includes(scope)} onChange={() => toggleScope(scope)} />}
                    label={
                      <Stack direction='row' alignItems='center' spacing={1}>
                        <i className={SCOPE_ICONS[scope] || DEFAULT_SCOPE_ICON} />
                        <Typography variant='body2'>{scope}</Typography>
                      </Stack>
                    }
                  />
                ))}
              </FormGroup>
            </Box>
            {tenantsAvailable && (
              <TextField select label={t('dialog.tenant')} value={tenantId} onChange={e => setTenantId(e.target.value)} fullWidth>
                {tenants.map(tenant => (
                  <MenuItem key={tenant.id} value={tenant.id}>
                    <Stack direction='row' alignItems='center' spacing={1}>
                      <i className='ri-building-line' />
                      <Typography variant='body2'>{tenant.name}</Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
            )}
            {connectionSelectorAvailable ? (
              <TextField
                select
                label={t('dialog.connections')}
                helperText={t('dialog.connectionsAll')}
                value={connectionIds}
                onChange={e => {
                  const raw = e.target.value
                  setConnectionIds(typeof raw === 'string' ? raw.split(',').filter(Boolean) : raw)
                }}
                fullWidth
                slotProps={{
                  select: {
                    multiple: true,
                    renderValue: (selected: unknown) =>
                      (selected as string[])
                        .map(id => visibleConnections.find(c => c.id === id)?.name || id)
                        .join(', '),
                  },
                }}
              >
                {visibleConnections.map(conn => (
                  <MenuItem key={conn.id} value={conn.id}>
                    <Checkbox checked={connectionIds.includes(conn.id)} size='small' />
                    <Stack direction='row' alignItems='center' spacing={1}>
                      <i className='ri-link' />
                      <Typography variant='body2'>{conn.name}</Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              // Fix round 2, finding 1: this must render whenever the
              // connections fetch itself failed, even if tenants loaded
              // fine (handleCreate reads connectionSelectorAvailable, the
              // same boolean, to decide which value to send). It also
              // covers the mirror case -- tenants unavailable but
              // connections available -- where the multi-select would
              // otherwise show zero options because no tenant is selected.
              <TextField
                label={t('dialog.connections')}
                helperText={t('dialog.connectionsAll')}
                value={connectionsText}
                onChange={e => setConnectionsText(e.target.value)}
                fullWidth
              />
            )}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {secret ? (
          <Button variant='contained' onClick={handleClose}>{t('reveal.done')}</Button>
        ) : (
          <>
            <Button onClick={handleClose}>{t('dialog.cancel')}</Button>
            <Button
              variant='contained'
              disabled={saving || !name.trim() || scopes.length === 0}
              onClick={handleCreate}
            >
              {t('dialog.create')}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  )
}
