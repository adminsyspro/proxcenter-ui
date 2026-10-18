'use client'

import { useEffect, useState } from 'react'

import {
  Alert, Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, MenuItem,
  Stack, TextField, ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material'
import { useTheme } from '@mui/material/styles'
import { useTranslations } from 'next-intl'

import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'
import NumericTextField from '@/components/ui/NumericTextField'
import { ALL_SCOPE_IDS, DESTRUCTIVE_SCOPE_IDS, isWriteScope } from '@/lib/api-tokens/scopes'
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

// The scope picker groups the scopes of scopes.ts by domain: one read scope
// each, and the write scopes that act on the same objects. A row is set to
// None, Read or Write; Write always carries the domain's read scope too (a
// write API is unusable without listing what it acts on). The icons reuse
// the app's vocabulary for each domain (inventory tabs, automation and
// alert settings, compliance pages). SCOPE_DOMAINS.test pins that every
// scope id of scopes.ts sits in exactly one domain.
type ScopeDomain = { id: string; icon: string; read: string; write: readonly string[] }

export const SCOPE_DOMAINS: readonly ScopeDomain[] = [
  {
    id: 'vms',
    icon: 'ri-computer-line',
    read: 'vms:read',
    write: ['vms:power', 'vms:write', 'vms:snapshot', 'vms:migrate', 'vms:delete'],
  },
  { id: 'backups', icon: 'ri-save-line', read: 'backups:read', write: ['backups:write', 'backups:restore', 'backups:delete'] },
  { id: 'storage', icon: 'ri-hard-drive-2-line', read: 'storage:read', write: ['storage:write'] },
  {
    id: 'nodes',
    icon: 'ri-server-line',
    read: 'nodes:read',
    write: ['ha:write', 'pools:write', 'network:write', 'firewall:write'],
  },
  { id: 'automation', icon: 'ri-robot-line', read: 'automation:read', write: [] },
  { id: 'alerts', icon: 'ri-alarm-warning-line', read: 'alerts:read', write: [] },
  { id: 'reports', icon: 'ri-file-list-3-line', read: 'reports:read', write: [] },
]

// Short toggle labels (dialog.subScopes.*) of the write sub-scopes,
// shown under a row on Write when its domain has more than one.
export const SUB_SCOPE_LABEL_KEYS: Record<string, string> = {
  'vms:power': 'vmsPower',
  'vms:write': 'vmsWrite',
  'vms:snapshot': 'vmsSnapshot',
  'vms:migrate': 'vmsMigrate',
  'vms:delete': 'vmsDelete',
  'backups:write': 'backupsWrite',
  'backups:restore': 'backupsRestore',
  'backups:delete': 'backupsDelete',
  'ha:write': 'haWrite',
  'pools:write': 'poolsWrite',
  'network:write': 'networkWrite',
  'firewall:write': 'firewallWrite',
}

type AccessLevel = 'none' | 'read' | 'write'

function accessLevelOf(domain: ScopeDomain, scopes: string[]): AccessLevel {
  if (domain.write.some(scope => scopes.includes(scope))) return 'write'
  return scopes.includes(domain.read) ? 'read' : 'none'
}

// Spec values: a write token gets its own per-minute bucket (60 by default),
// and checking a write scope preselects a 90-day expiry.
const DEFAULT_WRITE_RATE_LIMIT = 60
const WRITE_TOKEN_EXPIRATION = '90'

// Answer of the grantable-scopes check for one (tenant, perimeter) key; a
// null list means the check failed.
type GrantableResult = { key: string; list: string[] | null }

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
  // A PVE connection is shown with the Proxmox mark, the same convention the
  // rest of the app uses (MigrateVmDialog's target-cluster selector). The
  // logo is a bitmap-less SVG in two variants, so it needs the palette mode.
  const isDark = useTheme().palette.mode === 'dark'
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [expiration, setExpiration] = useState('none')
  const [customDays, setCustomDays] = useState('180')
  const [scopes, setScopes] = useState<string[]>([])
  // Once the user picked an expiry, checking a write scope leaves it alone.
  const [expirationTouched, setExpirationTouched] = useState(false)
  const [writeRateLimit, setWriteRateLimit] = useState(DEFAULT_WRITE_RATE_LIMIT)
  const [grantableResult, setGrantableResult] = useState<GrantableResult | null>(null)
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

    void (async () => {
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

  function reset() {
    setName('')
    setDescription('')
    setExpiration('none')
    setCustomDays('180')
    setScopes([])
    setExpirationTouched(false)
    setWriteRateLimit(DEFAULT_WRITE_RATE_LIMIT)
    setGrantableResult(null)
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

  // The perimeter the token would get, shared by the grantable check and the
  // creation request so both always judge the same connections.
  const resolvedConnectionIds = connectionSelectorAvailable
    ? filterToVisibleConnectionIds(connectionIds, visibleConnections)
    : connectionsText
        .split(',')
        .map(c => c.trim())
        .filter(Boolean)
  const perimeterKey = resolvedConnectionIds.join(',')
  const grantableTenantId = tenantsAvailable ? tenantId : ''
  const grantableKey = `${grantableTenantId}|${perimeterKey}`

  // Which write scopes the caller may hand out for this tenant and perimeter
  // (the creation route runs the same check). Asked again on every change of
  // either; a scope that stops being grantable is unchecked rather than left
  // checked behind a disabled box.
  useEffect(() => {
    if (!open) return
    let active = true

    void (async () => {
      const params = new URLSearchParams()
      if (grantableTenantId) params.set('tenantId', grantableTenantId)
      if (perimeterKey) params.set('connectionIds', perimeterKey)
      const query = params.toString()
      let list: string[] | null = null
      try {
        const res = await fetch(`/api/v1/settings/api-tokens/grantable-scopes${query ? `?${query}` : ''}`)
        const json = res.ok ? await res.json() : null
        if (Array.isArray(json?.data?.grantable)) list = json.data.grantable
      } catch {
        // Network failure: list stays null, the write scopes stay disabled.
      }
      if (!active) return
      const allowed = list ?? []
      setGrantableResult({ key: grantableKey, list })
      setScopes(prev => prev.filter(scope => !isWriteScope(scope) || allowed.includes(scope)))
    })()

    return () => {
      active = false
    }
  }, [open, grantableKey, grantableTenantId, perimeterKey])

  // Loading (no answer yet for the current key) and failure both keep every
  // write scope disabled: the UI fails closed, the creation route stays the
  // judge either way.
  function writeScopeBlocker(scope: string): string {
    if (grantableResult?.key !== grantableKey) return t('dialog.scopesLoading')
    if (!grantableResult.list) return t('dialog.grantableError')
    return grantableResult.list.includes(scope) ? '' : t('dialog.scopeNotGrantable')
  }

  // Write on a whole domain: unavailable on a read only domain, while the
  // grantable answer is pending or failed, and when none of its write
  // scopes is grantable.
  function domainWriteBlocker(domain: ScopeDomain): string {
    if (domain.write.length === 0) return t('dialog.readOnlyDomain')
    if (grantableResult?.key !== grantableKey) return t('dialog.scopesLoading')
    if (!grantableResult.list) return t('dialog.grantableError')
    return domain.write.some(scope => grantableResult.list.includes(scope)) ? '' : t('dialog.domainNotGrantable')
  }

  // Write preselects every grantable non destructive sub-scope; a domain
  // whose only grantable ones are destructive gets the first of them, so a
  // row on Write never carries zero write scopes.
  function defaultWriteScopes(domain: ScopeDomain): string[] {
    const grantable = domain.write.filter(scope => !writeScopeBlocker(scope))
    const safe = grantable.filter(scope => !DESTRUCTIVE_SCOPE_IDS.includes(scope))
    return safe.length ? safe : grantable.slice(0, 1)
  }

  function setDomainLevel(domain: ScopeDomain, level: AccessLevel) {
    const own = new Set([domain.read, ...domain.write])
    const others = scopes.filter(scope => !own.has(scope))
    if (level === 'none') {
      setScopes(others)
    } else if (level === 'read') {
      setScopes([...others, domain.read])
    } else {
      setScopes([...others, domain.read, ...defaultWriteScopes(domain)])
      // Going back to Read or None later does not revert the expiry.
      if (!expirationTouched) setExpiration(WRITE_TOKEN_EXPIRATION)
    }
  }

  // The read scope stays when a toggle is unselected, so unselecting the
  // last one leaves the row on Read.
  function toggleSubScope(scope: string) {
    setScopes(prev => (prev.includes(scope) ? prev.filter(s => s !== scope) : [...prev, scope]))
  }

  const hasWriteScope = scopes.some(isWriteScope)
  // A write scope checked against an answer that is not (yet) a success for
  // the current tenant and perimeter: the request would likely be refused.
  const writeCheckPending = hasWriteScope && (grantableResult?.key !== grantableKey || !grantableResult.list)

  async function handleCreate() {
    setSaving(true)
    setError('')
    try {
      const res = await fetch('/api/v1/settings/api-tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name,
          description: description || undefined,
          // Canonical order, whatever the order rows were picked in.
          scopes: ALL_SCOPE_IDS.filter(scope => scopes.includes(scope)),
          connectionIds: resolvedConnectionIds.length ? resolvedConnectionIds : null,
          expiresInDays: expiresInDays(),
          // Only a write token has a write bucket; the server default
          // applies otherwise.
          ...(hasWriteScope ? { writeRateLimitPerMin: writeRateLimit } : {}),
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
            <TextField
              select
              label={t('dialog.expiration')}
              value={expiration}
              onChange={e => {
                setExpiration(e.target.value)
                setExpirationTouched(true)
              }}
              fullWidth
            >
              {EXPIRATION_CHOICES.map(choice => (
                <MenuItem key={choice.value} value={choice.value}>{t(`dialog.${choice.labelKey}`)}</MenuItem>
              ))}
            </TextField>
            {expiration === 'custom' && (
              <TextField label={t('dialog.customDays')} type='number' value={customDays} onChange={e => setCustomDays(e.target.value)} fullWidth />
            )}
            <Box>
              <Typography variant='subtitle2' sx={{ mb: 1, color: 'text.primary' }}>{t('dialog.scopes')}</Typography>
              {hasWriteScope && <Alert severity='warning' sx={{ mb: 1 }}>{t('dialog.writeWarning')}</Alert>}
              <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 1 }}>
                {SCOPE_DOMAINS.map(domain => (
                  <ScopeDomainRow
                    key={domain.id}
                    domain={domain}
                    label={t(`dialog.domains.${domain.id}`)}
                    level={accessLevelOf(domain, scopes)}
                    scopes={scopes}
                    writeBlocker={domainWriteBlocker(domain)}
                    subScopeBlocker={writeScopeBlocker}
                    onLevel={level => setDomainLevel(domain, level)}
                    onToggleSubScope={toggleSubScope}
                  />
                ))}
              </Box>
              {hasWriteScope && (
                <NumericTextField
                  label={t('dialog.writeRateLimit')}
                  helperText={t('dialog.writeRateLimitHelp')}
                  value={writeRateLimit}
                  onChange={setWriteRateLimit}
                  fallback={DEFAULT_WRITE_RATE_LIMIT}
                  min={1}
                  fullWidth
                  sx={{ mt: 2 }}
                />
              )}
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
                      <img
                        src={isDark ? '/images/proxmox-logo-dark.svg' : '/images/proxmox-logo.svg'}
                        alt=''
                        width={14}
                        height={14}
                        style={{ opacity: 0.8, flexShrink: 0 }}
                      />
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
              disabled={saving || !name.trim() || scopes.length === 0 || writeCheckPending}
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

type ScopeDomainRowProps = {
  domain: ScopeDomain
  label: string
  level: AccessLevel
  scopes: string[]
  writeBlocker: string
  subScopeBlocker: (scope: string) => string
  onLevel: (level: AccessLevel) => void
  onToggleSubScope: (scope: string) => void
}

// One domain on one line (icon, label, None | Read | Write), and on Write,
// when the domain has several write scopes, a wrap row of toggles to pick
// them. The raw scope ids sit in tooltips, to match the API reference.
function ScopeDomainRow({
  domain, label, level, scopes, writeBlocker, subScopeBlocker, onLevel, onToggleSubScope,
}: ScopeDomainRowProps) {
  const t = useTranslations('settings.apiTokens')
  const labelId = `api-token-domain-${domain.id}`
  const showChips = level === 'write' && domain.write.length > 1
  const selectedWrites = domain.write.filter(scope => scopes.includes(scope))

  return (
    <Box
      data-domain={domain.id}
      sx={{ px: 3, py: 1, '&:not(:last-of-type)': { borderBottom: 1, borderColor: 'divider' } }}
    >
      <Stack direction='row' alignItems='center' spacing={2.5} sx={{ minHeight: 32 }}>
        <Box component='i' className={domain.icon} sx={{ fontSize: 18, color: 'text.secondary', flexShrink: 0 }} />
        <Tooltip title={<ScopeIdsTitle domain={domain} />} placement='top-start' slotProps={tooltipSlotProps}>
          <Typography id={labelId} variant='body2' noWrap sx={{ flex: 1, minWidth: 0, color: 'text.primary' }}>
            {label}
          </Typography>
        </Tooltip>
        <ToggleButtonGroup
          exclusive
          size='small'
          value={level}
          aria-labelledby={labelId}
          // A click on the selected button sends null: the row keeps its level.
          onChange={(_e, value: AccessLevel | null) => value && onLevel(value)}
          sx={{ flexShrink: 0, '& .MuiToggleButton-root': { typography: 'body2', py: 1, px: 3, textTransform: 'none' } }}
        >
          <ToggleButton value='none'>{t('dialog.access.none')}</ToggleButton>
          <ToggleButton value='read' color='primary'>{t('dialog.access.read')}</ToggleButton>
          {/* The span carries the tooltip: a disabled button fires no pointer events. */}
          <Tooltip title={writeBlocker} slotProps={tooltipSlotProps}>
            <Box component='span' sx={{ display: 'inline-flex' }}>
              <ToggleButton value='write' color='warning' disabled={!!writeBlocker}>{t('dialog.access.write')}</ToggleButton>
            </Box>
          </Tooltip>
        </ToggleButtonGroup>
      </Stack>
      {showChips && (
        <ToggleButtonGroup
          size='small'
          value={selectedWrites}
          aria-label={t('dialog.subScopesLabel', { domain: label })}
          sx={{
            display: 'flex', flexWrap: 'wrap', gap: 1, pl: 7.5, pt: 1.5, pb: 1,
            '& .MuiToggleButton-root': {
              typography: 'body2', py: 1, px: 3, gap: 1, textTransform: 'none',
              border: 1, borderColor: 'divider', borderRadius: 1, ml: 0,
              '&.Mui-disabled': { borderColor: 'divider' },
            },
            '& .MuiToggleButton-root.Mui-selected': { borderColor: 'warning.main' },
          }}
        >
          {domain.write.map(scope => {
            const blocker = subScopeBlocker(scope)
            const destructive = DESTRUCTIVE_SCOPE_IDS.includes(scope)
            return (
              <Tooltip key={scope} title={<SubScopeTitle scope={scope} blocker={blocker} />} slotProps={tooltipSlotProps}>
                <Box component='span' sx={{ display: 'inline-flex' }}>
                  <ToggleButton
                    value={scope}
                    color={destructive ? 'error' : 'warning'}
                    disabled={!!blocker}
                    onChange={() => onToggleSubScope(scope)}
                    sx={destructive ? {
                      '&&:not(.Mui-disabled)': { color: 'error.main' },
                      '&:not(.Mui-disabled)': { borderColor: 'error.main' },
                    } : undefined}
                  >
                    {destructive && <i className='ri-delete-bin-line' style={{ fontSize: 14 }} />}
                    {t(`dialog.subScopes.${SUB_SCOPE_LABEL_KEYS[scope]}`)}
                  </ToggleButton>
                </Box>
              </Tooltip>
            )
          })}
        </ToggleButtonGroup>
      )}
    </Box>
  )
}

function ScopeIdsTitle({ domain }: { domain: ScopeDomain }) {
  const t = useTranslations('settings.apiTokens')
  return (
    <Box component='span' sx={{ display: 'block', typography: 'caption' }}>
      <Box component='span' sx={{ display: 'block' }}>
        {t('dialog.access.read')}: <Box component='span' sx={{ fontFamily: 'monospace' }}>{domain.read}</Box>
      </Box>
      {domain.write.length > 0 && (
        <Box component='span' sx={{ display: 'block' }}>
          {t('dialog.access.write')}: <Box component='span' sx={{ fontFamily: 'monospace' }}>{domain.write.join(', ')}</Box>
        </Box>
      )}
    </Box>
  )
}

function SubScopeTitle({ scope, blocker }: { scope: string; blocker: string }) {
  return (
    <Box component='span' sx={{ display: 'block', typography: 'caption' }}>
      <Box component='span' sx={{ display: 'block', fontFamily: 'monospace' }}>{scope}</Box>
      {blocker && <Box component='span' sx={{ display: 'block', mt: 0.5 }}>{blocker}</Box>}
    </Box>
  )
}
