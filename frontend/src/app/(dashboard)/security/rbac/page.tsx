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
import { Features, useLicense } from '@/contexts/LicenseContext'
import { useRBAC } from '@/contexts/RBACContext'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'
import { WIDGET_REGISTRY, WIDGET_CATEGORIES } from '@/components/dashboard/widgetRegistry'
import RoleDefaultScopeEditor from './RoleDefaultScopeEditor'
import { formatScopeTarget } from './scope-options'

// Types
interface Permission { id: string; name: string; category: string; description: string; is_dangerous: boolean }
interface PermissionCategory { id: string; label: string; permissions: Permission[] }
interface Role { id: string; name: string; description: string | null; is_system: boolean; color: string; permissions: Permission[]; user_count: number; default_scopes?: { scopeType: string; scopeTarget: string }[] | null }
interface User { id: string; email: string; name: string | null }
interface Assignment { id: string; user: User; role: { id: string; name: string; color: string }; scope_type: string; scope_target: string | null; granted_at: string; granted_by_email: string | null }

// Constants
const scopeIcons = { global: 'ri-global-line', connection: 'ri-server-line', node: 'ri-computer-line', vm: 'ri-instance-line', tag: 'ri-price-tag-3-line', pool: 'ri-folder-shared-line', inherit: 'ri-links-line' }
const catIcons = { vm: 'ri-instance-line', storage: 'ri-hard-drive-3-line', node: 'ri-computer-line', connection: 'ri-server-line', backup: 'ri-archive-line', admin: 'ri-shield-user-line' }

// Roles that must NEVER be assigned in a non-default tenant. Two reasons
// stack here:
//  - Protected wildcard roles (super_admin / provider_admin) only make sense
//    on the provider tenant: super_admin is cross-tenant by design so binding
//    it under tenant-1 is misleading, and provider_admin's wildcard would let
//    a tenant operator escalate inside their own tenant.
//  - Legacy "global" roles (operator / vm_admin / viewer / vm_user) grant
//    automation.view which unlocks DRS / Site Recovery / Network Security /
//    Resources — pages Tenant Admin explicitly excludes.
//
// Kept in sync with PROTECTED_ROLE_IDS + PROVIDER_ONLY_ROLE_IDS in
// src/lib/rbac/index.ts (backend mirror).
const TENANT_FORBIDDEN_ROLE_IDS = new Set([
  'role_super_admin',
  'role_provider_admin',
  'role_operator',
  'role_vm_admin',
  'role_viewer',
  'role_vm_user',
])

const isAssignableToTenant = (role: any, tenantId: string) =>
  tenantId === 'default' || !TENANT_FORBIDDEN_ROLE_IDS.has(role?.id)

// Scope labels function
const getScopeLabels = (t: any) => ({
  global: t('rbac.scopes.global'),
  connection: t('rbac.scopes.connection'),
  node: t('rbac.scopes.node'),
  vm: t('rbac.scopes.vmct'),
  tag: t('rbac.scopes.tag'),
  pool: t('rbac.scopes.pool'),
  inherit: t('rbac.scopes.inherit')
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
  const [hiddenWidgets, setHiddenWidgets] = useState(new Set())
  const [defaultScopes, setDefaultScopes] = useState<{ scopeType: string; scopeTarget: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(new Set())
  const [widgetExpanded, setWidgetExpanded] = useState(new Set())
  const isEdit = !!role

  useEffect(() => {
    if (role) {
      setName(role.name)
      setDescription(role.description || '')
      setColor(role.color || '#6366f1')
      setSelectedPerms(new Set(role.permissions.map(p => p.id)))
      setHiddenWidgets(new Set(role.widget_overrides?.hidden || []))
      setDefaultScopes(Array.isArray(role.default_scopes) ? role.default_scopes : [])
    } else {
      setName(''); setDescription(''); setColor('#6366f1'); setSelectedPerms(new Set()); setHiddenWidgets(new Set()); setDefaultScopes([])
    }

    setExpanded(new Set(categories.map(c => c.id)))
    setWidgetExpanded(new Set())
    setError('')
  }, [role, open, categories])

  const toggleWidget = (widgetType) => setHiddenWidgets(p => { const n = new Set(p);

 n.has(widgetType) ? n.delete(widgetType) : n.add(widgetType);

return n })

  const toggleWidgetCat = (catId) => {
    const cats = WIDGET_REGISTRY ? Object.values(WIDGET_REGISTRY).filter(w => w.category === catId && !w.isSection) : []

    if (cats.length === 0) return
    const types = cats.map(w => w.type)
    const allHidden = types.every(t => hiddenWidgets.has(t))

    setHiddenWidgets(p => { const n = new Set(p);

 types.forEach(t => allHidden ? n.delete(t) : n.add(t));

return n })
  }

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
    if (!role?.is_system && !name.trim()) { setError(t('common.error'));

return }

    setLoading(true); setError('')

    // System roles only accept widget_overrides edits — the backend rejects
    // any other field change. For custom roles we send the full payload.
    const widgetOverrides = hiddenWidgets.size > 0 ? { hidden: Array.from(hiddenWidgets) } : null
    const payload = role?.is_system
      ? { widget_overrides: widgetOverrides }
      : { name: name.trim(), description: description.trim() || null, color, permissions: Array.from(selectedPerms), widget_overrides: widgetOverrides, default_scopes: defaultScopes }

    try {
      const res = await fetch(isEdit ? `/api/v1/rbac/roles/${role.id}` : '/api/v1/rbac/roles', {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
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

        {/* Role default scope (issue #383). Custom roles only — system roles
            bypass scope resolution via their super-admin/protected shortcuts. */}
        {!role?.is_system && (
          <Box sx={{ mt: 3 }}>
            <Typography variant='subtitle2' sx={{ mb: 0.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
              <i className='ri-links-line' style={{ fontSize: '1.1rem' }} />
              {t('rbacPage.defaultScope.title')}
              {defaultScopes.length > 0 && (
                <Chip size='small' label={defaultScopes.length} color='primary' variant='outlined' />
              )}
            </Typography>
            <RoleDefaultScopeEditor value={defaultScopes} onChange={setDefaultScopes} t={t} />
          </Box>
        )}

        {/* Widget visibility (denylist) — admins tick widgets to hide for users
            carrying this role. Always editable, including on system roles. */}
        <Box sx={{ mt: 3 }}>
          <Typography variant='subtitle2' sx={{ mb: 0.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}>
            <i className='ri-layout-grid-line' style={{ fontSize: '1.1rem' }} />
            {t('rbacPage.widgetVisibility.title')}
            {hiddenWidgets.size > 0 && (
              <Chip size='small' label={t('rbacPage.widgetVisibility.hiddenCount', { count: hiddenWidgets.size })} color='warning' variant='outlined' />
            )}
          </Typography>
          <Typography variant='caption' sx={{ display: 'block', mb: 1, opacity: 0.7 }}>
            {t('rbacPage.widgetVisibility.desc')}
          </Typography>
          <Paper variant='outlined' sx={{ maxHeight: 280, overflow: 'auto' }}>
            {WIDGET_CATEGORIES.map(wcat => {
              const widgets = Object.values(WIDGET_REGISTRY).filter(w => w.category === wcat.id && !w.isSection)

              if (widgets.length === 0) return null
              const types = widgets.map(w => w.type)
              const hiddenInCat = types.filter(t2 => hiddenWidgets.has(t2)).length
              const isExp = widgetExpanded.has(wcat.id)

              return (
                <Box key={wcat.id}>
                  <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1, bgcolor: 'action.hover', cursor: 'pointer' }} onClick={() => setWidgetExpanded(p => { const n = new Set(p);

 n.has(wcat.id) ? n.delete(wcat.id) : n.add(wcat.id);

return n })}>
                    <IconButton size='small'><i className={isExp ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} /></IconButton>
                    <i className={wcat.icon} style={{ margin: '0 8px' }} />
                    <Typography variant='subtitle2' sx={{ flex: 1 }}>{t(`dashboard.categories.${wcat.id}`, { defaultValue: wcat.name })}</Typography>
                    <Chip size='small' label={`${hiddenInCat}/${widgets.length}`} color={hiddenInCat > 0 ? 'warning' : 'default'} variant='outlined' sx={{ mr: 1 }} />
                    <Checkbox checked={hiddenInCat === widgets.length} indeterminate={hiddenInCat > 0 && hiddenInCat < widgets.length} onChange={() => toggleWidgetCat(wcat.id)} onClick={e => e.stopPropagation()} size='small' />
                  </Box>
                  <Collapse in={isExp}>
                    <List dense disablePadding>
                      {widgets.map(w => {
                        const widgetNameKey = w.type.replace(/-([a-z])/g, (m, c) => c.toUpperCase())
                        const widgetName = t(`dashboard.widgetNames.${widgetNameKey}`, { defaultValue: w.name })
                        const widgetDesc = t(`dashboard.widgetDescs.${widgetNameKey}`, { defaultValue: w.description })

                        return (
                          <ListItem key={w.type} sx={{ pl: 6, borderBottom: '1px solid', borderColor: 'divider' }}>
                            <ListItemIcon sx={{ minWidth: 32 }}><i className={w.icon} style={{ fontSize: '1.1rem', opacity: 0.7 }} /></ListItemIcon>
                            <ListItemText primary={widgetName} secondary={widgetDesc} />
                            <ListItemSecondaryAction><Checkbox checked={hiddenWidgets.has(w.type)} onChange={() => toggleWidget(w.type)} size='small' /></ListItemSecondaryAction>
                          </ListItem>
                        )
                      })}
                    </List>
                  </Collapse>
                </Box>
              )
            })}
          </Paper>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant='contained' onClick={handleSave} disabled={loading}>{loading ? t('common.saving') : isEdit ? t('common.update') : t('common.create')}</Button>
      </DialogActions>
    </Dialog>
  )
}

// Assignment Dialog avec sélection dynamique des ressources
function AssignmentDialog({ open, onClose, roles, users, assignments = [], tenants = [], enableTenantMgmt = false, currentTenantId = 'default', onSave, t }) {
  const [user, setUser] = useState(null)
  const [roleId, setRoleId] = useState('')
  // Provider view: tenant defaults to the session tenant ('default'), but the
  // operator can pick any enabled tenant — the POST body's tenant_id field is
  // honored only when the session is in the provider tenant (server check).
  const [tenantId, setTenantId] = useState<string>(currentTenantId)
  // Default to "inherit" so a new assignment follows the role's default scope
  // (issue #383). The admin can still pick an explicit override.
  const [scopeType, setScopeType] = useState('inherit')
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
      setTenantId(currentTenantId)
      setScopeType('inherit')
      setSelectedTargets([])
      setSearchFilter('')
      setError('')
    }
  }, [open, currentTenantId])

  // Clear the role when switching to a tenant that forbids it. The Select
  // already hides the option visually, but its state value would still ride
  // along on submit — the backend refuses with a 400, but the UX is
  // confusing because the operator no longer sees the role they "have"
  // selected. Resetting forces a re-pick from the filtered list.
  useEffect(() => {
    if (!roleId) return
    if (tenantId !== 'default' && TENANT_FORBIDDEN_ROLE_IDS.has(roleId)) {
      setRoleId('')
    }
  }, [tenantId, roleId])

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

  // Conflict detection: the backend already rejects duplicates and second
  // roles per tenant, but surfacing them client-side lets the operator fix the
  // selection in one pass instead of clicking through error toasts. Three
  // shapes to detect:
  //  - `existingDifferentRole`: same (user, tenant) already holds another
  //    role_id — backend rule "one role per tenant" would 400 the POST.
  //  - `globalAlreadyExists`: same (user, tenant, role) global row exists.
  //  - `duplicateTargets`: per-target list of (scope_type, scope_target) that
  //    are already granted, so we can grey them out in the multi-select.
  const conflict = useMemo(() => {
    if (!user?.id || !roleId || !tenantId) {
      return { existingDifferentRole: null as any, globalAlreadyExists: false, duplicateTargets: new Set<string>() }
    }
    const userInTenant = assignments.filter((a: any) => a.user.id === user.id && (a.tenant_id || 'default') === tenantId)
    const otherRole = userInTenant.find((a: any) => a.role.id !== roleId)
    const sameRole = userInTenant.filter((a: any) => a.role.id === roleId)
    const dupTargets = new Set<string>()
    let globalDup = false
    for (const a of sameRole) {
      if (a.scope_type === 'global') {
        if (scopeType === 'global') globalDup = true
      } else if (a.scope_type === scopeType && a.scope_target) {
        dupTargets.add(a.scope_target)
      }
    }
    return { existingDifferentRole: otherRole || null, globalAlreadyExists: globalDup, duplicateTargets: dupTargets }
  }, [assignments, user, roleId, tenantId, scopeType])

  // Toggle sélection d'un élément (les cibles déjà assignées sont neutralisées
  // pour ne pas re-soumettre une combinaison que le backend refuserait).
  const toggleTarget = (id: string) => {
    if (conflict.duplicateTargets.has(id)) return
    setSelectedTargets(prev =>
      prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]
    )
  }

  // Sélectionner/Désélectionner tout (ignore les cibles déjà assignées).
  const toggleAll = () => {
    const selectable = scopeOptions.filter((o: any) => !conflict.duplicateTargets.has(o.id))
    if (selectedTargets.length === selectable.length) {
      setSelectedTargets([])
    } else {
      setSelectedTargets(selectable.map((o: any) => o.id))
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

    // global and inherit carry no target — a single assignment is created.
    const scopeHasNoTarget = scopeType === 'global' || scopeType === 'inherit'

    if (!scopeHasNoTarget && selectedTargets.length === 0) {
      setError(t('common.error'))

return
    }

    setSaving(true)
    setError('')

    try {
      const targets = scopeHasNoTarget ? [null] : selectedTargets
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
            scope_target: target,
            // tenant_id is honored server-side only when the caller is in the
            // provider tenant. Sending it from any other context is harmless
            // — the route ignores it and falls back to the session tenant.
            ...(enableTenantMgmt ? { tenant_id: tenantId } : {}),
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

        {/* Tenant (provider view only) — scopes the assignment to a specific
            membership. Required because a user with memberships in multiple
            tenants can hold a different role in each, and the backend stores
            them as separate RbacUserRole rows keyed on tenantId. */}
        {enableTenantMgmt && (
          <FormControl fullWidth sx={{ mt: 2 }}>
            <InputLabel>{t('vdc.tenant')}</InputLabel>
            <Select value={tenantId} label={t('vdc.tenant')} onChange={e => setTenantId(e.target.value)}>
              {tenants.map((tn: any) => (
                <MenuItem key={tn.id} value={tn.id}>
                  <Typography variant='body2'>{tn.name}</Typography>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}

        {/* Sélection rôle (filtré par tenant cible : les rôles "global"
            legacy (operator, vm_admin, viewer, vm_user) ne sortent que sur
            le tenant provider pour éviter d'exposer DRS / Site Recovery /
            Network / Resources à un opérateur tenant). */}
        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>{t('rbac.title')}</InputLabel>
          <Select value={roleId} label={t('rbac.title')} onChange={e => setRoleId(e.target.value)}>
            {roles
              .filter((r: any) => isAssignableToTenant(r, tenantId))
              .map((r: any) => (
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
            <MenuItem value='inherit'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-links-line' style={{ color: '#10b981' }} />
                <Box>
                  <Typography variant='body2'>{t('rbac.scopes.inherit')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.defaultScope.desc')}</Typography>
                </Box>
              </Box>
            </MenuItem>
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

        {/* Conflict notices — surface what the backend would refuse before
            the operator clicks Save, so they can fix the selection in one go
            instead of round-tripping through error toasts. */}
        {user && conflict.existingDifferentRole && (
          <Alert severity='warning' sx={{ mt: 2 }} icon={<i className='ri-error-warning-line' />}>
            {t('rbacPage.userAlreadyHasRole', {
              defaultValue: 'This user already holds the role "{role}" on this tenant. Remove it first or edit the existing assignment.',
              role: conflict.existingDifferentRole.role?.name || conflict.existingDifferentRole.role?.id,
            })}
          </Alert>
        )}
        {user && conflict.globalAlreadyExists && (
          <Alert severity='warning' sx={{ mt: 2 }} icon={<i className='ri-error-warning-line' />}>
            {t('rbacPage.duplicateGlobalAssignment', {
              defaultValue: 'This user already has this role on every resource (global) for this tenant.',
            })}
          </Alert>
        )}

        {/* Sélection des ressources */}
        {scopeType !== 'global' && scopeType !== 'inherit' && (
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
                  {filteredOptions.map((option: any) => {
                    const alreadyAssigned = conflict.duplicateTargets.has(option.id)
                    return (
                    <ListItem
                      key={option.id}
                      sx={{
                        borderBottom: '1px solid',
                        borderColor: 'divider',
                        cursor: alreadyAssigned ? 'not-allowed' : 'pointer',
                        opacity: alreadyAssigned ? 0.45 : 1,
                        '&:hover': { bgcolor: alreadyAssigned ? undefined : 'action.hover' }
                      }}
                      onClick={() => toggleTarget(option.id)}
                    >
                      <ListItemIcon sx={{ minWidth: 36 }}>
                        <Checkbox
                          checked={selectedTargets.includes(option.id)}
                          size='small'
                          disabled={alreadyAssigned}
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
                            {alreadyAssigned && (
                              <Chip
                                label={t('rbacPage.alreadyAssigned', { defaultValue: 'Already assigned' })}
                                size='small'
                                variant='outlined'
                                sx={{ height: 18, fontSize: '0.7rem' }}
                              />
                            )}
                          </Box>
                        }
                        secondary={option.sublabel}
                      />
                    </ListItem>
                  )})}
                </List>
              </Paper>
            )}
          </Box>
        )}

        {scopeType === 'inherit' && (
          <Alert severity='info' sx={{ mt: 2 }} icon={<i className='ri-links-line' />}>
            {t('rbacPage.defaultScope.desc')}
          </Alert>
        )}

        {scopeType === 'global' && (
          <Alert severity='info' sx={{ mt: 2 }}>
            {/* Translation contains <strong>…</strong> as inline rich text.
                next-intl's `t.rich` substitutes the tag with the React node we
                provide — keeps formatting intent without resorting to HTML
                injection. Tenant context: "all resources" really means "every
                resource the tenant's vDC exposes", because the vDC gate denies
                out-of-scope infra downstream of RBAC. */}
            {t.rich(tenantId === 'default' ? 'rbacPage.userHasRoleOnAll' : 'rbacPage.userHasRoleOnAllVdc', {
              strong: (chunks: any) => <strong>{chunks}</strong>,
            })}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={
            saving ||
            !user ||
            !roleId ||
            !!conflict.existingDifferentRole ||
            (scopeType === 'global' && conflict.globalAlreadyExists) ||
            (scopeType !== 'global' && scopeType !== 'inherit' && selectedTargets.length === 0)
          }
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
  // Only super admins may author or mutate roles — the backend enforces the
  // same rule (POST/PATCH/DELETE /api/v1/rbac/roles). Tenant admins get a
  // read-only surface.
  const { isAdmin: isSuperAdmin } = useRBAC()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [selected, setSelected] = useState(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')
  const [connNames, setConnNames] = useState({})

  // Connection id -> name so the default-scope chips show the connection name
  // instead of its opaque id (issue #383). Lighter than the full inventory the
  // dialogs load: the card only needs to resolve connection scopes.
  useEffect(() => {
    let active = true
    fetch('/api/v1/connections?type=pve')
      .then(r => r.json())
      .then(d => {
        if (!active) return
        const map = {}
        for (const c of d?.data ?? []) if (c?.id) map[c.id] = c.name || c.id
        setConnNames(map)
      })
      .catch(() => {})

    return () => { active = false }
  }, [])

  // Map permission id -> its category, so a role's permissions can be
  // summarised by area (e.g. "VM 13") instead of listing individual names.
  const permCat = useMemo(() => {
    const m = {}
    for (const cat of categories || []) for (const p of cat.permissions || []) m[p.id] = cat

    return m
  }, [categories])

  const catCounts = useCallback(role => {
    const counts = new Map()
    for (const p of role.permissions) {
      const cat = permCat[p.id]
      const id = cat?.id ?? p.name.split('.')[0]
      const entry = counts.get(id) || { id, label: cat ? t(`rbac.categories.${cat.id}`, { defaultValue: cat.label }) : id, count: 0 }
      entry.count++
      counts.set(id, entry)
    }

    return Array.from(counts.values()).sort((a, b) => b.count - a.count)
  }, [permCat, t])

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
        {isSuperAdmin && (
          <Button variant='contained' size='small' startIcon={<i className='ri-add-line' />} onClick={() => { setSelected(null); setDialogOpen(true) }}>{t('rbacPage.newRole')}</Button>
        )}
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 2 }}>
        {roles.map(role => (
          <Paper key={role.id} variant='outlined' sx={{ p: 2, overflow: 'hidden', borderLeft: 4, borderLeftColor: role.color, '&:hover': { bgcolor: 'action.hover' } }}>
            {/* Tinted header band carries the role colour from the left accent
                across the whole header (issue #383 polish). */}
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1, mt: -2, mx: -2, mb: 0, px: 2, py: 1.5, bgcolor: alpha(role.color, 0.08), borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ minWidth: 0 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                  <Typography variant='subtitle1' noWrap sx={{ fontWeight: 600 }}>{role.is_system ? t(`rbac.roles.${role.id}`, { defaultValue: role.name }) : role.name}</Typography>
                  {role.is_system && <Chip label={t('rbacPage.systemRole')} size='small' variant='outlined' sx={{ height: 20, fontSize: '0.7rem', flexShrink: 0 }} />}
                </Box>
                {/* Always reserve a 2-line (clamped) description block so every
                    card header has the same height, with or without a description. */}
                <Typography
                  variant='body2'
                  sx={{ opacity: 0.6, mt: 0.25, minHeight: 40, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                >
                  {role.is_system ? t(`rbac.roleDesc.${role.id}`, { defaultValue: role.description || '' }) : (role.description || '')}
                </Typography>
              </Box>
              {isSuperAdmin && (
                <Box>
                  <Tooltip title={role.is_system ? t('common.view') : t('common.edit')}><IconButton size='small' onClick={() => { setSelected(role); setDialogOpen(true) }}><i className={role.is_system ? 'ri-eye-line' : 'ri-edit-line'} /></IconButton></Tooltip>
                  {!role.is_system && <Tooltip title={t('common.delete')}><IconButton size='small' color='error' onClick={() => { setToDelete(role); setDeleteOpen(true) }}><i className='ri-delete-bin-line' /></IconButton></Tooltip>}
                </Box>
              )}
            </Box>
            {/* Meta line: counts only, no individual permission names. */}
            <Typography variant='caption' sx={{ display: 'block', opacity: 0.6, mt: 1.5 }}>
              {role.permissions.length} {t('rbacPage.permissions')} &nbsp;·&nbsp; {t('rbacPage.userCount', { count: role.user_count })}
            </Typography>

            {/* Permissions summarised by area (issue #383): "VM 13", "Connection 1". */}
            {role.permissions.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Typography variant='overline' sx={{ display: 'block', opacity: 0.5, fontSize: '0.65rem', letterSpacing: '0.08em', lineHeight: 1.6 }}>
                  {t('rbacPage.permissions')}
                </Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                  {catCounts(role).map(c => (
                    <Chip
                      key={c.id}
                      size='small'
                      variant='outlined'
                      icon={<i className={catIcons[c.id] || 'ri-folder-line'} style={{ fontSize: 14 }} />}
                      label={<span>{c.label}&nbsp;<Box component='span' sx={{ fontWeight: 700 }}>{c.count}</Box></span>}
                      sx={{ height: 22, fontSize: '0.72rem' }}
                    />
                  ))}
                </Box>
              </Box>
            )}

            {/* Default scope summary (issue #383): inheriting assignments follow this. */}
            {Array.isArray(role.default_scopes) && role.default_scopes.length > 0 && (
              <Box sx={{ mt: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <i className='ri-links-line' style={{ fontSize: 14, color: '#10b981' }} />
                  <Typography variant='overline' sx={{ opacity: 0.5, fontSize: '0.65rem', letterSpacing: '0.08em', lineHeight: 1.6 }}>
                    {t('rbacPage.defaultScope.title')}
                  </Typography>
                </Box>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.25 }}>
                  {role.default_scopes.slice(0, 4).map(s => (
                    <Chip
                      key={`${s.scopeType}:${s.scopeTarget}`}
                      size='small'
                      color='primary'
                      variant='outlined'
                      icon={<i className={scopeIcons[s.scopeType] || 'ri-price-tag-3-line'} style={{ fontSize: 14 }} />}
                      label={formatScopeTarget(connNames, s.scopeType, s.scopeTarget)}
                      sx={{ height: 22, fontSize: '0.72rem' }}
                    />
                  ))}
                  {role.default_scopes.length > 4 && <Chip label={`+${role.default_scopes.length - 4}`} size='small' sx={{ height: 22, fontSize: '0.72rem' }} />}
                </Box>
              </Box>
            )}
          </Paper>
        ))}
      </Box>
      <RoleDialog open={dialogOpen} onClose={() => setDialogOpen(false)} role={selected} categories={categories} onSave={onRefresh} t={t} />
      <DeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} title={t('rbacPage.deleteRole')} message={t('rbacPage.deleteRoleConfirm', { name: toDelete?.name })} onConfirm={handleDelete} loading={deleting} t={t} />
    </Box>
  )
}

// Assignments Tab avec regroupement par utilisateur/rôle/tenant/scope_type
function AssignmentsTab({ assignments, roles, users, tenants = [], enableTenantMgmt = false, currentTenantId = 'default', onRefresh, t }) {
  const dateLocale = getDateLocale(useLocale())
  const { data: session } = useSession()
  const currentUserId = session?.user?.id
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [toEdit, setToEdit] = useState<any>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [toDelete, setToDelete] = useState<any>(null)
  const [deleting, setDeleting] = useState(false)
  const [filter, setFilter] = useState('')

  // Regrouper les assignations par user_id + role_id + tenant_id + scope_type.
  // Including tenant_id in the key keeps per-tenant rows separate in provider
  // view — a user holding tenant_admin on tenant-1 AND tenant_viewer on
  // tenant-2 must show as two rows, not one collapsed entry with mixed targets.
  const groupedAssignments = useMemo(() => {
    const groups = new Map<string, any>()

    assignments.forEach((a: any) => {
      const tenantId = a.tenant_id || 'default'
      const key = `${a.user.id}:${a.role.id}:${tenantId}:${a.scope_type}`

      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          user: a.user,
          role: a.role,
          tenant_id: tenantId,
          tenant_name: a.tenant_name || null,
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
    const f = filter.toLowerCase()

return groupedAssignments.filter(a =>
      a.user.email.toLowerCase().includes(f) ||
      a.user.name?.toLowerCase().includes(f) ||
      (enableTenantMgmt && a.tenant_name?.toLowerCase().includes(f))
    )
  }, [groupedAssignments, filter, enableTenantMgmt])

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
    // Tenant column (Enterprise + provider view only). Mirrors the column
    // added to /security/users so the same operator sees the same per-tenant
    // breakdown across the two pages without losing the row-per-tenant grain.
    ...(enableTenantMgmt ? [{
      field: 'tenant',
      headerName: t('vdc.tenant'),
      width: 160,
      sortable: false,
      renderCell: (p: any) => {
        const name = p.row.tenant_name || p.row.tenant_id
        const isProviderTenant = p.row.tenant_id === 'default'
        return (
          <Chip
            size='small'
            label={name}
            color={isProviderTenant ? 'primary' : 'default'}
            variant={isProviderTenant ? 'filled' : 'outlined'}
            sx={{ height: 22, fontSize: '0.75rem' }}
          />
        )
      },
    }] : []),
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
    { field: 'actions', headerName: '', width: 80, sortable: false, renderCell: (p: any) => {
      // Hide edit/delete for your own assignment — the backend refuses
      // self-modification (see /rbac/assignments routes).
      if (p.row.user.id === currentUserId) return null
      return (
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
      )
    }}
  ], [t, scopeLabels, currentUserId, enableTenantMgmt])

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
      <AssignmentDialog open={dialogOpen} onClose={() => setDialogOpen(false)} roles={roles} users={availableUsers} assignments={assignments} tenants={tenants} enableTenantMgmt={enableTenantMgmt} currentTenantId={currentTenantId} onSave={onRefresh} t={t} />
      <EditAssignmentDialog open={editDialogOpen} onClose={() => setEditDialogOpen(false)} assignmentGroup={toEdit} roles={roles} enableTenantMgmt={enableTenantMgmt} onSave={onRefresh} t={t} />
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
function EditAssignmentDialog({ open, onClose, assignmentGroup, roles, enableTenantMgmt = false, onSave, t }) {
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

    // global and inherit carry no target (issue #383); only truly scoped types
    // require a selection.
    const noTarget = scopeType === 'global' || scopeType === 'inherit'
    const wasNoTarget = assignmentGroup.scope_type === 'global' || assignmentGroup.scope_type === 'inherit'

    if (!noTarget && selectedTargets.length === 0) {
      setError(t('common.error'))

return
    }

    setSaving(true)
    setError('')

    try {
      const originalTargets = new Set<string>(assignmentGroup.scope_targets || [])
      const newTargets = noTarget ? new Set<string>() : new Set(selectedTargets)
      
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
        // No-target scope (global/inherit), unchanged type: update the single
        // assignment directly (no targets to iterate).
        if (noTarget && assignmentGroup.scope_type === scopeType) {
          for (const assignment of assignmentGroup.assignments) {
            const res = await fetch(`/api/v1/rbac/assignments/${assignment.id}`, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role_id: roleId })
            })

            if (!res.ok) {
              errors.push(t('errors.updateError'))
            }
          }
        }

        // Scoped: update assignments whose targets are kept
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

      // Créer les nouvelles assignations. tenant_id is forwarded in provider
      // view so the re-created rows land in the same tenant as the assignment
      // group being edited — without it the POST defaults to the session
      // tenant and the operator would silently move a tenant-1 assignment to
      // `default` while editing it.
      const tenantPayload = enableTenantMgmt && assignmentGroup?.tenant_id
        ? { tenant_id: assignmentGroup.tenant_id }
        : {}

      for (const target of toAdd) {
        const res = await fetch('/api/v1/rbac/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: assignmentGroup.user.id,
            role_id: roleId,
            scope_type: scopeType,
            scope_target: target,
            ...tenantPayload,
          })
        })

        if (!res.ok) {
          const data = await res.json()

          errors.push(data.error || `${t('errors.addError')} ${target}`)
        }
      }

      // Cas spécial: passage vers un scope sans cible (global ou inherit) depuis
      // un scope différent. Supprime tout et crée une seule assignation.
      if (noTarget && assignmentGroup.scope_type !== scopeType) {
        for (const assignment of assignmentGroup.assignments) {
          await fetch(`/api/v1/rbac/assignments/${assignment.id}`, { method: 'DELETE' })
        }

        const res = await fetch('/api/v1/rbac/assignments', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            user_id: assignmentGroup.user.id,
            role_id: roleId,
            scope_type: scopeType,
            scope_target: null,
            ...tenantPayload,
          })
        })

        if (!res.ok) {
          const data = await res.json()

          errors.push(data.error || t('errors.addError'))
        }
      }

      // Cas spécial: passage d'un scope sans cible vers un scope spécifique
      if (!noTarget && wasNoTarget) {
        // Supprimer l'assignation sans cible
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

        {/* Tenant context (read-only). Showing it explicitly avoids the silent
            mistake of editing the "wrong" row when a user holds the same role
            in multiple tenants. The assignment's tenant cannot change in
            place — moving requires a delete + recreate. */}
        {enableTenantMgmt && assignmentGroup?.tenant_id && (
          <TextField
            fullWidth
            label={t('vdc.tenant')}
            value={assignmentGroup.tenant_name || assignmentGroup.tenant_id}
            disabled
            sx={{ mt: 2 }}
          />
        )}

        <FormControl fullWidth sx={{ mt: 2 }}>
          <InputLabel>{t('rbac.title')}</InputLabel>
          <Select value={roleId} label={t('rbac.title')} onChange={e => setRoleId(e.target.value)}>
            {roles
              .filter((r: any) => isAssignableToTenant(r, assignmentGroup?.tenant_id || 'default'))
              .map((r: any) => (
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
            <MenuItem value='inherit'>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className='ri-links-line' style={{ color: '#10b981' }} />
                <Box>
                  <Typography variant='body2'>{t('rbac.scopes.inherit')}</Typography>
                  <Typography variant='caption' sx={{ opacity: 0.6 }}>{t('rbacPage.defaultScope.desc')}</Typography>
                </Box>
              </Box>
            </MenuItem>
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
        {scopeType !== 'global' && scopeType !== 'inherit' && (
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
            {t.rich(
              (assignmentGroup?.tenant_id || 'default') === 'default'
                ? 'rbacPage.userHasRoleOnAll'
                : 'rbacPage.userHasRoleOnAllVdc',
              { strong: (chunks: any) => <strong>{chunks}</strong> },
            )}
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button
          variant='contained'
          onClick={handleSave}
          disabled={saving || !roleId || (scopeType !== 'global' && scopeType !== 'inherit' && selectedTargets.length === 0)}
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
  const { hasFeature } = useLicense()

  // Cross-tenant management on the Assignments tab mirrors /security/users:
  // visible only when the Enterprise multi-tenancy feature is enabled AND the
  // operator is in the provider tenant. Community editions and tenant-scoped
  // sessions stay on the single-tenant flow.
  const showTenants = hasFeature(Features.MULTI_TENANCY)
  const isInDefaultTenant = (session?.user?.tenantId || 'default') === 'default'
  const enableTenantMgmt = showTenants && isInDefaultTenant
  const currentTenantId = session?.user?.tenantId || 'default'

  const [tab, setTab] = useState(0)
  const [roles, setRoles] = useState([])
  const [permissions, setPermissions] = useState([])
  const [categories, setCategories] = useState([])
  const [assignments, setAssignments] = useState([])
  const [users, setUsers] = useState([])
  const [tenants, setTenants] = useState<Array<{ id: string; name: string }>>([])
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
      // Tenants are only loaded from the provider view — /api/v1/tenants
      // is gated server-side by requireProviderTenant; calling it from any
      // other context would return 403 and noise the console.
      const requests: Promise<Response>[] = [
        fetch('/api/v1/rbac/roles'),
        fetch('/api/v1/rbac/permissions'),
        fetch('/api/v1/rbac/assignments'),
        fetch('/api/v1/users'),
      ]
      if (enableTenantMgmt) requests.push(fetch('/api/v1/tenants'))

      const responses = await Promise.all(requests)
      const [rolesRes, permsRes, assignRes, usersRes, tenantsRes] = responses
      const payloads = await Promise.all(responses.map(r => r.json()))
      const [rolesData, permsData, assignData, usersData, tenantsData] = payloads

      if (rolesRes.ok) setRoles(rolesData.data || [])
      if (permsRes.ok) { setPermissions(permsData.data || []); setCategories(permsData.categories || []) }
      if (assignRes.ok) setAssignments(assignData.data || [])
      if (usersRes.ok) setUsers(usersData.data || [])
      if (enableTenantMgmt && tenantsRes?.ok) setTenants(tenantsData?.data || [])
    } catch (e) { setError(t('errors.loadingError')) } finally { setLoading(false) }
  }, [t, enableTenantMgmt])

  useEffect(() => { loadData() }, [loadData])

  return (
    <EnterpriseGuard requiredFeature={Features.RBAC} featureName="RBAC">
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1 }}>
        {error && <Alert severity='error'>{error}</Alert>}
        <Card variant='outlined' sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-user-settings-line' />{t('rbacPage.assignments')}<Chip label={assignments.length} size='small' sx={{ height: 18 }} /></Box>} />
            <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-shield-keyhole-line' />{t('rbacPage.roles')}<Chip label={roles.length} size='small' sx={{ height: 18 }} /></Box>} />
            <Tab label={<Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}><i className='ri-key-line' />{t('rbacPage.permissionsTab')}<Chip label={permissions.length} size='small' sx={{ height: 18 }} /></Box>} />
          </Tabs>
        <CardContent sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {loading ? <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, p: 2 }}><CardsSkeleton count={3} columns={3} /><TableSkeleton rows={4} columns={5} /></Box> : (
            <>
              {tab === 0 && <AssignmentsTab assignments={assignments} roles={roles} users={users} tenants={tenants} enableTenantMgmt={enableTenantMgmt} currentTenantId={currentTenantId} onRefresh={loadData} t={t} />}
              {tab === 1 && <RolesTab roles={roles} categories={categories} onRefresh={loadData} t={t} />}
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