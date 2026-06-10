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
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemText,
  MenuItem,
  Select,
  Switch,
  TextField,
  Tooltip,
  Typography,
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
  operatingModel?: string | null
}

interface TenantUser {
  id: string
  email: string
  name: string
  role: string
  enabled: number
  is_default: number
  is_super_admin: boolean
  joined_at: string
}

interface AllUser {
  id: string
  email: string
  name: string
}

interface Connection {
  id: string
  name: string
  type: string
  tenantId?: string | null
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
  const [form, setForm] = useState({ name: '', slug: '', description: '', enabled: true, operatingModel: 'iaas' })
  const [saving, setSaving] = useState(false)

  // Users state (inside edit dialog)
  const [tenantUsers, setTenantUsers] = useState<TenantUser[]>([])
  const [allUsers, setAllUsers] = useState<AllUser[]>([])
  const [usersLoading, setUsersLoading] = useState(false)
  const [selectedUser, setSelectedUser] = useState<AllUser | null>(null)

  // Connections state (inside edit dialog, MSP tenants only)
  const [allConnections, setAllConnections] = useState<Connection[]>([])
  const [connectionsLoading, setConnectionsLoading] = useState(false)
  const [selectedConnection, setSelectedConnection] = useState<string>('')

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

  const fetchConnections = useCallback(async () => {
    setConnectionsLoading(true)

    try {
      const res = await fetch('/api/v1/connections')

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()

      setAllConnections(data.data || [])
    } catch {
      setError(t('tenants.failedLoadConnections'))
    } finally {
      setConnectionsLoading(false)
    }
  }, [t])

  const handleCreate = () => {
    setEditingTenant(null)
    setForm({ name: '', slug: '', description: '', enabled: true, operatingModel: 'iaas' })
    setTenantUsers([])
    setAllUsers([])
    setSelectedUser(null)
    setAllConnections([])
    setSelectedConnection('')
    setDialogOpen(true)
  }

  const handleEdit = (tenant: Tenant) => {
    setEditingTenant(tenant)
    setForm({
      name: tenant.name,
      slug: tenant.slug,
      description: tenant.description || '',
      enabled: !!tenant.enabled,
      operatingModel: tenant.operatingModel || 'iaas',
    })
    setSelectedUser(null)
    setSelectedConnection('')
    setDialogOpen(true)
    fetchTenantUsers(tenant.id)

    if (tenant.operatingModel === 'msp') {
      fetchConnections()
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')

    try {
      const url = editingTenant ? `/api/v1/tenants/${editingTenant.id}` : '/api/v1/tenants'
      const method = editingTenant ? 'PUT' : 'POST'

      const body: Record<string, unknown> = {
        name: form.name,
        slug: form.slug,
        description: form.description,
        enabled: form.enabled,
      }

      // operatingModel only sent on create (immutable after creation)
      if (!editingTenant) {
        body.operatingModel = form.operatingModel
      }

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  const handleAssignConnection = async () => {
    if (!selectedConnection || !editingTenant) return

    try {
      const res = await fetch(`/api/v1/connections/${selectedConnection}/owner`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: editingTenant.id }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err.error || t('tenants.failedAssignConnection'))
      }

      setSelectedConnection('')
      setSuccess(t('tenants.connectionAssigned'))
      fetchConnections()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const handleReleaseConnection = async (connectionId: string) => {
    if (!editingTenant) return

    try {
      const res = await fetch(`/api/v1/connections/${connectionId}/owner`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'default' }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))

        throw new Error(err.error || t('tenants.failedReleaseConnection'))
      }

      setSuccess(t('tenants.connectionReleased'))
      fetchConnections()
    } catch (e: any) {
      setError(e.message)
    }
  }

  const availableUsers = allUsers.filter(
    (u) => !tenantUsers.some((tu) => tu.id === u.id)
  )

  // Connections owned by this MSP tenant
  const ownedConnections = allConnections.filter(
    (c) => editingTenant && c.tenantId === editingTenant.id
  )

  // Pool PVE connections available to assign (not already owned by anyone)
  const assignableConnections = allConnections.filter(
    (c) => c.tenantId === 'default' && c.type === 'pve'
  )

  const getInitials = (name: string, email: string) => {
    if (name) {
      const parts = name.split(' ')

      return parts.length > 1 ? `${parts[0][0]}${parts[1][0]}`.toUpperCase() : name[0].toUpperCase()
    }

    return email?.[0]?.toUpperCase() || '?'
  }

  const getOperatingModelLabel = (model: string | null | undefined) => {
    if (!model) return t('tenants.modelProvider')
    if (model === 'msp') return t('tenants.modelMsp')

    return t('tenants.modelIaas')
  }

  const getOperatingModelColor = (model: string | null | undefined): 'default' | 'primary' | 'secondary' => {
    if (!model) return 'default'
    if (model === 'msp') return 'secondary'

    return 'primary'
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
        <Chip label={params.value} size="small" sx={{ fontSize: '0.75rem' }} />
      ),
    },
    {
      field: 'operatingModel',
      headerName: t('tenants.operatingModel'),
      width: 160,
      renderCell: (params) => (
        <Chip
          label={getOperatingModelLabel(params.value)}
          size="small"
          color={getOperatingModelColor(params.value)}
          variant="outlined"
          sx={{ fontSize: '0.72rem' }}
        />
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
          icon={params.value ? undefined : <i className="ri-lock-2-line" style={{ fontSize: 14, marginLeft: 6 }} />}
          label={params.value ? t('tenants.active') : t('tenants.locked')}
          size="small"
          color={params.value ? 'success' : 'warning'}
          variant={params.value ? 'filled' : 'outlined'}
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

          {/* Operating model selector — create only, immutable after creation */}
          {!editingTenant && (
            <FormControl fullWidth>
              <InputLabel>{t('tenants.operatingModel')}</InputLabel>
              <Select
                value={form.operatingModel}
                label={t('tenants.operatingModel')}
                onChange={(e) => setForm((f) => ({ ...f, operatingModel: e.target.value }))}
              >
                <MenuItem value="iaas">
                  <Box>
                    <Typography variant="body2">{t('tenants.modelIaas')}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('tenants.modelIaasDesc')}</Typography>
                  </Box>
                </MenuItem>
                <MenuItem value="msp">
                  <Box>
                    <Typography variant="body2">{t('tenants.modelMsp')}</Typography>
                    <Typography variant="caption" color="text.secondary">{t('tenants.modelMspDesc')}</Typography>
                  </Box>
                </MenuItem>
              </Select>
            </FormControl>
          )}

          <FormControlLabel
            control={
              <Switch
                checked={form.enabled}
                onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))}
                disabled={editingTenant?.id === 'default'}
              />
            }
            label={
              <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                <Typography variant="body2">{t('tenants.active')}</Typography>
                {!form.enabled && (
                  <Typography variant="caption" color="warning.main">
                    {t('tenants.lockedHint')}
                  </Typography>
                )}
              </Box>
            }
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
                            // Super admins are pinned to every tenant by
                            // design (createTenant attaches them and the
                            // backend refuses removeUserFromTenant with
                            // SUPER_ADMIN_PROTECTED). Hide the X for them
                            // so the affordance matches the rule. Anyone
                            // else can be removed; the backend's
                            // LAST_TENANT guard still prevents orphaning
                            // (409) and surfaces in the alert above.
                            user.is_super_admin ? (
                              <Tooltip title={t('tenants.superAdminPinned')}>
                                <i className="ri-shield-keyhole-line" style={{ opacity: 0.6 }} />
                              </Tooltip>
                            ) : (
                              <Tooltip title={t('tenants.removeFromTenant')}>
                                <IconButton edge="end" size="small" color="error" onClick={() => handleRemoveUser(user.id)}>
                                  <i className="ri-close-line" />
                                </IconButton>
                              </Tooltip>
                            )
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

          {/* Connections section — MSP tenants only, edit mode */}
          {editingTenant && editingTenant.operatingModel === 'msp' && (
            <>
              <Divider sx={{ mt: 1 }} />
              <Typography variant="subtitle2" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-server-line" />
                {t('tenants.connections')}
              </Typography>

              {connectionsLoading ? (
                <LinearProgress />
              ) : (
                <>
                  {/* Assign connection control */}
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <FormControl size="small" fullWidth>
                      <InputLabel>{t('tenants.assignConnection')}</InputLabel>
                      <Select
                        value={selectedConnection}
                        label={t('tenants.assignConnection')}
                        onChange={(e) => setSelectedConnection(e.target.value)}
                      >
                        {assignableConnections.length === 0 ? (
                          <MenuItem value="" disabled>
                            {t('tenants.noAssignableConnections')}
                          </MenuItem>
                        ) : (
                          assignableConnections.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.name}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                    <Button
                      variant="contained"
                      size="small"
                      disabled={!selectedConnection}
                      onClick={handleAssignConnection}
                      sx={{ minWidth: 80 }}
                    >
                      {t('common.add')}
                    </Button>
                  </Box>

                  {/* Owned connections list */}
                  {ownedConnections.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 2 }}>
                      {t('tenants.noConnections')}
                    </Typography>
                  ) : (
                    <List dense disablePadding sx={{ maxHeight: 250, overflow: 'auto' }}>
                      {ownedConnections.map((conn) => (
                        <ListItem
                          key={conn.id}
                          secondaryAction={
                            <Tooltip title={t('tenants.releaseConnection')}>
                              <IconButton
                                edge="end"
                                size="small"
                                color="error"
                                onClick={() => handleReleaseConnection(conn.id)}
                              >
                                <i className="ri-close-line" />
                              </IconButton>
                            </Tooltip>
                          }
                        >
                          <ListItemAvatar>
                            <Avatar sx={{ width: 32, height: 32, fontSize: '0.75rem', bgcolor: 'secondary.main' }}>
                              <i className="ri-server-line" style={{ fontSize: '0.9rem' }} />
                            </Avatar>
                          </ListItemAvatar>
                          <ListItemText
                            primary={conn.name}
                            secondary={
                              <Chip
                                label={conn.type.toUpperCase()}
                                size="small"
                                sx={{ height: 16, fontSize: '0.6rem' }}
                              />
                            }
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
