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
import { useUsers, useRbacRoles, useRbacAssignments } from '@/hooks/useUsers'
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

function RoleChips({ roles, t }) {
  if (!roles || roles.length === 0) {
    return <Chip size='small' label={t ? t('usersPage.noRole') : 'No role'} variant='outlined' sx={{ opacity: 0.5 }} />
  }

  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {roles.slice(0, 2).map((role, idx) => (
        <Chip
          key={idx}
          size='small'
          label={role.name}
          sx={{
            bgcolor: role.color ? `${role.color}20` : undefined,
            color: role.color || undefined,
            borderColor: role.color || undefined,
          }}
          variant='outlined'
        />
      ))}
      {roles.length > 2 && (
        <Chip size='small' label={`+${roles.length - 2}`} variant='outlined' />
      )}
    </Box>
  )
}

function AuthProviderChip({ provider }) {
  if (provider === 'ldap') {
    return <Chip size='small' label='LDAP' variant='outlined' icon={<i className='ri-server-line' style={{ fontSize: 14 }} />} />
  }


return <Chip size='small' label='Local' variant='outlined' icon={<i className='ri-user-line' style={{ fontSize: 14 }} />} />
}

/* --------------------------------
   User Dialog - Création/Modification
-------------------------------- */

function UserDialog({ open, onClose, user, onSave, rbacRoles, t, showRbac = true }) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [selectedRoles, setSelectedRoles] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  const isEdit = !!user

  useEffect(() => {
    if (user) {
      setName(user.name || '')
      setEmail(user.email || '')
      setEnabled(user.enabled === 1)
      setSelectedRoles(user.roles || [])
      setPassword('')
    } else {
      setName('')
      setEmail('')
      setPassword('')
      setEnabled(true)
      setSelectedRoles([])
    }

    setError('')
  }, [user, open])

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

    setLoading(true)

    try {
      // Créer/Modifier l'utilisateur
      const userBody = isEdit
        ? { name, enabled: enabled ? 1 : 0, ...(password ? { password } : {}) }
        : { email, password, name }

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

      // Mettre à jour les rôles RBAC
      // D'abord supprimer les anciens rôles de l'utilisateur
      if (isEdit && user.roles) {
        for (const role of user.roles) {
          if (role.assignment_id) {
            await fetch(`/api/v1/rbac/assignments/${role.assignment_id}`, {
              method: 'DELETE'
            })
          }
        }
      }

      // Ensuite ajouter les nouveaux rôles
      for (const role of selectedRoles) {
        await fetch('/api/v1/rbac/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: userId,
            role_id: role.id,
            scope_type: 'global',
            scope_target: null
          })
        })
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
            label='Email'
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
            label='Email'
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

        {showRbac && (
          <Autocomplete
            multiple
            options={rbacRoles}
            value={selectedRoles}
            onChange={(_, newValue) => setSelectedRoles(newValue)}
            getOptionLabel={(option) => option.name}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                label={t ? t('usersPage.rbacRoles') : 'RBAC Roles'}
                placeholder={t ? t('usersPage.selectRoles') : 'Select roles...'}
                helperText={t ? t('usersPage.rolesDefinePermissions') : 'Roles define user permissions'}
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  size='small'
                  label={option.name}
                  {...getTagProps({ index })}
                  key={option.id}
                  sx={{
                    bgcolor: option.color ? `${option.color}20` : undefined,
                    color: option.color || undefined,
                  }}
                />
              ))
            }
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
                    <Typography variant='body2'>{option.name}</Typography>
                    <Typography variant='caption' sx={{ opacity: 0.6 }}>{option.description}</Typography>
                  </Box>
                </Box>
              </li>
            )}
            sx={{ mb: 2 }}
          />
        )}

        {isEdit && (
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
   Main Page
-------------------------------- */

export default function UsersPage() {
  const { data: session } = useSession()
  const t = useTranslations()
  const { hasFeature } = useLicense()
  const showRbac = hasFeature(Features.RBAC)
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

  // Combine users with their RBAC role assignments
  const users = useMemo(() => {
    const rawUsers = usersData?.data || []
    const assignments = assignmentsData?.data || []

    return rawUsers.map(user => {
      const userAssignments = assignments.filter(a => a.user_id === user.id)

      return {
        ...user,
        roles: userAssignments.map(a => ({
          id: a.role_id,
          name: a.role_name,
          color: a.role_color,
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

  const columns = useMemo(
    () => [
      {
        field: 'email',
        headerName: 'Email',
        flex: 1,
        minWidth: 200,
        renderCell: params => (
          <Box sx={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <Typography variant='body2' sx={{ fontWeight: 600, lineHeight: 1.3 }}>{params.row.email}</Typography>
            {params.row.name && (
              <Typography variant='caption' sx={{ opacity: 0.6, lineHeight: 1.2 }}>{params.row.name}</Typography>
            )}
          </Box>
        ),
      },
      // Colonne RBAC - seulement si la feature est disponible
      ...(showRbac ? [{
        field: 'roles',
        headerName: t('navigation.rbacRoles'),
        width: 200,
        renderCell: params => <RoleChips roles={params.row.roles} t={t} />,
      }] : []),
      {
        field: 'auth_provider',
        headerName: 'Auth',
        width: 100,
        renderCell: params => <AuthProviderChip provider={params.row.auth_provider} />,
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
        width: 100,
        sortable: false,
        renderCell: params => (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('common.edit')}>
              <IconButton size='small' onClick={() => handleEdit(params.row)}>
                <i className='ri-edit-line' />
              </IconButton>
            </Tooltip>
            <Tooltip title={t('common.delete')}>
              <IconButton
                size='small'
                color='error'
                onClick={() => handleDelete(params.row)}
              >
                <i className='ri-delete-bin-line' />
              </IconButton>
            </Tooltip>
          </Box>
        ),
      },
    ],
    [t, showRbac]
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
                    rowHeight={56}
                    sx={{
                      border: 'none',
                      '& .MuiDataGrid-cell': {
                        display: 'flex',
                        alignItems: 'center',
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
      />

      <DeleteDialog
        open={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        user={userToDelete}
        onConfirm={revalidateAll}
        currentUserId={session?.user?.id}
        t={t}
      />
    </Box>
  )
}
