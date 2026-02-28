'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'

import { useSession } from 'next-auth/react'

import { useLocale, useTranslations } from 'next-intl'
import {
  Alert, alpha, Autocomplete, Box, Button, Card, CardContent, Checkbox, Chip,
  Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider,
  FormControl, IconButton, InputLabel, List, ListItem, ListItemIcon,
  ListItemSecondaryAction, ListItemText, MenuItem, Paper, Select, Tab, Tabs,
  TextField, Tooltip, Typography
} from '@mui/material'
import { DataGrid } from '@mui/x-data-grid'

import { getDateLocale } from '@/lib/i18n/date'
import { usePageTitle } from "@/contexts/PageTitleContext"
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'

// Types
interface Permission { id: string; name: string; category: string; description: string; is_dangerous: boolean }
interface PermissionCategory { id: string; label: string; permissions: Permission[] }
interface Role { id: string; name: string; description: string | null; is_system: boolean; color: string; permissions: Permission[]; user_count: number }
interface User { id: string; email: string; name: string | null }
interface Assignment { id: string; user: User; role: { id: string; name: string; color: string }; scope_type: string; scope_target: string | null; granted_at: string; granted_by_email: string | null }

// Constants
const scopeIcons = { global: 'ri-global-line', connection: 'ri-server-line', node: 'ri-computer-line', vm: 'ri-instance-line', tag: 'ri-price-tag-3-line', pool: 'ri-folder-shared-line' }
const catIcons = { vm: 'ri-instance-line', storage: 'ri-hard-drive-3-line', node: 'ri-computer-line', connection: 'ri-server-line', backup: 'ri-archive-line', admin: 'ri-shield-user-line' }

// Scope labels function
const getScopeLabels = (t: any) => ({
  global: t('rbac.scopes.global'),
  connection: t('rbac.scopes.connection'),
  node: t('rbac.scopes.node'),
  vm: t('rbac.scopes.vmct'),
  tag: t('rbac.scopes.tag'),
  pool: t('rbac.scopes.pool')
})

const timeAgo = (d, t?: any, locale?: string) => {
  if (!d) return t ? t('common.notAvailable') : 'N/A'
  const diff = Math.floor((Date.now() - new Date(d).getTime()) / 1000)

  if (diff < 60) return t ? t('time.justNow') : 'just now'
  if (diff < 3600) return t ? t('time.minutesAgo', { count: Math.floor(diff / 60) }) : `${Math.floor(diff / 60)} min ago`
  if (diff < 86400) return t ? t('time.hoursAgo', { count: Math.floor(diff / 3600) }) : `${Math.floor(diff / 3600)} h ago`

return new Date(d).toLocaleDateString(locale)
}

// Role Dialog
function RoleDialog({ open, onClose, role, categories, onSave, t }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6366f1')
  const [selectedPerms, setSelectedPerms] = useState(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(new Set())
  const isEdit = !!role

  useEffect(() => {
    if (role) {
      setName(role.name)
      setDescription(role.description || '')
      setColor(role.color || '#6366f1')
      setSelectedPerms(new Set(role.permissions.map(p => p.id)))
    } else {
      setName(''); setDescription(''); setColor('#6366f1'); setSelectedPerms(new Set())
    }

    setExpanded(new Set(categories.map(c => c.id)))
    setError('')
  }, [role, open, categories])

  const togglePerm = (id) => setSelectedPerms(p => { const n = new Set(p);

 n.has(id) ? n.delete(id) : n.add(id); 

return n })

  const toggleCat = (catId) => {
    const cat = categories.find(c => c.id === catId)

    if (!cat) return
    const ids = cat.permissions.map(p => p.id)
    const all = ids.every(id => selectedPerms.has(id))

    setSelectedPerms(p => { const n = new Set(p);

 ids.forEach(id => all ? n.delete(id) : n.add(id)); 

return n })
  }

  const handleSave = async () => {
    if (!name.trim()) { setError(t('common.error'));

return }

    setLoading(true); setError('')

    try {
      const res = await fetch(isEdit ? `/api/v1/rbac/roles/${role.id}` : '/api/v1/rbac/roles', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim() || null, color, permissions: Array.from(selectedPerms) })
      })

      const data = await res.json()

      if (!res.ok) { setError(data.error || t('common.error'));

return }

      onSave(); onClose()
    } catch { setError(t('errors.connectionError')) } finally { setLoading(false) }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='md' fullWidth>
      <DialogTitle><i className={isEdit ? 'ri-edit-line' : 'ri-add-line'} style={{marginRight:8}}/>{isEdit ? t('common.edit') : t('common.add')}</DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}
        <Box sx={{ display: 'flex', gap: 2, mt: 1, mb: 2 }}>
          <TextField fullWidth label={t('common.name')} value={name} onChange={e => setName(e.target.value)} disabled={role?.is_system} required />
          <TextField label={t('common.color')} type='color' value={color} onChange={e => setColor(e.target.value)} sx={{ width: 100 }} disabled={role?.is_system} />
        </Box>
        <TextField fullWidth label={t('common.description')} value={description} onChange={e => setDescription(e.target.value)} multiline rows={2} sx={{ mb: 2 }} disabled={role?.is_system} />
        <Typography variant='subtitle2' sx={{ mb: 1, fontWeight: 600 }}>{t('rbacPage.permissionsCount', { count: selectedPerms.size })}</Typography>
        {role?.is_system && <Alert severity='info' sx={{ mb: 1 }}>{t('rbac.cannotModifySystem')}</Alert>}
        <Paper variant='outlined' sx={{ maxHeight: 350, overflow: 'auto' }}>
          {categories.map(cat => {
            const ids = cat.permissions.map(p => p.id)
            const sel = ids.filter(id => selectedPerms.has(id)).length
            const isExp = expanded.has(cat.id)

            
return (
              <Box key={cat.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1, bgcolor: 'action.hover', cursor: 'pointer' }} onClick={() => setExpanded(p => { const n = new Set(p);

 n.has(cat.id) ? n.delete(cat.id) : n.add(cat.id); 

return n })}>
                  <IconButton size='small'><i className={isExp ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} /></IconButton>
                  <i className={catIcons[cat.id] || 'ri-folder-line'} style={{ margin: '0 8px' }} />
                  <Typography variant='subtitle2' sx={{ flex: 1 }}>{t(`rbac.categories.${cat.id}`, { defaultValue: cat.label })}</Typography>
                  <Chip size='small' label={`${sel}/${cat.permissions.length}`} color={sel === cat.permissions.length ? 'primary' : 'default'} variant='outlined' sx={{ mr: 1 }} />
                  <Checkbox checked={sel === cat.permissions.length} indeterminate={sel > 0 && sel < cat.permissions.length} onChange={() => toggleCat(cat.id)} onClick={e => e.stopPropagation()} size='small' disabled={role?.is_system} />
                </Box>
                <Collapse in={isExp}>
                  <List dense disablePadding>
                    {cat.permissions.map(perm => (
                      <ListItem key={perm.id} sx={{ pl: 6, borderBottom: '1px solid', borderColor: 'divider' }}>
                        <ListItemIcon sx={{ minWidth: 32 }}>{perm.is_dangerous ? <Tooltip title={t('rbac.dangerousPermission')} arrow><i className='ri-shield-flash-line' style={{ color: '#f59e0b', fontSize: '1.1rem' }} /></Tooltip> : <i className='ri-checkbox-blank-circle-line' style={{ opacity: 0.2 }} />}</ListItemIcon>
                        <ListItemText primary={<code style={{ fontSize: '0.85rem' }}>{perm.name}</code>} secondary={t(`rbac.permDesc.${perm.id}`, { defaultValue: perm.description })} />
                        <ListItemSecondaryAction><Checkbox checked={selectedPerms.has(perm.id)} onChange={() => togglePerm(perm.id)} size='small' disabled={role?.is_system} /></ListItemSecondaryAction>
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Box>
            )
          })}
        </Paper>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        {!role?.is_system && <Button variant='contained' onClick={handleSave} disabled={loading}>{loading ? t('common.saving') : isEdit ? t('common.update') : t('common.create')}</Button>}
      </DialogActions>
    </Dialog>
  )
}

// Assignment Dialog avec sélection dynamique des ressources
function AssignmentDialog({ open, onClose, roles, users, onSave, t }) {
  const [user, setUser] = useState(null)
  const [roleId, setRoleId] = useState('')
  const [scopeType, setScopeType] = useState('global')
  const [selectedTargets, setSelectedTargets] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  
  // Inventory data
  const [inventory, setInventory] = useState<any>(null)
  const [loadingInventory, setLoadingInventory] = useState(false)

  // Charger l'inventaire quand le dialog s'ouvre
  useEffect(() => {
    if (open && !inventory) {
      setLoadingInventory(true)
      fetch('/api/v1/inventory')
        .then(res => res.json())
        .then(data => setInventory(data.data))
        .catch(() => setError(t('errors.loadingError')))
        .finally(() => setLoadingInventory(false))
    }
  }, [open, inventory])

  // Reset quand le dialog s'ouvre
  useEffect(() => {
    if (open) {
      setUser(null)
      setRoleId('')
      setScopeType('global')
      setSelectedTargets([])
      setSearchFilter('')
      setError('')
    }
  }, [open])

  // Construire les options selon le scope type
  const scopeOptions = useMemo(() => {
    if (!inventory?.clusters) return []

    switch (scopeType) {
      case 'connection':
        return inventory.clusters.map((c: any) => ({
          id: c.id,
          label: c.name,
          sublabel: t('rbacPage.nodeCount', { count: c.nodes?.length || 0 }),
          icon: 'ri-server-line',
          status: c.status
        }))

      case 'node': {
        const nodes: any[] = []

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            nodes.push({
              id: `${c.id}:${n.node}`,
              label: n.node,
              sublabel: c.name,
              icon: 'ri-computer-line',
              status: n.status,
              cluster: c.name
            })
          })
        })

        return nodes
      }

      case 'vm': {
        const vms: any[] = []

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            n.guests?.forEach((g: any) => {
              vms.push({
                id: `${c.id}:${n.node}:${g.type}:${g.vmid}`,
                label: g.name || `${g.type}/${g.vmid}`,
                sublabel: `${g.type.toUpperCase()} ${g.vmid} • ${n.node} • ${c.name}`,
                icon: g.type === 'lxc' ? 'ri-box-3-line' : 'ri-instance-line',
                status: g.status,
                vmid: g.vmid,
                type: g.type,
                node: n.node,
                cluster: c.name
              })
            })
          })
        })

        return vms
      }

      case 'tag': {
        const tagMap = new Map<string, number>()

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            n.guests?.forEach((g: any) => {
              const tags = typeof g.tags === 'string'
                ? g.tags.split(/[;,]/).map((t: string) => t.trim()).filter(Boolean)
                : []
              tags.forEach((tag: string) => {
                tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
              })
            })
          })
        })

        return Array.from(tagMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([tag, count]) => ({
            id: tag,
            label: tag,
            sublabel: t('rbacPage.tagUsedByVms', { count }),
            icon: 'ri-price-tag-3-line'
          }))
      }

      case 'pool': {
        const poolMap = new Map<string, number>()

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            n.guests?.forEach((g: any) => {
              if (g.pool) {
                poolMap.set(g.pool, (poolMap.get(g.pool) || 0) + 1)
              }
            })
          })
        })

        return Array.from(poolMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([pool, count]) => ({
            id: pool,
            label: pool,
            sublabel: t('rbacPage.poolContainsVms', { count }),
            icon: 'ri-folder-shared-line'
          }))
      }

      default:
        return []
    }
  }, [inventory, scopeType])

  // Toggle sélection d'un élément
  const toggleTarget = (id: string) => {
    setSelectedTargets(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  // Sélectionner/Désélectionner tout
  const toggleAll = () => {
    if (selectedTargets.length === scopeOptions.length) {
      setSelectedTargets([])
    } else {
      setSelectedTargets(scopeOptions.map((o: any) => o.id))
    }
  }

  // Filtrer les options selon la recherche
  const filteredOptions = useMemo(() => {
    if (!searchFilter.trim()) return scopeOptions
    const search = searchFilter.toLowerCase()


return scopeOptions.filter((o: any) =>
      o.label.toLowerCase().includes(search) ||
      o.sublabel?.toLowerCase().includes(search) ||
      o.id.toLowerCase().includes(search)
    )
  }, [scopeOptions, searchFilter])

  // Sauvegarder (créer une assignation par cible sélectionnée)
  const handleSave = async () => {
    if (!user || !roleId) {
      setError(t('common.error'))
      
return
    }

    if (scopeType !== 'global' && selectedTargets.length === 0) {
      setError(t('common.error'))
      
return
    }

    setSaving(true)
    setError('')

    try {
      const targets = scopeType === 'global' ? [null] : selectedTargets
      let successCount = 0
      let errors: string[] = []

      for (const target of targets) {
        const res = await fetch('/api/v1/rbac/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: user.id,
            role_id: roleId,
            scope_type: scopeType,
            scope_target: target
          })
        })

        const data = await res.json()

        if (res.ok) {
          successCount++
        } else {
          errors.push(data.error || t('common.error'))
        }
      }

      if (successCount > 0) {
        onSave()

        if (errors.length === 0) {
          onClose()
        } else {
          setError(`${successCount} / ${errors.length} ${t('common.error')}`)
        }
      } else {
        setError(errors[0] || t('common.error'))
      }
    } catch {
      setError(t('errors.connectionError'))
    } finally {
      setSaving(false)
    }
  }

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': case 'running': return 'success'
      case 'offline': case 'stopped': return 'error'
      case 'degraded': case 'paused': return 'warning'
      default: return 'default'
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-user-add-line' />
        {t('common.add')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

        {/* Sélection utilisateur */}
        <Autocomplete
          options={users}
          getOptionLabel={(u: any) => `${u.email}${u.name ? ` (${u.name})` : ''}`}
          value={user}
          onChange={(_, v) => setUser(v)}
          renderInput={p => <TextField {...p} label={t('navigation.users')} required sx={{ mt: 2 }} />}
          renderOption={(props, option: any) => (
            <li {...props} key={option.id}>
              <Box>
                <Typography variant='body2'>{option.email}</Typography>
                {option.name && <Typography variant='caption' sx={{ opacity: 0.6 }}>{option.name}</Typography>}
              </Box>
            </li>
          )}
        />
        
        {/* Sélection rôle */}
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>{t('rbac.title')}</InputLabel>
          <Select value={roleId} label={t('rbac.title')} onChange={e => setRoleId(e.target.value)}>
            {roles.map((r: any) => (
              <MenuItem key={r.id} value={r.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: r.color }} />
                  {r.name}
                  {r.is_system && <Chip label={t('rbacPage.systemRole')} size='small' sx={{ height: 18, fontSize: '0.7rem' }} />}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        {/* Sélection scope type */}
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>{t('rbacPage.scope')}</InputLabel>
          <Select
            value={scopeType}
            label={t('rbacPage.scope')}
            onChange={e => { setScopeType(e.target.value); setSelectedTargets([]) }}
          >
            <MenuItem value='global'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-global-line' style={{ color: '#6366f1' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.globalScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.accessAllResources')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='connection'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-server-line' style={{ color: '#8b5cf6' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.clusterConnection')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToClusters')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='node'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-computer-line' style={{ color: '#f59e0b' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.nodeScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToNodes')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='vm'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-instance-line' style={{ color: '#10b981' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.vmContainer')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToVmsCts')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='tag'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-price-tag-3-line' style={{ color: '#ec4899' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.tagScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToTag')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='pool'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-folder-shared-line' style={{ color: '#14b8a6' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.poolScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToPool')}</Typography>
                </Box>
              </Box>
            </MenuItem>
          </Select>
        </FormControl>

        {/* Sélection des ressources */}
        {scopeType !== 'global' && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant='subtitle2'>
                {t('rbacPage.selectResources')} ({selectedTargets.length}/{scopeOptions.length})
              </Typography>
              <Button size='small' onClick={toggleAll}>
                {selectedTargets.length === scopeOptions.length ? (t('rbacPage.deselectAll')) : (t('rbacPage.selectAll'))}
              </Button>
            </Box>

            {/* Champ de recherche */}
            <TextField
              fullWidth
              size='small'
              placeholder={t('rbacPage.searchResource')}
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              sx={{ mb: 1 }}
              InputProps={{
                startAdornment: <i className='ri-search-line' style={{ marginRight: 8, opacity: 0.5 }} />
              }}
            />

            {loadingInventory ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('rbacPage.loadingInventory')}</Typography>
              </Box>
            ) : scopeOptions.length === 0 ? (
              <Alert severity='warning'>{t('rbacPage.noResourceAvailable')}</Alert>
            ) : filteredOptions.length === 0 ? (
              <Alert severity='info'>{t('rbacPage.noResultsFor', { query: searchFilter })}</Alert>
            ) : (
              <Paper variant='outlined' sx={{ maxHeight: 250, overflow: 'auto' }}>
                <List dense disablePadding>
                  {filteredOptions.map((option: any) => (
                    <ListItem
                      key={option.id}
                      sx={{
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                      onClick={() => toggleTarget(option.id)}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          checked={selectedTargets.includes(option.id)}
                          size='small'
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleTarget(option.id)}
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <i className={option.icon} style={{ fontSize: 18, opacity: 0.7 }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant='body2' sx={{ fontWeight: 500 }}>{option.label}</Typography>
                            {option.status && (
                              <Chip
                                label={option.status}
                                size='small'
                                color={getStatusColor(option.status) as any}
                                sx={{ height: 18, fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>
                        }
                        secondary={option.sublabel}
                      />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            )}
          </Box>
        )}

        {scopeType === 'global' && (
          <Alert severity='info' sx={{ mt: 2 }}>
            <span dangerouslySetInnerHTML={{ __html: t('rbacPage.userHasRoleOnAll') }} />
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={saving || !user || !roleId || (scopeType !== 'global' && selectedTargets.length === 0)}
        >
          {saving ? t('common.saving') : selectedTargets.length > 1 ? `${t('common.save')} (${selectedTargets.length})` : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Delete Dialog
function DeleteDialog({ open, onClose, title, message, onConfirm, loading, t }) {
  return (
    <Dialog open={open} onClose={onClose}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent><Typography>{message}</Typography></DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant='contained' color='error' onClick={onConfirm} disabled={loading}>{loading ? (t('common.deleting')) : (t('common.delete'))}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Roles Tab
function RolesTab({ roles, categories, onRefresh, t }) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  const handleDelete = async () => {
    if (!toDelete) return
    setDeleting(true)

    try {
      const res = await fetch(`/api/v1/rbac/roles/${toDelete.id}`, { method: 'DELETE' })
      const data = await res.json()

      if (!res.ok) { setError(data.error); 

return }

      setDeleteOpen(false); onRefresh()
    } catch { setError(t('common.error')) } finally { setDeleting(false) }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {error && <Alert severity='error' onClose={() => setError('')}>{error}</Alert>}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('rbacPage.rolesCount', { count: roles.length })}</Typography>
        <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={() => { setSelected(null); setDialogOpen(true) }}>{t('rbacPage.newRole')}</Button>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
        {roles.map(role => (
          <Paper key={role.id} variant='outlined' sx={{ p: 2, borderLeft: 4, borderLeftColor: role.color, '&:hover': { bgcolor: 'action.hover' } }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
              <Box>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography variant='subtitle1' sx={{ fontWeight: 600 }}>{role.is_system ? t(`rbac.roles.${role.id}`, { defaultValue: role.name }) : role.name}</Typography>
                  {role.is_system && <Chip label={t('rbacPage.systemRole')} size='small' variant='outlined' sx={{ height: 20, fontSize: '0.7rem' }} />}
                </Box>
                {role.description && <Typography variant='body2' sx={{ opacity: 0.6 }}>{role.is_system ? t(`rbac.roleDesc.${role.id}`, { defaultValue: role.description }) : role.description}</Typography>}
              </Box>
              <Box>
                <Tooltip title={role.is_system ? t('common.view') : t('common.edit')}><IconButton size='small' onClick={() => { setSelected(role); setDialogOpen(true) }}><i className={role.is_system ? 'ri-eye-line' : 'ri-edit-line'} /></IconButton></Tooltip>
                {!role.is_system && <Tooltip title={t('common.delete')}><IconButton size='small' color='error' onClick={() => { setToDelete(role); setDeleteOpen(true) }}><i className='ri-delete-bin-line' /></IconButton></Tooltip>}
              </Box>
            </Box>
            <Divider sx={{ my: 1 }} />
            <Box sx={{ display: 'flex', gap: 2 }}>
              <Typography variant='body2'><i className='ri-key-line' style={{ opacity: 0.5, marginRight: 4 }} />{role.permissions.length} {t('rbacPage.permissions')}</Typography>
              <Typography variant='body2'><i className='ri-user-line' style={{ opacity: 0.5, marginRight: 4 }} />{t('rbacPage.userCount', { count: role.user_count })}</Typography>
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {role.permissions.slice(0, 4).map(p => <Chip key={p.id} label={p.name.split('.')[1]} size='small' variant='outlined' sx={{ height: 20, fontSize: '0.7rem' }} />)}
              {role.permissions.length > 4 && <Chip label={`+${role.permissions.length - 4}`} size='small' sx={{ height: 20, fontSize: '0.7rem' }} />}
            </Box>
          </Paper>
        ))}
      </Box>
      <RoleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} role={selected} categories={categories} onSave={onRefresh} t={t} />
      <DeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('rbacPage.deleteRole')} message={t('rbacPage.deleteRoleConfirm', { name: toDelete?.name })} onConfirm={handleDelete} loading={deleting} t={t} />
    </Box>
  )
}

// Assignments Tab avec regroupement par utilisateur/rôle/scope_type
function AssignmentsTab({ assignments, roles, users, onRefresh, t }) {
  const dateLocale = getDateLocale(useLocale())
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [toEdit, setToEdit] = useState<any>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState<any>(null)
  const [deleting, setDeleting] = useState(false)
  const [filter, setFilter] = useState('')

  // Regrouper les assignations par user_id + role_id + scope_type
  const groupedAssignments = useMemo(() => {
    const groups = new Map<string, any>()
    
    assignments.forEach((a: any) => {
      const key = `${a.user.id}:${a.role.id}:${a.scope_type}`
      
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          user: a.user,
          role: a.role,
          scope_type: a.scope_type,
          scope_targets: [],
          assignments: [],
          granted_at: a.granted_at,
          granted_by_email: a.granted_by_email
        })
      }
      
      const group = groups.get(key)

      if (a.scope_target) {
        group.scope_targets.push(a.scope_target)
      }

      group.assignments.push(a)
      
      // Garder la date la plus récente
      if (new Date(a.granted_at) > new Date(group.granted_at)) {
        group.granted_at = a.granted_at
        group.granted_by_email = a.granted_by_email
      }
    })
    
    return Array.from(groups.values())
  }, [assignments])

  const filtered = useMemo(() => {
    if (!filter) return groupedAssignments
    
return groupedAssignments.filter(a => 
      a.user.email.toLowerCase().includes(filter.toLowerCase()) || 
      a.user.name?.toLowerCase().includes(filter.toLowerCase())
    )
  }, [groupedAssignments, filter])

  // All users are available for assignment (a user can have multiple roles)
  const availableUsers = users

  // Supprimer un groupe entier (toutes les assignations du groupe)
  const handleDeleteGroup = async () => {
    if (!toDelete) return
    setDeleting(true)

    try {
      // Supprimer toutes les assignations du groupe
      for (const assignment of toDelete.assignments) {
        await fetch(`/api/v1/rbac/assignments/${assignment.id}`, { method: 'DELETE' })
      }

      setDeleteOpen(false)
      onRefresh()
    } finally { 
      setDeleting(false) 
    }
  }

  const scopeLabels = getScopeLabels(t)

  // Formater l'affichage des ressources
  const formatScopeTargets = (row: any) => {
    if (row.scope_type === 'global') {
      return <Typography variant='body2' sx={{ opacity: 0.7 }}>{t('common.all')}</Typography>
    }

    const count = row.scope_targets.length

    if (count === 0) return null

    // Tag/pool: display as colored chips
    if (row.scope_type === 'tag' || row.scope_type === 'pool') {
      const color = row.scope_type === 'tag' ? '#ec4899' : '#14b8a6'
      const icon = row.scope_type === 'tag' ? 'ri-price-tag-3-line' : 'ri-folder-shared-line'

      if (count === 1) {
        return (
          <Chip
            icon={<i className={icon} style={{ fontSize: 14, color }} />}
            label={row.scope_targets[0]}
            size='small'
            variant='outlined'
            sx={{ height: 22, fontSize: '0.75rem', borderColor: color, color }}
          />
        )
      }

      return (
        <Tooltip title={row.scope_targets.join(', ')}>
          <Chip
            icon={<i className={icon} style={{ fontSize: 14, color }} />}
            label={`${count} ${row.scope_type === 'tag' ? t('rbacPage.tags') : t('rbacPage.pools')}`}
            size='small'
            variant='outlined'
            sx={{ height: 22, fontSize: '0.75rem', borderColor: color, color }}
          />
        </Tooltip>
      )
    }

    if (count === 1) {
      const target = row.scope_targets[0]

      // Extraire un nom lisible du target
      const parts = target.split(':')
      let displayName = target

      if (row.scope_type === 'vm' && parts.length >= 4) {
        displayName = `${parts[2]}/${parts[3]}`
      } else if (row.scope_type === 'node' && parts.length >= 2) {
        displayName = parts[1]
      }


return (
        <Tooltip title={target}>
          <Typography variant='body2' sx={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
            {displayName.length > 20 ? displayName.slice(0, 20) + '...' : displayName}
          </Typography>
        </Tooltip>
      )
    }

    // Plusieurs ressources
    return (
      <Tooltip title={row.scope_targets.join('\n')}>
        <Chip
          label={`${count} ${row.scope_type === 'vm' ? t('rbacPage.vmsCts') : row.scope_type === 'node' ? t('rbac.scopes.node') : t('rbac.scopes.connection')}`}
          size='small'
          variant='outlined'
          sx={{ height: 22, fontSize: '0.75rem' }}
        />
      </Tooltip>
    )
  }

  const columns = useMemo(() => [
    { field: 'user', headerName: t('navigation.users'), flex: 1, minWidth: 200, renderCell: (p: any) => (
      <Typography variant='body2' sx={{ fontWeight: 500 }}>
        {p.row.user.email}
        {p.row.user.name && <Typography component='span' variant='caption' sx={{ opacity: 0.6, ml: 1 }}>({p.row.user.name})</Typography>}
      </Typography>
    )},
    { field: 'role', headerName: t('rbac.title'), width: 130, renderCell: (p: any) => (
      <Chip label={p.row.role.is_system ? t(`rbac.roles.${p.row.role.id}`, { defaultValue: p.row.role.name }) : p.row.role.name} size='small' sx={{ bgcolor: alpha(p.row.role.color, 0.15), color: p.row.role.color, fontWeight: 500, height: 24 }} />
    )},
    { field: 'scope_type', headerName: t('rbacPage.scope'), width: 140, renderCell: (p: any) => (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <i className={scopeIcons[p.row.scope_type]} style={{ opacity: 0.6, fontSize: 14 }} />
        <Typography variant='body2'>{scopeLabels[p.row.scope_type]}</Typography>
      </Box>
    )},
    { field: 'scope_targets', headerName: t('navigation.resources'), flex: 1, minWidth: 150, renderCell: (p: any) => formatScopeTargets(p.row) },
    { field: 'granted_at', headerName: t('common.date'), width: 150, renderCell: (p: any) => (
      <Typography variant='body2' sx={{ opacity: 0.7 }}>
        {timeAgo(p.row.granted_at, t, dateLocale)}
        {p.row.granted_by_email && ` - ${p.row.granted_by_email.split('@')[0]}`}
      </Typography>
    )},
    { field: 'actions', headerName: '', width: 80, sortable: false, renderCell: (p: any) => (
      <Box sx={{ display: 'flex', gap: 0 }}>
        <Tooltip title={t('common.edit')}>
          <IconButton size='small' onClick={() => { setToEdit(p.row); setEditDialogOpen(true) }}>
            <i className='ri-edit-line' style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('common.delete')}>
          <IconButton size='small' color='error' onClick={() => { setToDelete(p.row); setDeleteOpen(true) }}>
            <i className='ri-delete-bin-line' style={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>
    )}
  ], [t, scopeLabels])

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 2 }}>
        <TextField size='small' placeholder={t('common.search')} value={filter} onChange={e => setFilter(e.target.value)} InputProps={{ startAdornment: <i className='ri-search-line' style={{ marginRight: 8, opacity: 0.5 }} /> }} sx={{ width: 250 }} />
        <Button variant='contained' size='small' startIcon={<i className='ri-user-add-line' />} onClick={() => setDialogOpen(true)} disabled={users.length === 0}>
          {t('common.add')}
        </Button>
      </Box>
      <Box sx={{ flex: 1, minHeight: 300 }}>
        <DataGrid 
          rows={filtered} 
          columns={columns} 
          pageSizeOptions={[10, 25, 50]} 
          disableRowSelectionOnClick 
          rowHeight={44}
          columnHeaderHeight={40}
          density='compact'
          sx={{ 
            border: 'none',
            '& .MuiDataGrid-cell': { 
              display: 'flex', 
              alignItems: 'center',
              py: 0.5
            },
            '& .MuiDataGrid-columnHeaders': {
              bgcolor: 'action.hover',
              borderRadius: 1
            }
          }} 
        />
      </Box>
      <AssignmentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} roles={roles} users={availableUsers} onSave={onRefresh} t={t} />
      <EditAssignmentDialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} assignmentGroup={toEdit} roles={roles} onSave={onRefresh} t={t} />
      <DeleteDialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title={t('rbacPage.revokeAssignments')}
        message={t('rbacPage.revokeRoleFrom', { role: toDelete?.role?.name, user: toDelete?.user?.email }) + (toDelete?.scope_targets?.length > 1 ? ` (${t('rbacPage.resourcesCount', { count: toDelete.scope_targets.length })})` : '')}
        onConfirm={handleDeleteGroup}
        loading={deleting}
        t={t}
      />
    </Box>
  )
}

// Edit Assignment Dialog avec multi-sélection (travaille sur un groupe d'assignations)
function EditAssignmentDialog({ open, onClose, assignmentGroup, roles, onSave, t }) {
  const [roleId, setRoleId] = useState('')
  const [scopeType, setScopeType] = useState('global')
  const [selectedTargets, setSelectedTargets] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [searchFilter, setSearchFilter] = useState('')
  
  // Inventory data
  const [inventory, setInventory] = useState<any>(null)
  const [loadingInventory, setLoadingInventory] = useState(false)

  // Charger l'inventaire quand le dialog s'ouvre
  useEffect(() => {
    if (open && !inventory) {
      setLoadingInventory(true)
      fetch('/api/v1/inventory')
        .then(res => res.json())
        .then(data => setInventory(data.data))
        .catch(() => setError(t('errors.loadingError')))
        .finally(() => setLoadingInventory(false))
    }
  }, [open, inventory])

  // Initialiser les valeurs quand le groupe change
  useEffect(() => {
    if (assignmentGroup && open) {
      setRoleId(assignmentGroup.role.id)
      setScopeType(assignmentGroup.scope_type)
      setSelectedTargets(assignmentGroup.scope_targets || [])
      setSearchFilter('')
      setError('')
    }
  }, [assignmentGroup, open])

  // Construire les options selon le scope type
  const scopeOptions = useMemo(() => {
    if (!inventory?.clusters) return []

    switch (scopeType) {
      case 'connection':
        return inventory.clusters.map((c: any) => ({
          id: c.id,
          label: c.name,
          sublabel: t('rbacPage.nodeCount', { count: c.nodes?.length || 0 }),
          icon: 'ri-server-line',
          status: c.status
        }))

      case 'node': {
        const nodes: any[] = []

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            nodes.push({
              id: `${c.id}:${n.node}`,
              label: n.node,
              sublabel: c.name,
              icon: 'ri-computer-line',
              status: n.status,
              cluster: c.name
            })
          })
        })

        return nodes
      }

      case 'vm': {
        const vms: any[] = []

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            n.guests?.forEach((g: any) => {
              vms.push({
                id: `${c.id}:${n.node}:${g.type}:${g.vmid}`,
                label: g.name || `${g.type}/${g.vmid}`,
                sublabel: `${g.type.toUpperCase()} ${g.vmid} • ${n.node} • ${c.name}`,
                icon: g.type === 'lxc' ? 'ri-box-3-line' : 'ri-instance-line',
                status: g.status,
                vmid: g.vmid,
                type: g.type,
                node: n.node,
                cluster: c.name
              })
            })
          })
        })

        return vms
      }

      case 'tag': {
        const tagMap = new Map<string, number>()

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            n.guests?.forEach((g: any) => {
              const tags = typeof g.tags === 'string'
                ? g.tags.split(/[;,]/).map((t: string) => t.trim()).filter(Boolean)
                : []
              tags.forEach((tag: string) => {
                tagMap.set(tag, (tagMap.get(tag) || 0) + 1)
              })
            })
          })
        })

        return Array.from(tagMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([tag, count]) => ({
            id: tag,
            label: tag,
            sublabel: t('rbacPage.tagUsedByVms', { count }),
            icon: 'ri-price-tag-3-line'
          }))
      }

      case 'pool': {
        const poolMap = new Map<string, number>()

        inventory.clusters.forEach((c: any) => {
          c.nodes?.forEach((n: any) => {
            n.guests?.forEach((g: any) => {
              if (g.pool) {
                poolMap.set(g.pool, (poolMap.get(g.pool) || 0) + 1)
              }
            })
          })
        })

        return Array.from(poolMap.entries())
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([pool, count]) => ({
            id: pool,
            label: pool,
            sublabel: t('rbacPage.poolContainsVms', { count }),
            icon: 'ri-folder-shared-line'
          }))
      }

      default:
        return []
    }
  }, [inventory, scopeType])

  // Toggle sélection d'un élément
  const toggleTarget = (id: string) => {
    setSelectedTargets(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  // Sélectionner/Désélectionner tout
  const toggleAll = () => {
    if (selectedTargets.length === scopeOptions.length) {
      setSelectedTargets([])
    } else {
      setSelectedTargets(scopeOptions.map((o: any) => o.id))
    }
  }

  // Filtrer les options selon la recherche
  const filteredOptions = useMemo(() => {
    if (!searchFilter.trim()) return scopeOptions
    const search = searchFilter.toLowerCase()

    
return scopeOptions.filter((o: any) => 
      o.label.toLowerCase().includes(search) || 
      o.sublabel?.toLowerCase().includes(search) ||
      o.id.toLowerCase().includes(search)
    )
  }, [scopeOptions, searchFilter])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'online': case 'running': return 'success'
      case 'offline': case 'stopped': return 'error'
      case 'degraded': case 'paused': return 'warning'
      default: return 'default'
    }
  }

  const handleSave = async () => {
    if (!roleId) {
      setError(t('common.error'))

return
    }

    if (scopeType !== 'global' && selectedTargets.length === 0) {
      setError(t('common.error'))

return
    }

    setSaving(true)
    setError('')

    try {
      const originalTargets = new Set<string>(assignmentGroup.scope_targets || [])
      const newTargets = scopeType === 'global' ? new Set<string>() : new Set(selectedTargets)
      
      // Calculer les différences
      const toAdd = [...newTargets].filter(t => !originalTargets.has(t))
      const toRemove = [...originalTargets].filter(t => !newTargets.has(t))
      const toKeep = [...originalTargets].filter(t => newTargets.has(t))
      
      let errors: string[] = []

      // Supprimer les assignations qui ne sont plus sélectionnées
      for (const target of toRemove) {
        const assignment = assignmentGroup.assignments.find((a: any) => a.scope_target === target)

        if (assignment) {
          const res = await fetch(`/api/v1/rbac/assignments/${assignment.id}`, { method: 'DELETE' })

          if (!res.ok) {
            errors.push(`${t('errors.deleteError')} ${target}`)
          }
        }
      }

      // Mettre à jour le rôle des assignations conservées si changé
      if (roleId !== assignmentGroup.role.id) {
        for (const target of toKeep) {
          const assignment = assignmentGroup.assignments.find((a: any) => a.scope_target === target)

          if (assignment) {
            const res = await fetch(`/api/v1/rbac/assignments/${assignment.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role_id: roleId })
            })

            if (!res.ok) {
              errors.push(`${t('errors.updateError')} ${target}`)
            }
          }
        }
      }

      // Créer les nouvelles assignations
      for (const target of toAdd) {
        const res = await fetch('/api/v1/rbac/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: assignmentGroup.user.id,
            role_id: roleId,
            scope_type: scopeType,
            scope_target: target
          })
        })

        if (!res.ok) {
          const data = await res.json()

          errors.push(data.error || `${t('errors.addError')} ${target}`)
        }
      }

      // Cas spécial: passage à global
      if (scopeType === 'global' && assignmentGroup.scope_type !== 'global') {
        // Supprimer toutes les anciennes assignations et créer une globale
        for (const assignment of assignmentGroup.assignments) {
          await fetch(`/api/v1/rbac/assignments/${assignment.id}`, { method: 'DELETE' })
        }

        const res = await fetch('/api/v1/rbac/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: assignmentGroup.user.id,
            role_id: roleId,
            scope_type: 'global',
            scope_target: null
          })
        })

        if (!res.ok) {
          const data = await res.json()

          errors.push(data.error || t('errors.addError'))
        }
      }

      // Cas spécial: passage de global à spécifique
      if (scopeType !== 'global' && assignmentGroup.scope_type === 'global') {
        // Supprimer l'assignation globale
        for (const assignment of assignmentGroup.assignments) {
          await fetch(`/api/v1/rbac/assignments/${assignment.id}`, { method: 'DELETE' })
        }

        // Les nouvelles ont déjà été créées dans toAdd
      }

      onSave()

      if (errors.length === 0) {
        onClose()
      } else {
        setError(`${errors.length} ${t('common.error')}`)
      }
    } catch {
      setError(t('errors.connectionError'))
    } finally {
      setSaving(false)
    }
  }

  if (!assignmentGroup) return null

  return (
    <Dialog open={open} onClose={onClose} maxWidth='sm' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <i className='ri-edit-line' />
        {t('common.edit')}
      </DialogTitle>
      <DialogContent>
        {error && <Alert severity='error' sx={{ mb: 2 }}>{error}</Alert>}

        <TextField fullWidth label={t('navigation.users')} value={assignmentGroup?.user?.email || ''} disabled sx={{ mt: 2 }} />

        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>{t('rbac.title')}</InputLabel>
          <Select value={roleId} label={t('rbac.title')} onChange={e => setRoleId(e.target.value)}>
            {roles.map((r: any) => (
              <MenuItem key={r.id} value={r.id}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: r.color }} />
                  {r.name}
                  {r.is_system && <Chip label={t('rbacPage.systemRole')} size='small' sx={{ height: 18, fontSize: '0.7rem' }} />}
                </Box>
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>{t('rbacPage.scope')}</InputLabel>
          <Select
            value={scopeType}
            label={t('rbacPage.scope')}
            onChange={e => { 
              setScopeType(e.target.value)
              setSelectedTargets([])
            }}
          >
            <MenuItem value='global'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-global-line' style={{ color: '#6366f1' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.globalScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.accessAllResources')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='connection'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-server-line' style={{ color: '#8b5cf6' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.clusterConnection')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToClusters')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='node'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-computer-line' style={{ color: '#f59e0b' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.nodeScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToNodes')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='vm'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-instance-line' style={{ color: '#10b981' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.vmContainer')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToVmsCts')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='tag'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-price-tag-3-line' style={{ color: '#ec4899' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.tagScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToTag')}</Typography>
                </Box>
              </Box>
            </MenuItem>
            <MenuItem value='pool'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-folder-shared-line' style={{ color: '#14b8a6' }} />
                <Box>
                  <Typography variant='body2'>{t('rbacPage.poolScope')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.limitedToPool')}</Typography>
                </Box>
              </Box>
            </MenuItem>
          </Select>
        </FormControl>

        {/* Sélection des ressources (multi-sélection) */}
        {scopeType !== 'global' && (
          <Box sx={{ mt: 2 }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
              <Typography variant='subtitle2'>
                {t('rbacPage.selectResources')} ({selectedTargets.length}/{scopeOptions.length})
              </Typography>
              <Button size='small' onClick={toggleAll}>
                {selectedTargets.length === scopeOptions.length ? (t('rbacPage.deselectAll')) : (t('rbacPage.selectAll'))}
              </Button>
            </Box>

            {/* Champ de recherche */}
            <TextField
              fullWidth
              size='small'
              placeholder={t('rbacPage.searchResource')}
              value={searchFilter}
              onChange={e => setSearchFilter(e.target.value)}
              sx={{ mb: 1 }}
              InputProps={{
                startAdornment: <i className='ri-search-line' style={{ marginRight: 8, opacity: 0.5 }} />
              }}
            />
            
            {loadingInventory ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
                <Typography variant='body2' sx={{ opacity: 0.6 }}>{t('rbacPage.loadingInventory')}</Typography>
              </Box>
            ) : scopeOptions.length === 0 ? (
              <Alert severity='warning'>{t('rbacPage.noResourceAvailable')}</Alert>
            ) : filteredOptions.length === 0 ? (
              <Alert severity='info'>{t('rbacPage.noResultsFor', { query: searchFilter })}</Alert>
            ) : (
              <Paper variant='outlined' sx={{ maxHeight: 250, overflow: 'auto' }}>
                <List dense disablePadding>
                  {filteredOptions.map((option: any) => (
                    <ListItem 
                      key={option.id} 
                      sx={{ 
                        borderBottom: '1px solid', 
                        borderColor: 'divider',
                        cursor: 'pointer',
                        '&:hover': { bgcolor: 'action.hover' }
                      }}
                      onClick={() => toggleTarget(option.id)}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox 
                          checked={selectedTargets.includes(option.id)} 
                          size='small'
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleTarget(option.id)}
                        />
                      </ListItemIcon>
                      <ListItemIcon sx={{ minWidth: 32 }}>
                        <i className={option.icon} style={{ fontSize: 18, opacity: 0.7 }} />
                      </ListItemIcon>
                      <ListItemText
                        primary={
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant='body2' sx={{ fontWeight: 500 }}>{option.label}</Typography>
                            {option.status && (
                              <Chip
                                label={option.status}
                                size='small'
                                color={getStatusColor(option.status) as any}
                                sx={{ height: 18, fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>
                        }
                        secondary={option.sublabel}
                      />
                    </ListItem>
                  ))}
                </List>
              </Paper>
            )}
          </Box>
        )}

        {scopeType === 'global' && (
          <Alert severity='info' sx={{ mt: 2 }}>
            <span dangerouslySetInnerHTML={{ __html: t('rbacPage.userHasRoleOnAll') }} />
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={saving || !roleId || (scopeType !== 'global' && selectedTargets.length === 0)}
        >
          {saving ? (t('common.saving')) : (t('common.save'))}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

// Main Page
export default function RBACPage() {
  const { data: session } = useSession()
  const t = useTranslations()
  const [tab, setTab] = useState(0)
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [categories, setCategories] = useState([])
  const [assignments, setAssignments] = useState([])
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const { setPageInfo } = usePageTitle()

  useEffect(() => {
    setPageInfo(t('rbac.title'), t('navigation.rbacRoles'), 'ri-lock-2-line')

return () => setPageInfo('', '', '')
  }, [setPageInfo, t])

  const loadData = useCallback(async () => {
    setLoading(true); setError('')

    try {
      const [rolesRes, permsRes, assignRes, usersRes] = await Promise.all([
        fetch('/api/v1/rbac/roles'), fetch('/api/v1/rbac/permissions'),
        fetch('/api/v1/rbac/assignments'), fetch('/api/v1/users')
      ])

      const [rolesData, permsData, assignData, usersData] = await Promise.all([rolesRes.json(), permsRes.json(), assignRes.json(), usersRes.json()])

      if (rolesRes.ok) setRoles(rolesData.data || [])
      if (permsRes.ok) { setPermissions(permsData.data || []); setCategories(permsData.categories || []) }
      if (assignRes.ok) setAssignments(assignData.data || [])
      if (usersRes.ok) setUsers(usersData.data || [])
    } catch (e) { setError(t('errors.loadingError')) } finally { setLoading(false) }
  }, [t])

  useEffect(() => { loadData() }, [loadData])

  return (
    <EnterpriseGuard requiredFeature={Features.RBAC} featureName="RBAC">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {error && <Alert severity='error'>{error}</Alert>}
        <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-shield-keyhole-line' />{t('rbacPage.roles')}<Chip label={roles.length} size='small' sx={{ height: 18 }} /></Box>} />
            <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-user-settings-line' />{t('rbacPage.assignments')}<Chip label={assignments.length} size='small' sx={{ height: 18 }} /></Box>} />
            <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-key-line' />{t('rbacPage.permissionsTab')}<Chip label={permissions.length} size='small' sx={{ height: 18 }} /></Box>} />
          </Tabs>
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {loading ? <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, p: 2 }}><CardsSkeleton count={3} columns={3} /><TableSkeleton rows={4} columns={5} /></Box> : (
            <>
              {tab === 0 && <RolesTab roles={roles} categories={categories} onRefresh={loadData} t={t} />}
              {tab === 1 && <AssignmentsTab assignments={assignments} roles={roles} users={users} onRefresh={loadData} t={t} />}
              {tab === 2 && (
                <Box>
                  <Typography variant='body2' sx={{ mb: 2, opacity: 0.6 }}>{t('rbacPage.permissionsAvailable', { count: permissions.length, categories: categories.length })}</Typography>
                  {categories.map(cat => (
                    <Paper key={cat.id} variant='outlined' sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.5, bgcolor: 'action.hover' }}>
                        <i className={catIcons[cat.id] || 'ri-folder-line'} />
                        <Typography variant='subtitle2'>{t(`rbac.categories.${cat.id}`, { defaultValue: cat.label })}</Typography>
                        <Chip label={cat.permissions.length} size='small' sx={{ height: 18 }} />
                      </Box>
                      <Divider />
                      <Box sx={{ p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
                        {cat.permissions.map(p => (
                          <Tooltip key={p.id} title={t(`rbac.permDesc.${p.id}`, { defaultValue: p.description })}>
                            <Chip label={p.name} size='small' variant='outlined' color={p.is_dangerous ? 'warning' : 'default'} icon={p.is_dangerous ? <i className='ri-alert-line' style={{ fontSize: 14 }} /> : undefined} />
                          </Tooltip>
                        ))}
                      </Box>
                    </Paper>
                  ))}
                </Box>
              )}
            </>
          )}
        </CardContent>
        </Card>
      </Box>
    </EnterpriseGuard>
  )
}