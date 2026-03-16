'use client'

import { useState, useEffect, useCallback } from 'react'

import {
  Alert,
  Autocomplete,
  Avatar,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  Switch,
  TextField,
  Tooltip,
  Typography,
  FormControlLabel,
} from '@mui/material'

import { DataGrid, type GridColDef } from '@mui/x-data-grid'

import { useTranslations } from 'next-intl'

interface Tenant {
  id: string
  slug: string
  name: string
  description?: string | null
  enabled: number
  createdAt: string
  updatedAt: string
}

interface TenantUser {
  id: string
  email: string
  name: string
  role: string
  enabled: number
  is_default: number
  joined_at: string
}

interface AllUser {
  id: string
  email: string
  name: string
}

export default function TenantsTab() {
  const t = useTranslations()
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTenant, setEditingTenant] = useState<Tenant | null>(null)
  const [form, setForm] = useState({ name: '', slug: '', description: '', enabled: true })
  const [saving, setSaving] = useState(false)

  // Users state (inside edit dialog)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [allUsers, setAllUsers] = useState<AllUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AllUser | null>(null)

  // Delete confirmation
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletingTenant, setDeletingTenant] = useState<Tenant | null>(null)

  const fetchTenants = useCallback(async () => {
    setLoading(true)

    try {
      const res = await fetch('/api/v1/tenants')

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()

      setTenants(data.data || [])
    } catch {
      setError(t('tenants.failedLoad'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    fetchTenants()
  }, [fetchTenants])

  const fetchTenantUsers = useCallback(async (tenantId: string) => {
    setUsersLoading(true)

    try {
      const [usersRes, allUsersRes] = await Promise.all([
        fetch(`/api/v1/tenants/${tenantId}/users`),
        fetch('/api/v1/users'),
      ])

      const usersData = await usersRes.json()
      const allUsersData = await allUsersRes.json()

      setTenantUsers(usersData.data || [])
      setAllUsers(allUsersData.data || [])
    } catch {
      setError(t('tenants.failedLoadUsers'))
    } finally {
      setUsersLoading(false)
    }
  }, [t])

  const handleCreate = () => {
    setEditingTenant(null)
    setForm({ name: '', slug: '', description: '', enabled: true })
    setTenantUsers([])
    setAllUsers([])
    setSelectedUser(null)
    setDialogOpen(true)
  }

  const handleEdit = (tenant: Tenant) => {
    setEditingTenant(tenant)
    setForm({
      name: tenant.name,
      slug: tenant.slug,
      description: tenant.description || '',
      enabled: !!tenant.enabled,
    })
    setSelectedUser(null)
    setDialogOpen(true)
    fetchTenantUsers(tenant.id)
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      const url = editingTenant ? `/api/v1/tenants/${editingTenant.id}` : '/api/v1/tenants'
      const method = editingTenant ? 'PUT' : 'POST'

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err.error || t('tenants.failedSave'))
      }

      setSuccess(editingTenant ? t('tenants.tenantUpdated') : t('tenants.tenantCreated'))
      setDialogOpen(false)
      fetchTenants()
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deletingTenant) return

    try {
      const res = await fetch(`/api/v1/tenants/${deletingTenant.id}`, { method: 'DELETE' })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err.error || t('tenants.failedDelete'))
      }

      setSuccess(t('tenants.tenantDeleted'))
      setDeleteDialogOpen(false)
      setDeletingTenant(null)
      fetchTenants()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleAddUser = async () => {
    if (!selectedUser || !editingTenant) return

    try {
      const res = await fetch(`/api/v1/tenants/${editingTenant.id}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUser.id }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err.error || t('tenants.failedAddUser'))
      }

      setSelectedUser(null)

      // Refresh users list
      const usersRes = await fetch(`/api/v1/tenants/${editingTenant.id}/users`)
      const usersData = await usersRes.json()

      setTenantUsers(usersData.data || [])
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleRemoveUser = async (userId: string) => {
    if (!editingTenant) return

    try {
      const res = await fetch(`/api/v1/tenants/${editingTenant.id}/users`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err.error || t('tenants.failedRemoveUser'))
      }

      setTenantUsers((prev) => prev.filter((u) => u.id !== userId))
    } catch (e: any) {
      setError(e.message)
    }
  }

  const availableUsers = allUsers.filter(
    (u) => !tenantUsers.some((tu) => tu.id === u.id)
  )

  const getInitials = (name: string, email: string) => {
    if (name) {
      const parts = name.split(' ')

      return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name[0].toUpperCase()
    }

    return email?.[0]?.toUpperCase() || '?'
  }

  const columns: GridColDef[] = [
    {
      field: 'name',
      headerName: t('common.name'),
      flex: 1,
      minWidth: 150,
    },
    {
      field: 'slug',
      headerName: t('tenants.slug'),
      flex: 1,
      minWidth: 120,
      renderCell: (params) => (
        <Chip label={params.value} size="small" sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '0.75rem' }} />
      ),
    },
    {
      field: 'description',
      headerName: t('common.description'),
      flex: 2,
      minWidth: 200,
    },
    {
      field: 'enabled',
      headerName: t('common.status'),
      width: 100,
      renderCell: (params) => (
        <Chip
          label={params.value ? t('tenants.active') : t('common.disabled')}
          size="small"
          color={params.value ? 'success' : 'default'}
        />
      ),
    },
    {
      field: 'actions',
      headerName: '',
      width: 100,
      sortable: false,
      renderCell: (params) => {
        const isDefault = params.row.id === 'default'

        return (
          <Box sx={{ display: 'flex', gap: 0.5 }}>
            <Tooltip title={t('common.edit')}>
              <IconButton size="small" onClick={() => handleEdit(params.row)}>
                <i className="ri-pencil-line" />
              </IconButton>
            </Tooltip>
            {!isDefault && (
              <Tooltip title={t('common.delete')}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={() => {
                    setDeletingTenant(params.row)
                    setDeleteDialogOpen(true)
                  }}
                >
                  <i className="ri-delete-bin-line" />
                </IconButton>
              </Tooltip>
            )}
          </Box>
        )
      },
    },
  ]

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert severity="success" sx={{ mb: 2 }} onClose={() => setSuccess('')}>
          {success}
        </Alert>
      )}

      <Card>
        <CardContent>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Box>
              <Typography variant="h6">{t('tenants.title')}</Typography>
              <Typography variant="body2" color="text.secondary">
                {t('tenants.subtitle')}
              </Typography>
            </Box>
            <Button variant="contained" startIcon={<i className="ri-add-line" />} onClick={handleCreate}>
              {t('tenants.newTenant')}
            </Button>
          </Box>

          {loading ? (
            <LinearProgress />
          ) : (
            <DataGrid
              rows={tenants}
              columns={columns}
              autoHeight
              disableRowSelectionOnClick
              pageSizeOptions={[10, 25]}
              initialState={{ pagination: { paginationModel: { pageSize: 10 } } }}
              sx={{
                '& .MuiDataGrid-cell': { display: 'flex', alignItems: 'center' },
              }}
            />
          )}
        </CardContent>
      </Card>

      {/* Create / Edit Dialog */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingTenant ? t('tenants.editTenant') : t('tenants.newTenant')}</DialogTitle>
        <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: '20px !important' }}>
          <TextField
            label={t('common.name')}
            value={form.name}
            onChange={(e) => {
              const name = e.target.value

              setForm((f) => ({
                ...f,
                name,
                ...(editingTenant ? {} : { slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }),
              }))
            }}
            fullWidth
            required
          />
          <TextField
            label={t('tenants.slug')}
            value={form.slug}
            onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
            fullWidth
            required
            helperText={t('tenants.slugHelp')}
          />
          <TextField
            label={t('common.description')}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            fullWidth
            multiline
            rows={2}
          />
          <FormControlLabel
            control={
              <Switch
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                disabled={editingTenant?.id === 'default'}
              />
            }
            label={t('common.enabled')}
          />

          {/* Users section — only in edit mode */}
          {editingTenant && (
            <>
              <Divider sx={{ mt: 1 }} />
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-group-line" />
                {t('tenants.users')}
              </Typography>

              {usersLoading ? (
                <LinearProgress />
              ) : (
                <>
                  {/* Add user autocomplete */}
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Autocomplete
                      size="small"
                      fullWidth
                      options={availableUsers}
                      getOptionLabel={(u) => `${u.name || ''} (${u.email})`}
                      value={selectedUser}
                      onChange={(_, v) => setSelectedUser(v)}
                      renderInput={(params) => (
                        <TextField {...params} label={t('tenants.addUser')} placeholder={t('tenants.searchUser')} />
                      )}
                      renderOption={(props, option) => (
                        <li {...props} key={option.id}>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Avatar sx={{ width: 24, height: 24, fontSize: '0.7rem', bgcolor: 'primary.main' }}>
                              {getInitials(option.name, option.email)}
                            </Avatar>
                            <Box>
                              <Typography variant="body2">{option.name || option.email}</Typography>
                              {option.name && (
                                <Typography variant="caption" color="text.secondary">{option.email}</Typography>
                              )}
                            </Box>
                          </Box>
                        </li>
                      )}
                    />
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!selectedUser}
                      onClick={handleAddUser}
                      sx={{ minWidth: 80 }}
                    >
                      {t('common.add')}
                    </Button>
                  </Box>

                  {/* Users list */}
                  {tenantUsers.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                      {t('tenants.noUsers')}
                    </Typography>
                  ) : (
                    <List dense disablePadding sx={{ maxHeight: 250, overflow: 'auto' }}>
                      {tenantUsers.map((user) => (
                        <ListItem
                          key={user.id}
                          secondaryAction={
                            editingTenant.id !== 'default' ? (
                              <Tooltip title={t('tenants.removeFromTenant')}>
                                <IconButton edge="end" size="small" color="error" onClick={() => handleRemoveUser(user.id)}>
                                  <i className="ri-close-line" />
                                </IconButton>
                              </Tooltip>
                            ) : null
                          }
                        >
                          <ListItemAvatar>
                            <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem', bgcolor: 'primary.main' }}>
                              {getInitials(user.name, user.email)}
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                {user.name || user.email}
                                <Chip label={user.role} size="small" sx={{ height: 18, fontSize: '0.6rem' }} />
                              </Box>
                            }
                            secondary={user.email}
                          />
                        </ListItem>
                      ))}
                    </List>
                  )}
                </>
              )}
            </>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !form.name || !form.slug}
          >
            {saving ? t('tenants.saving') : editingTenant ? t('common.update') : t('common.create')}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={deleteDialogOpen} onClose={() => setDeleteDialogOpen(false)}>
        <DialogTitle>{t('tenants.deleteTenant')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('tenants.deleteConfirm', { name: deletingTenant?.name || '' })}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialogOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={handleDelete}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
