'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useSession } from 'next-auth/react'

import { useTranslations } from 'next-intl'

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputAdornment,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'

import { usePageTitle } from '@/contexts/PageTitleContext'
import { useLicense, Features } from '@/contexts/LicenseContext'
import { useUsers, useRbacRoles, useRbacAssignments, useTenants } from '@/hooks/useUsers'
import EmptyState from '@/components/EmptyState'
import { TableSkeleton } from '@/components/skeletons'

/* --------------------------------
   Helpers
-------------------------------- */

function timeAgo(date, t) {
  if (!date) return t ? t('common.notAvailable') : 'N/A'
  const now = new Date()
  const past = new Date(date)
  const diff = Math.floor((now - past) / 1000)

  if (diff < 60) return t ? t('time.secondsAgo') : 'a few seconds ago'
  if (diff < 3600) return t ? t('time.minutesAgo', { count: Math.floor(diff / 60) }) : `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return t ? t('time.hoursAgo', { count: Math.floor(diff / 3600) }) : `${Math.floor(diff / 3600)}h ago`

return t ? t('time.daysAgo', { count: Math.floor(diff / 86400) }) : `${Math.floor(diff / 86400)}d ago`
}

/* --------------------------------
   Components
-------------------------------- */

function RoleChip({ roles, t }) {
  const list = Array.isArray(roles) ? roles : []
  if (list.length === 0) {
    return <Chip size='small' label={t ? t('usersPage.noRole') : 'No role'} variant='outlined' sx={{ opacity: 0.5 }} />
  }

  // Same role on every membership → single chip (the common MSP case).
  // Divergent roles (e.g. tenant_admin on tenant-1 + tenant_viewer on
  // tenant-2) get a Multiple chip whose tooltip lists the breakdown so
  // the operator notices and audits without leaving the row.
  const distinctRoleIds = new Set(list.map(r => r.id).filter(Boolean))
  if (distinctRoleIds.size <= 1) {
    const role = list[0]
    return (
      <Chip
        size='small'
        label={t && role.is_system ? t(`rbac.roles.${role.id}`) : role.name}
        sx={{
          bgcolor: role.color ? `${role.color}20` : undefined,
          color: role.color || undefined,
          borderColor: role.color || undefined,
        }}
        variant='outlined'
      />
    )
  }
  const breakdown = list.map(r => `${r.tenant_name || r.tenant_id || '?'}: ${r.name}`).join(' · ')
  return (
    <Tooltip title={breakdown}>
      <Chip
        size='small'
        label={t ? t('usersPage.rolesMixed', { count: distinctRoleIds.size }) : `${distinctRoleIds.size} roles`}
        variant='outlined'
        color='warning'
        icon={<i className='ri-error-warning-line' style={{ fontSize: 14 }} />}
      />
    </Tooltip>
  )
}

function AuthProviderChip({ provider, t }) {
  if (provider === 'ldap') {
    return <Chip size='small' label={t('usersPage.ldapAuth')} variant='outlined' icon={<i className='ri-server-line' style={{ fontSize: 14 }} />} />
  }


return <Chip size='small' label={t('usersPage.localAuth')} variant='outlined' icon={<i className='ri-user-line' style={{ fontSize: 14 }} />} />
}

/* --------------------------------
   User Dialog - Création/Modification
-------------------------------- */

// Roles that must NEVER be assigned in a non-default tenant. Mirrors
// TENANT_FORBIDDEN_ROLE_IDS in /security/rbac and the backend whitelist
// (PROVIDER_ONLY_ROLE_IDS + PROTECTED_ROLE_IDS in src/lib/rbac/index.ts).
//
// Reason: legacy "global" roles (operator / vm_admin / viewer / vm_user)
// grant automation.view which unlocks DRS / Site Recovery / Network
// Security / Resources — pages Tenant Admin explicitly excludes. Protected
// wildcards (super_admin / provider_admin) are provider-scope by design;
// binding them under a tenant is either meaningless (super_admin is
// cross-tenant) or an escalation surface (provider_admin → tenant_admin++).
const TENANT_FORBIDDEN_ROLE_IDS = new Set([
  'role_super_admin',
  'role_provider_admin',
  'role_operator',
  'role_vm_admin',
  'role_viewer',
  'role_vm_user',
])

function UserDialog({ open, onClose, user, onSave, rbacRoles, t, showRbac = true, currentUserId, currentSessionTenantId = 'default', enableTenantMgmt = false, tenantsList = [] }) {
  // Self-protection: the current user cannot change their own role or disable
  // their own account (matches the backend guards in /users/[id] and
  // /rbac/assignments). Hide those controls in the edit dialog.
  const isSelf = !!user?.id && user.id === currentUserId
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [selectedRole, setSelectedRole] = useState(null)
  const [initialRoleId, setInitialRoleId] = useState(null)
  const [selectedTenants, setSelectedTenants] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isEdit = !!user
  // Super admins are pinned to every tenant by design — disable the
  // multi-select but still display their current memberships so the
  // operator sees the rule rather than an empty field.
  const tenantPickerDisabled = isEdit && !!user?.is_super_admin
  // Detect role divergence across tenants. Used in provider view to
  // warn that saving a single role propagates to every membership and
  // overwrites per-tenant differences (typically set via the per-tenant
  // user list at Settings → Tenants → <X> → users).
  const rolesAreDivergent = isEdit && Array.isArray(user?.roles)
    ? new Set(user.roles.map(r => r.id).filter(Boolean)).size > 1
    : false

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
      // user.enabled is a Postgres boolean since the SQLite cutover; the
      // legacy int comparison (=== 1) was always false and pinned the
      // Switch off regardless of the row's real state.
      setEnabled(!!user.enabled)
      // Divergent roles → leave the picker empty so the operator must
      // pick a role explicitly (and acknowledge the propagation).
      const distinctIds = new Set((user.roles || []).map(r => r.id).filter(Boolean))
      const initialRole = distinctIds.size > 1 ? null : (user.roles?.[0] || null)
      setSelectedRole(initialRole)
      setInitialRoleId(initialRole?.id ?? null)
      setSelectedTenants(Array.isArray(user.tenants) ? user.tenants.map(t2 => t2.id) : [])
      setPassword('')
    } else {
      setName('')
      setEmail('')
      setPassword('')
      setEnabled(true)
      setSelectedRole(null)
      setSelectedTenants([])
    }

    setError('')
  }, [user, open])

  // Clear the role state when the selected tenants make the current role
  // tenant-forbidden. Without this, the role disappears from the dropdown
  // (filtered visually) but stays in component state and rides along on
  // submit — the backend would still refuse, but with a non-obvious 400
  // toast far from where the operator made the change.
  useEffect(() => {
    if (!selectedRole) return
    const targetTenantIds = enableTenantMgmt
      ? (selectedTenants.length > 0
          ? selectedTenants
          : (user?.tenants?.map(tn => tn.id) ?? []))
      : [currentSessionTenantId]
    const hasNonDefaultTarget = targetTenantIds.some(id => id !== 'default')
    if (hasNonDefaultTarget && TENANT_FORBIDDEN_ROLE_IDS.has(selectedRole.id)) {
      setSelectedRole(null)
    }
  }, [selectedTenants, selectedRole, enableTenantMgmt, currentSessionTenantId, user])

  const handleSave = async () => {
    setError('')

    if (!isEdit && !email) {
      setError(t ? t('common.error') : 'Email required')

return
    }

    if (!isEdit && !password) {
      setError(t ? t('common.error') : 'Password required')

return
    }

    if (password && password.length < 8) {
      setError(t ? t('usersPage.passwordMinLength') : 'Password must be at least 8 characters')

return
    }

    // On create from the provider view, the user MUST land in at least
    // one tenant — the auth safety net refuses login for tenant-orphan
    // users with no super_admin role. Stop here so we don't 400 round-
    // trip to the server.
    if (!isEdit && enableTenantMgmt && selectedTenants.length === 0) {
      setError(t ? t('usersPage.tenantsRequired') : 'Select at least one tenant')

return
    }

    setLoading(true)

    try {
      // Créer/Modifier l'utilisateur. Tenant assignments are sent in the
      // same payload only from the provider view (enableTenantMgmt). On
      // edit, the server still enforces the SUPER_ADMIN_PROTECTED and
      // LAST_TENANT guards via removeUserFromTenant. On create, the
      // server uses the list as the seed memberships (first id becomes
      // the default), refusing an empty list to keep the auth safety
      // net's "every user has at least one tenant" invariant.
      //
      // RBAC role: in provider view we send `roleId` so the server
      // propagates it to every membership atomically (and the per-tenant
      // DELETE-then-POST loop below is skipped). In tenant-scoped view
      // we keep the per-tenant assignment flow further down.
      const userBody = isEdit
        ? {
            name,
            enabled: enabled ? 1 : 0,
            ...(password ? { password } : {}),
            ...(enableTenantMgmt && !tenantPickerDisabled ? { tenantIds: selectedTenants } : {}),
            // Only include roleId when the operator actually changed it.
            // This avoids re-sending a protected role (super_admin /
            // provider_admin) the backend would refuse, when the dialog is
            // just being used to edit other fields.
            ...(enableTenantMgmt && showRbac && !isSelf && (selectedRole?.id ?? null) !== initialRoleId
              ? { roleId: selectedRole?.id ?? null }
              : {}),
          }
        : {
            email,
            password,
            name,
            ...(enableTenantMgmt ? { tenantIds: selectedTenants } : {}),
          }

      const res = await fetch(isEdit ? `/api/v1/users/${user.id}` : '/api/v1/users', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(userBody),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || (t ? t('common.error') : 'Error'))

return
      }

      const userId = isEdit ? user.id : data.data.id

      // Provider view (default tenant + Enterprise) handled the role
      // propagation server-side via the PATCH `roleId` field above.
      // Skip the per-assignment fallback to avoid double writes.
      if (!(isEdit && enableTenantMgmt)) {
        // Tenant-scoped view (or create): drop existing assignments
        // visible to this caller and create a fresh one in the current
        // tenant. Same behaviour as before — still one role per tenant
        // for non-provider operators.
        if (isEdit && user.roles) {
          for (const role of user.roles) {
            if (role.assignment_id) {
              await fetch(`/api/v1/rbac/assignments/${role.assignment_id}`, {
                method: 'DELETE'
              })
            }
          }
        }

        if (selectedRole) {
          await fetch('/api/v1/rbac/assignments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              user_id: userId,
              role_id: selectedRole.id,
              // inherit so the role's default scope applies automatically (issue #383)
              scope_type: 'inherit',
              scope_target: null
            })
          })
        }
      }

      onSave()
      onClose()
    } catch (e) {
      setError(t ? t('errors.connectionError') : 'Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle>{isEdit ? (t ? t('common.edit') : 'Edit') : (t ? t('common.add') : 'Add')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

        <TextField
          fullWidth
          label={t ? t('common.name') : 'Name'}
          value={name}
          onChange={e => setName(e.target.value)}
          sx={{ mt: 2, mb: 2 }}
          placeholder='John Doe'
        />

        {!isEdit && (
          <TextField
            fullWidth
            label={t ? t('usersPage.emailLabel') : 'Email'}
            type='email'
            value={email}
            onChange={e => setEmail(e.target.value)}
            sx={{ mb: 2 }}
            required
          />
        )}

        {isEdit && (
          <TextField
            fullWidth
            label={t ? t('usersPage.emailLabel') : 'Email'}
            value={user?.email || ''}
            disabled
            sx={{ mb: 2 }}
          />
        )}

        <TextField
          fullWidth
          label={isEdit ? (t ? t('usersPage.newPassword') : 'New password (leave empty to keep current)') : (t ? t('auth.password') : 'Password')}
          type={showPassword ? 'text' : 'password'}
          value={password}
          onChange={e => setPassword(e.target.value)}
          sx={{ mb: 2 }}
          required={!isEdit}
          helperText={t ? t('usersPage.minChars') : 'Minimum 8 characters'}
          InputProps={{
            endAdornment: (
              <InputAdornment position='end'>
                <IconButton size='small' onClick={() => setShowPassword(!showPassword)}>
                  <i className={showPassword ? 'ri-eye-off-line' : 'ri-eye-line'} />
                </IconButton>
              </InputAdornment>
            ),
          }}
        />

        {showRbac && !isSelf && enableTenantMgmt && rolesAreDivergent && (
          <Alert severity='warning' sx={{ mb: 2 }} icon={<i className='ri-error-warning-line' />}>
            {t ? t('usersPage.rolesDivergentWarning') : 'Roles differ across this user\'s tenants. Saving a role here will overwrite every per-tenant assignment.'}
            <Box component='span' sx={{ display: 'block', fontSize: '0.75rem', mt: 0.5, opacity: 0.85 }}>
              {(user?.roles || []).map(r => `${r.tenant_name || r.tenant_id || '?'}: ${r.name}`).join(' · ')}
            </Box>
          </Alert>
        )}

        {showRbac && !isSelf && (() => {
          // Filter roles by the tenants this assignment will land on:
          //  - Provider view (enableTenantMgmt): the role propagates to every
          //    selected tenant via PATCH `roleId`, so if any of those tenants
          //    is non-default, exclude tenant-forbidden roles. Falls back to
          //    the user's existing memberships when nothing is selected yet
          //    (edit flow before the operator touches the picker).
          //  - Tenant-scoped view: assignment lands in the current session
          //    tenant; if that's non-default, exclude forbidden roles.
          //
          // When the user is a member of `default` (in addition to others),
          // we still hide forbidden roles — the backend would 400 on the
          // tenant-scoped propagation, so surfacing the option misleads.
          const targetTenantIds = enableTenantMgmt
            ? (selectedTenants.length > 0
                ? selectedTenants
                : (user?.tenants?.map(tn => tn.id) ?? []))
            : [currentSessionTenantId]
          const hasNonDefaultTarget = targetTenantIds.some(id => id !== 'default')
          // PROTECTED_ROLE_IDS (super_admin, provider_admin) are managed
          // exclusively from Security > RBAC > Assignments — the backend
          // PATCH /users/[id] refuses them. Hide them from this dropdown
          // so the operator doesn't pick something the API rejects.
          const visibleRoles = (hasNonDefaultTarget
            ? rbacRoles.filter(r => !TENANT_FORBIDDEN_ROLE_IDS.has(r.id))
            : rbacRoles).filter(r => r.id !== 'role_super_admin' && r.id !== 'role_provider_admin')

          return (
          <Autocomplete
            options={visibleRoles}
            value={selectedRole}
            onChange={(_, newValue) => setSelectedRole(newValue)}
            getOptionLabel={(option) => t && option.is_system ? t(`rbac.roles.${option.id}`) : option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t ? t('usersPage.rbacRole') : 'RBAC Role'}
                placeholder={t ? t('usersPage.selectRole') : 'Select a role...'}
                helperText={t ? t('usersPage.roleDefinesPermissions') : 'The role defines user permissions'}
              />
            )}
            renderOption={(props, option) => (
              <li {...props} key={option.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box
                    sx={{
                      width: 12,
                      height: 12,
                      borderRadius: '50%',
                      bgcolor: option.color || 'grey.400'
                    }}
                  />
                  <Box>
                    <Typography variant='body2'>{t && option.is_system ? t(`rbac.roles.${option.id}`) : option.name}</Typography>
                    <Typography variant='caption' sx={{ opacity: 0.6 }}>{option.description}</Typography>
                  </Box>
                </Box>
              </li>
            )}
            sx={{ mb: 2 }}
          />
          )
        })()}

        {isEdit && !isSelf && (
          <FormControlLabel
            control={
              <Switch
                checked={enabled}
                onChange={e => setEnabled(e.target.checked)}
              />
            }
            label={t ? t('usersPage.accountActive') : 'Account active'}
          />
        )}

        {enableTenantMgmt && (
          <Autocomplete
            multiple
            options={tenantsList}
            value={tenantsList.filter(tt => selectedTenants.includes(tt.id))}
            onChange={(_, newValue) => setSelectedTenants(newValue.map(v => v.id))}
            getOptionLabel={option => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            disabled={tenantPickerDisabled}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  size='small'
                  label={option.name}
                  {...getTagProps({ index })}
                  key={option.id}
                />
              ))
            }
            renderInput={params => (
              <TextField
                {...params}
                label={t ? t('usersPage.tenantsLabel') : 'Tenants'}
                placeholder={tenantPickerDisabled ? '' : (t ? t('usersPage.tenantsPlaceholder') : 'Select tenants...')}
                helperText={tenantPickerDisabled
                  ? (t ? t('usersPage.tenantsAllTooltip') : 'Super admin — access to every tenant')
                  : (t ? t('usersPage.tenantsHelper') : 'The user will be a member of every selected tenant')}
                required={!isEdit}
              />
            )}
            sx={{ mt: 2 }}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t ? t('common.cancel') : 'Cancel'}</Button>
        <Button variant='contained' onClick={handleSave} disabled={loading}>
          {loading ? (t ? t('common.saving') : 'Saving...') : (t ? t('common.save') : 'Save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* --------------------------------
   Delete Confirm Dialog
-------------------------------- */

function DeleteDialog({ open, onClose, user, onConfirm, currentUserId, t }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isSelf = user?.id === currentUserId

  const handleDelete = async () => {
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`/api/v1/users/${user.id}`, { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok) {
        setError(data.error || (t ? t('common.error') : 'Error'))

return
      }

      onConfirm()
      onClose()
    } catch (e) {
      setError(t ? t('errors.connectionError') : 'Connection error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-error-warning-line' style={{ color: '#ef4444' }} />
        {t ? t('usersPage.deleteUser') : 'Delete user'}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

        {isSelf ? (
          <Alert severity='warning'>
            {t ? t('usersPage.cannotDeleteSelf') : 'You cannot delete your own account.'}
          </Alert>
        ) : (
          <>
            <Typography>
              {t ? t('common.deleteConfirmation') : 'Are you sure you want to delete this item?'} <strong>{user?.email}</strong> ?
            </Typography>
            <Typography variant='body2' sx={{ mt: 1, color: 'warning.main' }}>
              {t ? t('usersPage.deleteWarning') : 'This action is irreversible. All role assignments will also be deleted.'}
            </Typography>
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t ? t('common.cancel') : 'Cancel'}</Button>
        <Button
          variant='contained'
          color='error'
          onClick={handleDelete}
          disabled={loading || isSelf}
          startIcon={loading ? <CircularProgress size={16} /> : <i className='ri-delete-bin-line' />}
        >
          {t ? t('common.delete') : 'Delete'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* --------------------------------
   Disable 2FA Confirm Dialog
-------------------------------- */

function Disable2FADialog({ open, onClose, user, onSuccess, t }) {
  const [emailInput, setEmailInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const expectedEmail = user?.email || ''
  const canConfirm = emailInput === expectedEmail

  const handleDisable = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}/2fa/disable`, {
        method: 'POST',
      })
      if (res.ok) {
        onSuccess(user.id)
        onClose()
        return
      }
      let data = {}
      try { data = await res.json() } catch (_) {}
      if (res.status === 409 && data.code === 'POLICY_LOCK') {
        setError(t('twoFactor.policyLockError'))
      } else {
        setError(data.error || t('common.error'))
      }
    } catch (_) {
      setError(t('errors.connectionError'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setEmailInput('')
    setError('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-lock-unlock-line' style={{ color: '#ef4444' }} />
        {t('twoFactor.adminDisableConfirmTitle', { email: expectedEmail })}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Typography sx={{ mb: 2 }}>
          {t('twoFactor.adminDisableConfirmBody')}
        </Typography>
        <TextField
          fullWidth
          label={t('usersPage.emailLabel')}
          type='email'
          value={emailInput}
          onChange={e => setEmailInput(e.target.value)}
          autoComplete='off'
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          color='error'
          onClick={handleDisable}
          disabled={loading || !canConfirm}
          startIcon={loading ? <CircularProgress size={16} /> : <i className='ri-lock-unlock-line' />}
        >
          {t('twoFactor.disableButton')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* --------------------------------
   Require / Cancel 2FA-requirement Dialog
   (non-destructive — simple confirm, no email typing)
-------------------------------- */

function Require2FADialog({ open, mode, onClose, user, onSuccess, t }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const isRequire = mode === 'require'
  const titleKey = isRequire ? 'twoFactor.adminRequireConfirmTitle' : 'twoFactor.adminClearRequirementConfirmTitle'
  const bodyKey = isRequire ? 'twoFactor.adminRequireConfirmBody' : 'twoFactor.adminClearRequirementConfirmBody'
  const path = isRequire ? 'require' : 'clear-requirement'

  const handleConfirm = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/v1/admin/users/${user.id}/2fa/${path}`, {
        method: 'POST',
      })
      if (res.ok) {
        onSuccess(user.id, isRequire)
        onClose()
        return
      }
      let data = {}
      try { data = await res.json() } catch (_) {}
      setError(data.error || t('common.error'))
    } catch (_) {
      setError(t('errors.connectionError'))
    } finally {
      setLoading(false)
    }
  }

  const handleClose = () => {
    setError('')
    onClose()
  }

  return (
    <Dialog open={open} onClose={handleClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className={isRequire ? 'ri-shield-keyhole-line' : 'ri-shield-cross-line'} />
        {t(titleKey, { email: user?.email || '' })}
      </DialogTitle>
      <DialogContent sx={{ pt: '20px !important' }}>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Typography>{t(bodyKey)}</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleConfirm}
          disabled={loading}
          startIcon={loading ? <CircularProgress size={16} /> : null}
        >
          {t('common.confirm')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

/* --------------------------------
   Main Page
-------------------------------- */

export default function UsersPage() {
  const { data: session } = useSession()
  const t = useTranslations()
  const { hasFeature } = useLicense()
  const showRbac = hasFeature(Features.RBAC)
  const showTenants = hasFeature(Features.MULTI_TENANCY)
  // Cross-tenant management (list every user, edit memberships from the
  // user dialog) is only allowed from the provider tenant. Tenant-scoped
  // sessions stay limited to their own scope. Community editions never
  // load the tenants list.
  const isInDefaultTenant = (session?.user?.tenantId || 'default') === 'default'
  const enableTenantMgmt = showTenants && isInDefaultTenant
  const [activeTab, setActiveTab] = useState(0)

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('navigation.users'), t('security.users'), 'ri-user-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  // SWR data fetching
  const { data: usersData, error: usersError, isLoading: usersLoading, mutate: mutateUsers } = useUsers()
  const { data: assignmentsData, mutate: mutateAssignments } = useRbacAssignments()
  const { data: rolesData } = useRbacRoles(showRbac)
  const { data: tenantsData } = useTenants(enableTenantMgmt)
  const tenantsList = tenantsData?.data || []

  // Combine users with their RBAC role assignments
  const users = useMemo(() => {
    const rawUsers = usersData?.data || []
    const assignments = assignmentsData?.data || []

    return rawUsers.map(user => {
      const userAssignments = assignments.filter(a => (a.user?.id || a.user_id) === user.id)

      return {
        ...user,
        roles: userAssignments.map(a => ({
          id: a.role?.id || a.role_id,
          name: a.role?.name || a.role_name,
          color: a.role?.color || a.role_color,
          tenant_id: a.tenant_id || null,
          tenant_name: a.tenant_name || null,
          assignment_id: a.id,
          scope_type: a.scope_type,
          scope_target: a.scope_target
        }))
      }
    })
  }, [usersData, assignmentsData])

  const rbacRoles = rolesData?.data || []
  const loading = usersLoading
  const error = usersError ? (usersError.message || t('errors.loadingError')) : ''

  // Revalidate all data after mutations (create/edit/delete)
  const revalidateAll = useCallback(() => {
    mutateUsers()
    mutateAssignments()
  }, [mutateUsers, mutateAssignments])

  // Dialogs
  const [userDialogOpen, setUserDialogOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState(null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [userToDelete, setUserToDelete] = useState(null)

  const handleEdit = (user) => {
    setSelectedUser(user)
    setUserDialogOpen(true)
  }

  const handleDelete = (user) => {
    setUserToDelete(user)
    setDeleteDialogOpen(true)
  }

  const handleAdd = () => {
    setSelectedUser(null)
    setUserDialogOpen(true)
  }

  const [disable2FADialogOpen, setDisable2FADialogOpen] = useState(false)
  const [userToDisable2FA, setUserToDisable2FA] = useState(null)

  const handleDisable2FA = (user) => {
    setUserToDisable2FA(user)
    setDisable2FADialogOpen(true)
  }

  const handle2FADisabled = useCallback((userId) => {
    // Optimistically flip totp_enabled to false for the row without a full
    // network round-trip. mutateUsers() will reconcile on next SWR revalidation.
    mutateUsers(prev => {
      if (!prev?.data) return prev
      return {
        ...prev,
        data: prev.data.map(u => u.id === userId ? { ...u, totp_enabled: false } : u),
      }
    }, false)
  }, [mutateUsers])

  const [require2FADialogOpen, setRequire2FADialogOpen] = useState(false)
  const [require2FADialogMode, setRequire2FADialogMode] = useState('require') // 'require' | 'clear'
  const [userToRequire2FA, setUserToRequire2FA] = useState(null)

  const handleRequire2FA = (user) => {
    setUserToRequire2FA(user)
    setRequire2FADialogMode('require')
    setRequire2FADialogOpen(true)
  }

  const handleClearRequire2FA = (user) => {
    setUserToRequire2FA(user)
    setRequire2FADialogMode('clear')
    setRequire2FADialogOpen(true)
  }

  const handle2FARequirementChanged = useCallback((userId, isRequired) => {
    mutateUsers(prev => {
      if (!prev?.data) return prev
      return {
        ...prev,
        data: prev.data.map(u => u.id === userId ? { ...u, require_2fa_enrollment: isRequired } : u),
      }
    }, false)
  }, [mutateUsers])

  const columns = useMemo(
    () => [
      {
        field: 'email',
        headerName: t('usersPage.emailHeader'),
        flex: 1,
        minWidth: 200,
        renderCell: params => (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0, width: '100%' }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                bgcolor: 'action.hover',
                color: 'text.secondary',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <i className='ri-user-line' style={{ fontSize: 16 }} />
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', minWidth: 0 }}>
              <Typography variant='body2' noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>{params.row.email}</Typography>
              {params.row.name && (
                <Typography variant='caption' noWrap sx={{ opacity: 0.6, lineHeight: 1.2 }}>{params.row.name}</Typography>
              )}
            </Box>
          </Box>
        ),
      },
      // Colonne RBAC - seulement si la feature est disponible
      ...(showRbac ? [{
        field: 'roles',
        headerName: t('navigation.rbacRoles'),
        width: 200,
        renderCell: params => <RoleChip roles={params.row.roles} t={t} />,
      }] : []),
      // Tenants (multi-tenancy view) - Enterprise only.
      ...(showTenants ? [{
        field: 'tenants',
        headerName: t('usersPage.tenantsHeader'),
        width: 240,
        sortable: false,
        renderCell: params => {
          // Super admins are members of every tenant by design — listing
          // 1 000 chips would cripple the row. Render a single capped chip
          // that conveys the rule, and skip the per-tenant breakdown.
          if (params.row.is_super_admin) {
            return (
              <Tooltip title={t('usersPage.tenantsAllTooltip')}>
                <Chip
                  size='small'
                  label={t('usersPage.tenantsAll')}
                  color='primary'
                  variant='filled'
                  icon={<i className='ri-shield-keyhole-line' style={{ fontSize: 14 }} />}
                />
              </Tooltip>
            )
          }
          const list = Array.isArray(params.row.tenants) ? params.row.tenants : []
          if (list.length === 0) {
            return <Typography variant='body2' sx={{ opacity: 0.5, fontStyle: 'italic' }}>{t('usersPage.tenantsNone')}</Typography>
          }
          // Cap chip rendering at 3 to keep row height stable — anything
          // beyond gets folded into a "+N" chip whose tooltip lists the
          // overflow names so you can still inspect on demand.
          const visible = list.slice(0, 3)
          const overflow = list.slice(3)
          return (
            <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', alignItems: 'center', minWidth: 0 }}>
              {visible.map(t2 => (
                <Chip
                  key={t2.id}
                  size='small'
                  label={t2.name}
                  color={t2.isDefault ? 'primary' : 'default'}
                  variant={t2.isDefault ? 'filled' : 'outlined'}
                />
              ))}
              {overflow.length > 0 && (
                <Tooltip title={overflow.map(t2 => t2.name).join(', ')}>
                  <Chip
                    size='small'
                    label={`+${overflow.length}`}
                    variant='outlined'
                    sx={{ opacity: 0.8 }}
                  />
                </Tooltip>
              )}
            </Box>
          )
        },
      }] : []),
      {
        field: 'auth_provider',
        headerName: t('usersPage.authHeader'),
        width: 100,
        renderCell: params => <AuthProviderChip provider={params.row.auth_provider} t={t} />,
      },
      {
        field: 'totp_enabled',
        headerName: t('twoFactor.columnHeader'),
        width: 70,
        sortable: true,
        renderCell: params => {
          const tooltipSlot = {
            tooltip: {
              sx: {
                bgcolor: 'background.paper',
                color: 'text.primary',
                border: '1px solid',
                borderColor: 'divider',
                boxShadow: 1,
              },
            },
          }
          if (params.row.totp_enabled) {
            return (
              <Tooltip title={t('twoFactor.statusEnabled')} slotProps={tooltipSlot}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                  <i className='ri-shield-check-line' style={{ fontSize: 18, color: '#22c55e' }} />
                </Box>
              </Tooltip>
            )
          }
          if (params.row.require_2fa_enrollment) {
            return (
              <Tooltip title={t('twoFactor.requirementPending')} slotProps={tooltipSlot}>
                <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                  <i className='ri-time-line' style={{ fontSize: 18, color: '#f59e0b' }} />
                </Box>
              </Tooltip>
            )
          }
          return (
            <Typography variant='body2' sx={{ opacity: 0.35, textAlign: 'center', width: '100%' }}>
              {'–'}
            </Typography>
          )
        },
      },
      {
        field: 'enabled',
        headerName: t('common.status'),
        width: 100,
        renderCell: params => (
          <Chip
            size='small'
            label={params.row.enabled ? t('common.active') : t('common.inactive')}
            color={params.row.enabled ? 'success' : 'default'}
            variant='outlined'
          />
        ),
      },
      {
        field: 'last_login_at',
        headerName: t('audit.actions.login'),
        width: 160,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {timeAgo(params.row.last_login_at, t)}
          </Typography>
        ),
      },
      {
        field: 'created_at',
        headerName: t('common.date'),
        width: 120,
        renderCell: params => (
          <Typography variant='body2' sx={{ opacity: 0.7 }}>
            {new Date(params.row.created_at).toLocaleDateString()}
          </Typography>
        ),
      },
      {
        field: 'actions',
        headerName: t('common.actions'),
        width: 120,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('common.edit')}>
              <IconButton size='small' onClick={() => handleEdit(params.row)}>
                <i className='ri-edit-line' />
              </IconButton>
            </Tooltip>
            {/* Disable 2FA: only visible when the row has 2FA enabled and is not the current session user */}
            {params.row.totp_enabled && params.row.id !== session?.user?.id && (
              <Tooltip title={t('twoFactor.adminDisableMenu')}>
                <IconButton
                  size='small'
                  color='warning'
                  onClick={() => handleDisable2FA(params.row)}
                >
                  <i className='ri-lock-unlock-line' />
                </IconButton>
              </Tooltip>
            )}
            {/* Require 2FA: only visible when the row has NO 2FA AND no pending requirement AND is not the current session user */}
            {!params.row.totp_enabled && !params.row.require_2fa_enrollment && params.row.id !== session?.user?.id && (
              <Tooltip title={t('twoFactor.adminRequireMenu')}>
                <IconButton
                  size='small'
                  color='info'
                  onClick={() => handleRequire2FA(params.row)}
                >
                  <i className='ri-shield-keyhole-line' />
                </IconButton>
              </Tooltip>
            )}
            {/* Cancel 2FA requirement: only visible when the row has a pending requirement (and no 2FA yet) */}
            {!params.row.totp_enabled && params.row.require_2fa_enrollment && params.row.id !== session?.user?.id && (
              <Tooltip title={t('twoFactor.adminClearRequirementMenu')}>
                <IconButton
                  size='small'
                  color='inherit'
                  onClick={() => handleClearRequire2FA(params.row)}
                >
                  <i className='ri-shield-cross-line' />
                </IconButton>
              </Tooltip>
            )}
            {/* Hide delete on your own row — self-delete is refused by the backend */}
            {params.row.id !== session?.user?.id && (
              <Tooltip title={t('common.delete')}>
                <IconButton
                  size='small'
                  color='error'
                  onClick={() => handleDelete(params.row)}
                >
                  <i className='ri-delete-bin-line' />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        ),
      },
    ],
    [t, showRbac, showTenants, session?.user?.id, handleDisable2FA, handleRequire2FA, handleClearRequire2FA]
  )

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Tabs value={activeTab} onChange={(e, v) => setActiveTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
          <Tab label={t('navigation.users')} icon={<i className='ri-user-line' />} iconPosition='start' />
        </Tabs>

        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {activeTab === 0 && (
            <>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>
                  {users.length} {t('navigation.users').toLowerCase()}
                </Typography>
                <Button
                  variant='contained'
                  size='small'
                  startIcon={<i className='ri-add-line' />}
                  onClick={handleAdd}
                >
                  {t('common.add')}
                </Button>
              </Box>

              {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

              <Box sx={{ flex: 1, minHeight: 400 }}>
                {!loading && users.length === 0 && !error ? (
                  <EmptyState
                    icon="ri-user-line"
                    title={t('emptyState.noUsers')}
                    description={t('emptyState.noUsersDesc')}
                    action={{ label: t('common.add'), onClick: handleAdd, icon: 'ri-add-line' }}
                    size="large"
                  />
                ) : (
                  <DataGrid
                    rows={users}
                    columns={columns}
                    loading={loading}
                    pageSizeOptions={[10, 25, 50]}
                    disableRowSelectionOnClick
                    rowHeight={52}
                    columnHeaderHeight={40}
                    sx={{
                      border: 'none',
                      '& .MuiDataGrid-cell': {
                        display: 'flex',
                        alignItems: 'center',
                        overflow: 'hidden',
                      },
                      '& .MuiDataGrid-columnHeaders': {
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                      },
                    }}
                  />
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>

      {/* Dialogs */}
      <UserDialog
        open={userDialogOpen}
        onClose={() => setUserDialogOpen(false)}
        user={selectedUser}
        onSave={revalidateAll}
        rbacRoles={rbacRoles}
        t={t}
        showRbac={showRbac}
        currentUserId={session?.user?.id}
        currentSessionTenantId={session?.user?.tenantId || 'default'}
        enableTenantMgmt={enableTenantMgmt}
        tenantsList={tenantsList}
      />

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        user={userToDelete}
        onConfirm={revalidateAll}
        currentUserId={session?.user?.id}
        t={t}
      />

      <Disable2FADialog
        open={disable2FADialogOpen}
        onClose={() => setDisable2FADialogOpen(false)}
        user={userToDisable2FA}
        onSuccess={handle2FADisabled}
        t={t}
      />

      <Require2FADialog
        open={require2FADialogOpen}
        mode={require2FADialogMode}
        onClose={() => setRequire2FADialogOpen(false)}
        user={userToRequire2FA}
        onSuccess={handle2FARequirementChanged}
        t={t}
      />
    </Box>
  )
}
