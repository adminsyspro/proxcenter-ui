// Service accounts (issue #1404): identities for automation that only sign in
// with their API tokens. One line per account, its roles and tokens behind the
// chevron. Roles are ordinary role assignments of the account; a token minted
// here takes the account's roles, never those of the person who minted it.
import { Fragment, useCallback, useEffect, useState } from 'react'

import {
  Alert, Box, Button, Card, CardContent, Chip, Collapse, Dialog, DialogActions, DialogContent, DialogTitle,
  IconButton, LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableHead, TablePagination, TableRow,
  TextField, Tooltip, Typography,
} from '@mui/material'
import { useTranslations } from 'next-intl'

import CreateTokenDialog from './CreateTokenDialog'
import RotateTokenDialog from './RotateTokenDialog'
import { isOfferedInTenant, type RoleWire } from '@/components/rbac/catalogueClient'
import { tooltipSlotProps } from '@/components/settings/ha/tooltipSlotProps'
import { DESTRUCTIVE_SCOPE_IDS, isWriteScope } from '@/lib/api-tokens/scopes'

type AccountRole = { id: string; roleId: string; roleName: string; color: string | null; scopeType: string }

export type ServiceAccountRow = {
  id: string
  tenantId: string
  tenantName: string
  name: string
  description: string | null
  enabled: boolean
  roles: AccountRole[]
  tokenCount: number
  lastUsedAt: string | null
}

type AccountToken = { id: string; name: string; tokenPrefix: string; scopes: string[]; expiresAt: string | null; lastUsedAt: string | null }
type TenantOption = { id: string; name: string }

// Roles a service account may never take, whatever the caller: a super admin
// would pass every live rights check of its tokens.
const NEVER_ASSIGNABLE = new Set(['role_super_admin'])
const PAGE_SIZE = 10

function scopeColor(scope: string): 'default' | 'warning' | 'error' {
  if (DESTRUCTIVE_SCOPE_IDS.includes(scope)) return 'error'
  return isWriteScope(scope) ? 'warning' : 'default'
}

async function send(url: string, method: string, body?: unknown): Promise<any> {
  const res = await fetch(url, {
    method,
    ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
  return json
}

// 400: the account lost a role the token needs; 403: the caller could not grant one.
function rotateRefusal(status: number, t: (key: string) => string, tt: (key: string) => string): string {
  if (status === 400) return t('rotateUnheld')
  return status === 403 ? tt('rotateForbidden') : tt('rotateError')
}

function formatDate(value: string | null, never: string): string {
  return value ? new Date(value).toLocaleString() : never
}

type Props = {
  /** Called when tokens changed, so the token grid above reloads. */
  onTokensChanged: () => void
}

export default function ServiceAccountsPanel({ onTokensChanged }: Props) {
  const t = useTranslations('settings.apiTokens.serviceAccounts')
  const tt = useTranslations('settings.apiTokens')
  const [accounts, setAccounts] = useState<ServiceAccountRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [editing, setEditing] = useState<ServiceAccountRow | 'new' | null>(null)
  const [confirm, setConfirm] = useState<{ kind: 'delete' | 'disable'; account: ServiceAccountRow } | null>(null)
  const [minting, setMinting] = useState<ServiceAccountRow | null>(null)
  const [addingRole, setAddingRole] = useState<ServiceAccountRow | null>(null)
  const [catalogue, setCatalogue] = useState<RoleWire[]>([])

  // The roles the caller can see, loaded once; each dialog keeps those its account's tenant accepts.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const json = await send('/api/v1/rbac/roles', 'GET')
        if (active) setCatalogue(Array.isArray(json?.data) ? json.data : [])
      } catch {
        if (active) setCatalogue([])
      }
    })()
    return () => {
      active = false
    }
  }, [])

  // Bumped to reload the list after a change; the first load shows the bar.
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey(key => key + 1), [])

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const json = await send('/api/v1/service-accounts', 'GET')
        if (!active) return
        setAccounts(Array.isArray(json?.data) ? json.data : [])
        setError('')
      } catch (e: any) {
        if (active) setError(e?.message || t('loadError'))
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [reloadKey, t])

  async function setEnabled(account: ServiceAccountRow, enabled: boolean) {
    try {
      await send(`/api/v1/service-accounts/${account.id}`, 'PATCH', { enabled })
      load()
    } catch (e: any) {
      setError(e?.message || t('saveError'))
    }
  }

  async function confirmAction() {
    if (!confirm) return
    const { kind, account } = confirm
    setConfirm(null)
    if (kind === 'disable') return setEnabled(account, false)
    try {
      await send(`/api/v1/service-accounts/${account.id}`, 'DELETE')
      onTokensChanged()
      load()
    } catch (e: any) {
      setError(e?.message || t('saveError'))
    }
  }

  const visible = accounts.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE)

  return (
    <Card sx={{ mt: 3 }}>
      <CardContent>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Box>
            <Typography variant='h6'>{t('title')}</Typography>
            <Typography variant='body2' color='text.secondary'>{t('subtitle')}</Typography>
          </Box>
          <Button
            variant='contained'
            startIcon={<i className='ri-add-line' />}
            onClick={() => setEditing('new')}
            sx={{ whiteSpace: 'nowrap', flexShrink: 0, ml: 2 }}
          >
            {t('newAccount')}
          </Button>
        </Box>

        {error && <Alert severity='error' sx={{ mb: 2 }} onClose={() => setError('')}>{error}</Alert>}

        {loading && <LinearProgress />}
        {!loading && accounts.length === 0 && <Typography variant='body2' color='text.secondary'>{t('empty')}</Typography>}
        {!loading && accounts.length > 0 && (
          <>
            <Table size='small'>
              <TableHead>
                <TableRow>
                  <TableCell padding='checkbox' />
                  <TableCell>{t('columns.name')}</TableCell>
                  <TableCell>{t('columns.tenant')}</TableCell>
                  <TableCell>{t('columns.roles')}</TableCell>
                  <TableCell align='right'>{t('columns.tokens')}</TableCell>
                  <TableCell>{t('columns.lastUsed')}</TableCell>
                  <TableCell align='right' />
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map(account => (
                  <Fragment key={account.id}>
                    <AccountRow
                      account={account}
                      open={expanded === account.id}
                      onToggle={() => setExpanded(prev => (prev === account.id ? null : account.id))}
                      onEdit={() => setEditing(account)}
                      onMint={() => setMinting(account)}
                      onAddRole={() => setAddingRole(account)}
                      onEnable={() => void setEnabled(account, true)}
                      onDisable={() => setConfirm({ kind: 'disable', account })}
                      onDelete={() => setConfirm({ kind: 'delete', account })}
                    />
                    <TableRow>
                      <TableCell colSpan={7} sx={{ py: 0, borderBottom: expanded === account.id ? undefined : 'none' }}>
                        <Collapse in={expanded === account.id} unmountOnExit>
                          <AccountDetails account={account} onChanged={() => { load(); onTokensChanged() }} onError={setError} />
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                ))}
              </TableBody>
            </Table>
            {accounts.length > PAGE_SIZE && (
              <TablePagination
                component='div'
                count={accounts.length}
                page={page}
                onPageChange={(_e, next) => setPage(next)}
                rowsPerPage={PAGE_SIZE}
                rowsPerPageOptions={[PAGE_SIZE]}
              />
            )}
          </>
        )}
      </CardContent>

      {editing && (
        <AccountDialog
          key={editing === 'new' ? 'new' : editing.id}
          target={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      <Dialog open={!!confirm} onClose={() => setConfirm(null)}>
        <DialogTitle>{confirm?.kind === 'delete' ? t('deleteTitle') : t('disableTitle')}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>
            {confirm?.kind === 'delete'
              ? t('deleteConfirm', { name: confirm?.account.name ?? '' })
              : t('disableConfirm', { name: confirm?.account.name ?? '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>{tt('dialog.cancel')}</Button>
          <Button color={confirm?.kind === 'delete' ? 'error' : 'warning'} variant='contained' onClick={() => void confirmAction()}>
            {confirm?.kind === 'delete' ? t('delete') : t('disable')}
          </Button>
        </DialogActions>
      </Dialog>

      {addingRole && (
        <AddRoleDialog
          key={addingRole.id}
          account={addingRole}
          catalogue={catalogue}
          onClose={() => setAddingRole(null)}
          onAdded={() => { setAddingRole(null); load(); onTokensChanged() }}
        />
      )}

      {minting && (
        <CreateTokenDialog
          open
          serviceAccount={{ id: minting.id, name: minting.name, tenantId: minting.tenantId, tenantName: minting.tenantName }}
          onClose={() => setMinting(null)}
          onCreated={() => { load(); onTokensChanged() }}
        />
      )}
    </Card>
  )
}

type RowProps = {
  account: ServiceAccountRow
  open: boolean
  onToggle: () => void
  onEdit: () => void
  onMint: () => void
  onAddRole: () => void
  onEnable: () => void
  onDisable: () => void
  onDelete: () => void
}

function AccountRow({ account, open, onToggle, onEdit, onMint, onAddRole, onEnable, onDisable, onDelete }: RowProps) {
  const t = useTranslations('settings.apiTokens.serviceAccounts')
  const tt = useTranslations('settings.apiTokens')
  const action = (label: string, icon: string, onClick: () => void, disabled = false) => (
    <Tooltip title={label} slotProps={tooltipSlotProps}>
      <span>
        <IconButton size='small' aria-label={label} onClick={onClick} disabled={disabled}>
          <i className={icon} />
        </IconButton>
      </span>
    </Tooltip>
  )
  const shownRoles = account.roles.slice(0, 2)
  return (
    <TableRow hover sx={{ '& > td': { borderBottom: 'none', whiteSpace: 'nowrap' } }}>
      <TableCell padding='checkbox'>
        <IconButton size='small' aria-label={t('details')} aria-expanded={open} onClick={onToggle}>
          <i className={open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} />
        </IconButton>
      </TableCell>
      <TableCell>
        <Stack direction='row' spacing={1} alignItems='center'>
          <i className='ri-robot-2-line' />
          <Typography variant='body2' noWrap>{account.name}</Typography>
          <Chip
            size='small'
            label={account.enabled ? t('enabled') : t('disabled')}
            color={account.enabled ? 'success' : 'default'}
            variant='outlined'
          />
        </Stack>
      </TableCell>
      <TableCell>
        <Stack direction='row' spacing={1} alignItems='center'>
          <i className='ri-building-line' />
          <Typography variant='body2' noWrap>{account.tenantName}</Typography>
        </Stack>
      </TableCell>
      <TableCell>
        <Stack direction='row' spacing={0.5} alignItems='center' sx={{ overflow: 'hidden' }}>
          {account.roles.length === 0 && <Typography variant='body2' color='warning.main'>{t('noRole')}</Typography>}
          {shownRoles.map(role => <Chip key={role.id} size='small' label={role.roleName} />)}
          {account.roles.length > 2 && <Chip size='small' variant='outlined' label={`+${account.roles.length - 2}`} />}
        </Stack>
      </TableCell>
      <TableCell align='right'>{account.tokenCount}</TableCell>
      <TableCell>{formatDate(account.lastUsedAt, tt('never'))}</TableCell>
      <TableCell align='right'>
        <Stack direction='row' spacing={0.5} justifyContent='flex-end'>
          {action(t('newToken'), 'ri-key-2-line', onMint, !account.enabled)}
          {action(t('addRoleTitle'), 'ri-shield-user-line', onAddRole)}
          {action(t('edit'), 'ri-pencil-line', onEdit)}
          {account.enabled
            ? action(t('disable'), 'ri-pause-circle-line', onDisable)
            : action(t('enable'), 'ri-play-circle-line', onEnable)}
          {action(t('delete'), 'ri-delete-bin-line', onDelete)}
        </Stack>
      </TableCell>
    </TableRow>
  )
}

function AccountDetails({ account, onChanged, onError }: { account: ServiceAccountRow; onChanged: () => void; onError: (m: string) => void }) {
  const t = useTranslations('settings.apiTokens.serviceAccounts')
  const tt = useTranslations('settings.apiTokens')
  const [tokens, setTokens] = useState<AccountToken[] | null>(null)
  const [deletingToken, setDeletingToken] = useState<AccountToken | null>(null)
  const [rotatingToken, setRotatingToken] = useState<AccountToken | null>(null)
  // A rotation keeps the count but changes a prefix: bumped to reload the tokens.
  const [rotations, setRotations] = useState(0)

  // Reloaded whenever the account's token count moves (a token created or deleted) or a token rotates.
  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const json = await send(`/api/v1/service-accounts/${account.id}/tokens`, 'GET')
        if (active) setTokens(Array.isArray(json?.data) ? json.data : [])
      } catch (e: any) {
        if (!active) return
        onError(e?.message || t('loadError'))
        setTokens([])
      }
    })()
    return () => {
      active = false
    }
  }, [account.id, account.tokenCount, rotations, onError, t])

  async function removeRole(assignmentId: string) {
    try {
      await send(`/api/v1/rbac/assignments/${assignmentId}`, 'DELETE')
      onChanged()
    } catch (e: any) {
      onError(e?.message || t('saveError'))
    }
  }

  async function deleteToken() {
    if (!deletingToken) return
    const target = deletingToken
    setDeletingToken(null)
    try {
      await send(`/api/v1/service-accounts/${account.id}/tokens/${target.id}`, 'DELETE')
      onChanged()
    } catch (e: any) {
      onError(e?.message || t('saveError'))
    }
  }

  return (
    <Box sx={{ py: 2, pl: 6, pr: 2, display: 'grid', gap: 3, gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' } }}>
      <Box>
        <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('roles')}</Typography>
        <Typography variant='caption' color='text.secondary' sx={{ display: 'block', mb: 1 }}>{t('roleHint')}</Typography>
        <Stack direction='row' spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
          {account.roles.length === 0 && <Typography variant='body2' color='text.secondary'>{t('noRole')}</Typography>}
          {account.roles.map(role => (
            <Chip key={role.id} size='small' label={role.roleName} onDelete={() => void removeRole(role.id)} deleteIcon={
              <Tooltip title={t('removeRole')} slotProps={tooltipSlotProps}><i className='ri-close-line' /></Tooltip>
            } />
          ))}
        </Stack>
      </Box>
      <Box>
        <Typography variant='subtitle2' sx={{ mb: 1 }}>{t('tokens')}</Typography>
        {tokens === null && <LinearProgress />}
        {tokens?.length === 0 && <Typography variant='body2' color='text.secondary'>{t('noToken')}</Typography>}
        {!!tokens?.length && (
          <Table size='small'>
            <TableBody>
              {tokens.map(token => (
                <TableRow key={token.id} sx={{ '& > td': { whiteSpace: 'nowrap' } }}>
                  <TableCell>
                    <Stack direction='row' spacing={1} alignItems='center'>
                      <i className='ri-key-2-line' />
                      <Typography variant='body2'>{token.name}</Typography>
                      <Typography variant='caption' color='text.secondary'>{token.tokenPrefix}</Typography>
                    </Stack>
                  </TableCell>
                  <TableCell>
                    <Stack direction='row' spacing={0.5}>
                      {token.scopes.slice(0, 2).map(scope => <Chip key={scope} size='small' label={scope} color={scopeColor(scope)} />)}
                      {token.scopes.length > 2 && <Chip size='small' variant='outlined' label={`+${token.scopes.length - 2}`} />}
                    </Stack>
                  </TableCell>
                  <TableCell>{t('expires', { date: formatDate(token.expiresAt, tt('never')) })}</TableCell>
                  <TableCell>{t('used', { date: formatDate(token.lastUsedAt, tt('never')) })}</TableCell>
                  <TableCell align='right'>
                    <Tooltip title={tt('rotate')} slotProps={tooltipSlotProps}>
                      <span>
                        <IconButton size='small' aria-label={tt('rotate')} disabled={!account.enabled} onClick={() => setRotatingToken(token)}>
                          <i className='ri-refresh-line' />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={tt('delete')} slotProps={tooltipSlotProps}>
                      <IconButton size='small' aria-label={tt('delete')} onClick={() => setDeletingToken(token)}>
                        <i className='ri-delete-bin-line' />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Box>

      <RotateTokenDialog
        token={rotatingToken}
        url={`/api/v1/service-accounts/${account.id}/tokens/${rotatingToken?.id}/rotate`}
        confirm={t('rotateTokenConfirm')}
        onClose={() => setRotatingToken(null)}
        onRotated={() => {
          setRotations(n => n + 1)
          onChanged()
        }}
        onRefused={status => {
          onError(rotateRefusal(status, t, tt))
          setRotatingToken(null)
        }}
      />

      <Dialog open={!!deletingToken} onClose={() => setDeletingToken(null)}>
        <DialogTitle>{tt('delete')}</DialogTitle>
        <DialogContent>
          <Typography variant='body2'>{t('deleteTokenConfirm', { name: deletingToken?.name ?? '' })}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingToken(null)}>{tt('dialog.cancel')}</Button>
          <Button color='error' variant='contained' onClick={() => void deleteToken()}>{tt('dialog.confirm')}</Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// A role for the account, on one line: only what the assignment routes accept in
// the account's tenant (a customer tenant never gets a provider-only role),
// never super admin, never one it already holds.
function AddRoleDialog({ account, catalogue, onClose, onAdded }: {
  account: ServiceAccountRow
  catalogue: RoleWire[]
  onClose: () => void
  onAdded: () => void
}) {
  const t = useTranslations('settings.apiTokens.serviceAccounts')
  const tt = useTranslations('settings.apiTokens')
  const [roleId, setRoleId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const held = new Set(account.roles.map(r => r.roleId))
  const offered = catalogue.filter(r => !NEVER_ASSIGNABLE.has(r.id) && !held.has(r.id) && isOfferedInTenant(r, account.tenantId))

  async function add() {
    setSaving(true)
    setError('')
    try {
      await send('/api/v1/rbac/assignments', 'POST', { user_id: account.id, role_id: roleId, scope_type: 'inherit', tenant_id: account.tenantId })
      onAdded()
    } catch (e: any) {
      setError(e?.message || t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth='xs'>
      <DialogTitle>{t('addRoleDialogTitle', { name: account.name })}</DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Typography variant='body2' color='text.secondary' sx={{ mt: 4, mb: 5 }}>{t('addRoleHelp')}</Typography>
        <TextField select fullWidth label={t('role')} value={roleId} onChange={e => setRoleId(e.target.value)}>
          {offered.map(r => <MenuItem key={r.id} value={r.id}>{r.name}</MenuItem>)}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{tt('dialog.cancel')}</Button>
        <Button variant='contained' onClick={() => void add()} disabled={!roleId || saving}>{t('addRole')}</Button>
      </DialogActions>
    </Dialog>
  )
}

/** Mounted per target (keyed), so its fields start from the account it edits. */
function AccountDialog({ target, onClose, onSaved }: { target: ServiceAccountRow | 'new'; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations('settings.apiTokens.serviceAccounts')
  const tt = useTranslations('settings.apiTokens')
  const isNew = target === 'new'
  const [name, setName] = useState(target === 'new' ? '' : target.name)
  const [description, setDescription] = useState(target === 'new' ? '' : target.description ?? '')
  const [tenantId, setTenantId] = useState('')
  const [tenants, setTenants] = useState<TenantOption[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isNew) return
    let active = true
    void (async () => {
      try {
        const json = await send('/api/v1/tenants', 'GET')
        if (!active) return
        const list = ((Array.isArray(json?.data) ? json.data : []) as any[]).filter(x => x?.enabled).map(x => ({ id: x.id, name: x.name }))
        setTenants(list)
        setTenantId(prev => prev || list[0]?.id || '')
      } catch {
        // Without the tenant list, the account lands in the caller's own tenant.
        if (active) setTenants([])
      }
    })()
    return () => {
      active = false
    }
  }, [isNew])

  async function save() {
    setSaving(true)
    setError('')
    try {
      if (isNew) {
        await send('/api/v1/service-accounts', 'POST', { name, description: description || undefined, ...(tenantId ? { tenantId } : {}) })
      } else {
        await send(`/api/v1/service-accounts/${target.id}`, 'PATCH', { name, description })
      }
      onSaved()
    } catch (e: any) {
      setError(e?.message || t('saveError'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onClose={saving ? undefined : onClose} fullWidth maxWidth='sm'>
      <DialogTitle>{isNew ? t('dialog.createTitle') : t('dialog.editTitle')}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          {error && <Alert severity='error'>{error}</Alert>}
          <TextField label={t('dialog.name')} value={name} onChange={e => setName(e.target.value)} fullWidth required slotProps={{ htmlInput: { maxLength: 64 } }} />
          <TextField label={t('dialog.description')} value={description} onChange={e => setDescription(e.target.value)} fullWidth slotProps={{ htmlInput: { maxLength: 500 } }} />
          {isNew && tenants.length > 0 && (
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
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>{tt('dialog.cancel')}</Button>
        <Button variant='contained' onClick={() => void save()} disabled={saving || !name.trim()}>
          {isNew ? t('dialog.create') : t('dialog.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
