'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
  Collapse, Dialog, DialogActions, DialogContent, DialogTitle, Divider, FormControlLabel,
  Grid, IconButton, Slider, Switch, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Tooltip, Typography
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'
import { usePVEConnections } from '@/hooks/useConnections'
import {
  useHardeningChecks, useSecurityPolicies,
  useComplianceProfiles,
} from '@/hooks/useHardeningChecks'

// Severity config
const severityColors: Record<string, 'error' | 'warning' | 'info' | 'default'> = {
  critical: 'error',
  high: 'error',
  medium: 'warning',
  low: 'info',
}

const statusColors: Record<string, 'success' | 'error' | 'warning' | 'default'> = {
  pass: 'success',
  fail: 'error',
  warning: 'warning',
  skip: 'default',
}

const categoryIcons: Record<string, string> = {
  cluster: 'ri-server-line',
  node: 'ri-computer-line',
  access: 'ri-shield-user-line',
  vm: 'ri-instance-line',
}

function scoreColor(score: number): string {
  if (score >= 80) return '#22c55e'
  if (score >= 50) return '#f59e0b'
  return '#ef4444'
}

// All 25 check IDs with readable names (for profile editor)
const ALL_CHECKS = [
  { id: 'cluster_fw_enabled', name: 'Cluster firewall enabled', category: 'cluster' },
  { id: 'cluster_policy_in', name: 'Inbound policy = DROP', category: 'cluster' },
  { id: 'cluster_policy_out', name: 'Outbound policy = DROP', category: 'cluster' },
  { id: 'pve_version', name: 'PVE version up to date', category: 'cluster' },
  { id: 'backup_schedule', name: 'Backup jobs configured', category: 'cluster' },
  { id: 'ha_enabled', name: 'High availability configured', category: 'cluster' },
  { id: 'storage_replication', name: 'Storage replication configured', category: 'cluster' },
  { id: 'pool_isolation', name: 'Resource pool isolation', category: 'cluster' },
  { id: 'node_subscriptions', name: 'Valid subscriptions', category: 'node' },
  { id: 'apt_repo_consistency', name: 'APT repository consistency', category: 'node' },
  { id: 'tls_certificates', name: 'Valid TLS certificates', category: 'node' },
  { id: 'node_firewalls', name: 'Node firewalls enabled', category: 'node' },
  { id: 'node_firewall_logging', name: 'Firewall logging enabled', category: 'node' },
  { id: 'root_tfa', name: 'TFA for root@pam', category: 'access' },
  { id: 'admins_tfa', name: 'TFA for admin users', category: 'access' },
  { id: 'no_default_tokens', name: 'No default API tokens', category: 'access' },
  { id: 'least_privilege_users', name: 'Least privilege access', category: 'access' },
  { id: 'vm_firewalls', name: 'Firewall on all VMs', category: 'vm' },
  { id: 'vm_security_groups', name: 'VMs have security groups', category: 'vm' },
  { id: 'vm_vlan_isolation', name: 'VMs use VLAN isolation', category: 'vm' },
  { id: 'vm_guest_agent', name: 'QEMU guest agent enabled', category: 'vm' },
  { id: 'vm_secure_boot', name: 'UEFI boot enabled', category: 'vm' },
  { id: 'vm_no_usb_passthrough', name: 'No USB/PCI passthrough', category: 'vm' },
  { id: 'vm_cpu_isolation', name: 'CPU type isolation', category: 'vm' },
  { id: 'vm_ip_filter', name: 'VM IP filter enabled', category: 'vm' },
]

// ============================================================================
// Hardening Tab
// ============================================================================
function HardeningTab() {
  const t = useTranslations()
  const { data: connectionsData } = usePVEConnections()
  const connections = connectionsData?.data || []
  const { data: profilesData } = useComplianceProfiles()
  const profiles = profilesData?.data || []

  const [selectedConnection, setSelectedConnection] = useState<any>(null)
  const [selectedProfile, setSelectedProfile] = useState<any>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const profileId = selectedProfile?.id || null
  const { data, isLoading, mutate } = useHardeningChecks(selectedConnection?.id, profileId)

  // Auto-select first connection
  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0])
    }
  }, [connections, selectedConnection])

  // Sort checks: fail > warning > pass > skip
  const statusOrder: Record<string, number> = { fail: 0, warning: 1, pass: 2, skip: 3 }
  const checks = [...(data?.checks || [])].sort((a: any, b: any) => (statusOrder[a.status] ?? 4) - (statusOrder[b.status] ?? 4))
  const summary = data?.summary || { score: 0, total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, critical: 0 }
  const score = data?.score ?? 0
  const hasProfile = !!profileId || !!data?.profileId

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Profile options: "All checks" + all profiles
  const profileOptions = [
    { id: null, name: t('compliance.allChecks') },
    ...profiles,
  ]

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Connection selector + profile selector + scan button */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
        <Autocomplete
          options={connections}
          getOptionLabel={(opt: any) => opt.name || opt.id}
          value={selectedConnection}
          onChange={(_, v) => setSelectedConnection(v)}
          renderInput={(params) => (
            <TextField {...params} label={t('compliance.selectConnection')} size="small" />
          )}
          sx={{ minWidth: 280 }}
        />
        <Autocomplete
          options={profileOptions}
          getOptionLabel={(opt: any) => opt.name || ''}
          value={selectedProfile ? profileOptions.find(p => p.id === selectedProfile.id) || profileOptions[0] : profileOptions[0]}
          onChange={(_, v) => setSelectedProfile(v?.id ? v : null)}
          renderInput={(params) => (
            <TextField {...params} label={t('compliance.selectProfile')} size="small" />
          )}
          sx={{ minWidth: 220 }}
        />
        <Button
          variant="contained"
          startIcon={<i className="ri-refresh-line" />}
          onClick={() => mutate()}
          disabled={!selectedConnection || isLoading}
        >
          {t('compliance.runScan')}
        </Button>
      </Box>

      {isLoading && (
        <>
          <CardsSkeleton count={4} columns={4} />
          <TableSkeleton />
        </>
      )}

      {!isLoading && data && (
        <>
          {/* Active profile badge */}
          {hasProfile && (
            <Box>
              <Chip
                icon={<i className="ri-shield-check-line" />}
                label={`${t('compliance.activeProfile')}: ${
                  profiles.find((p: any) => p.id === (profileId || data?.profileId))?.name || profileId || data?.profileId
                }`}
                color="primary"
                variant="outlined"
              />
            </Box>
          )}

          {/* Score gauge + stat cards */}
          <Grid container spacing={3} columns={5}>
            {/* Score gauge */}
            <Grid size={{ xs: 5, sm: 2.5, md: 1 }}>
              <Card sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                    <CircularProgress
                      variant="determinate"
                      value={100}
                      size={90}
                      thickness={4}
                      sx={{ color: 'action.hover', position: 'absolute' }}
                    />
                    <CircularProgress
                      variant="determinate"
                      value={score}
                      size={90}
                      thickness={4}
                      sx={{ color: scoreColor(score) }}
                    />
                    <Box sx={{
                      top: 0, left: 0, bottom: 0, right: 0,
                      position: 'absolute', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Typography variant="h4" fontWeight={700} color={scoreColor(score)}>
                        {score}
                      </Typography>
                    </Box>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {t('compliance.hardeningScore')}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>

            {/* Stat cards */}
            {[
              { label: t('compliance.totalChecks'), value: summary.total, icon: 'ri-list-check-2', color: '#6366f1' },
              { label: t('compliance.passed'), value: summary.passed, icon: 'ri-check-line', color: '#22c55e' },
              { label: t('compliance.failed'), value: summary.failed, icon: 'ri-close-line', color: '#ef4444' },
              { label: t('compliance.criticalIssues'), value: summary.critical, icon: 'ri-error-warning-line', color: '#dc2626' },
            ].map((stat) => (
              <Grid size={{ xs: 2.5, md: 1 }} key={stat.label}>
                <Card sx={{ height: '100%' }}>
                  <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                    <Box sx={{
                      width: 44, height: 44, borderRadius: 2, display: 'flex', alignItems: 'center', justifyContent: 'center',
                      bgcolor: `${stat.color}15`,
                    }}>
                      <i className={stat.icon} style={{ fontSize: 22, color: stat.color }} />
                    </Box>
                    <Box>
                      <Typography variant="h5" fontWeight={700}>{stat.value}</Typography>
                      <Typography variant="caption" color="text.secondary">{stat.label}</Typography>
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            ))}
          </Grid>

          {/* Results Table */}
          <Card>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox" />
                    <TableCell>{t('compliance.checkName')}</TableCell>
                    <TableCell>{t('compliance.category')}</TableCell>
                    <TableCell>{t('compliance.severity')}</TableCell>
                    <TableCell>{t('common.status')}</TableCell>
                    <TableCell align="right">{t('compliance.points')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {checks.map((check: any) => {
                    const isExpanded = expandedRows.has(check.id)
                    return (
                      <Fragment key={check.id}>
                        <TableRow
                          hover
                          onClick={() => toggleRow(check.id)}
                          sx={{ cursor: 'pointer', '& > td': { borderBottom: isExpanded ? 'none' : undefined } }}
                        >
                          <TableCell padding="checkbox">
                            <IconButton size="small">
                              <i className={isExpanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} style={{ fontSize: 18 }} />
                            </IconButton>
                          </TableCell>
                          <TableCell>
                            <Typography variant="body2">{check.name}</Typography>
                          </TableCell>
                          <TableCell>
                            <Chip
                              icon={<i className={categoryIcons[check.category] || 'ri-question-line'} />}
                              label={t(`compliance.categories.${check.category}`)}
                              size="small"
                              variant="outlined"
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t(`compliance.severities.${check.severity}`)}
                              size="small"
                              color={severityColors[check.severity] || 'default'}
                            />
                          </TableCell>
                          <TableCell>
                            <Chip
                              label={t(`compliance.statuses.${check.status}`)}
                              size="small"
                              color={statusColors[check.status] || 'default'}
                              variant={check.status === 'pass' ? 'filled' : 'outlined'}
                            />
                          </TableCell>
                          <TableCell align="right">
                            <Typography variant="body2" color={check.earned === check.maxPoints ? 'success.main' : 'text.secondary'}>
                              {hasProfile ? `${check.weightedEarned ?? check.earned}/${check.weightedMaxPoints ?? check.maxPoints}` : `${check.earned}/${check.maxPoints}`}
                            </Typography>
                          </TableCell>
                        </TableRow>
                        <TableRow>
                          <TableCell colSpan={6} sx={{ py: 0, px: 0 }}>
                            <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                              <Box sx={{ py: 1.5, px: 4, pl: 8, bgcolor: 'action.hover' }}>
                                <Grid container spacing={2}>
                                  {check.entity && (
                                    <Grid size={{ xs: 12, sm: 4 }}>
                                      <Typography variant="caption" color="text.secondary">{t('compliance.entity')}</Typography>
                                      <Typography variant="body2">{check.entity}</Typography>
                                    </Grid>
                                  )}
                                  {check.details && (
                                    <Grid size={{ xs: 12, sm: 8 }}>
                                      <Typography variant="caption" color="text.secondary">{t('common.details')}</Typography>
                                      <Typography variant="body2">{check.details}</Typography>
                                    </Grid>
                                  )}
                                </Grid>
                              </Box>
                            </Collapse>
                          </TableCell>
                        </TableRow>
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>

          {data.scannedAt && (
            <Typography variant="caption" color="text.secondary" textAlign="right">
              {t('compliance.lastScan')}: {new Date(data.scannedAt).toLocaleString()}
            </Typography>
          )}
        </>
      )}

      {!isLoading && !data && selectedConnection && (
        <Alert severity="info">{t('compliance.clickScan')}</Alert>
      )}
    </Box>
  )
}

// ============================================================================
// Profiles Tab
// ============================================================================
function ProfilesTab() {
  const t = useTranslations()
  const { data: profilesData, mutate: mutateProfiles } = useComplianceProfiles()
  const profiles = profilesData?.data || []

  const [editDialog, setEditDialog] = useState<any>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const handleCreateBlank = () => {
    setEditDialog({
      isNew: true,
      name: '',
      description: '',
      checks: ALL_CHECKS.map(c => ({
        check_id: c.id,
        enabled: true,
        weight: 1.0,
        control_ref: '',
        category: c.category,
      })),
    })
  }

  const handleEditProfile = async (profileId: string) => {
    try {
      const res = await fetch(`/api/v1/compliance/profiles/${profileId}`)
      if (!res.ok) throw new Error('Failed to load profile')
      const { data: profile } = await res.json()

      // Merge with ALL_CHECKS to ensure all 25 checks are represented
      const mergedChecks = ALL_CHECKS.map(ac => {
        const existing = profile.checks.find((c: any) => c.check_id === ac.id)
        if (existing) {
          return {
            check_id: existing.check_id,
            enabled: existing.enabled === 1,
            weight: existing.weight,
            control_ref: existing.control_ref || '',
            category: existing.category || ac.category,
          }
        }
        return { check_id: ac.id, enabled: false, weight: 1.0, control_ref: '', category: ac.category }
      })

      setEditDialog({
        isNew: false,
        id: profile.id,
        name: profile.name,
        description: profile.description || '',
        checks: mergedChecks,
      })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  const handleSaveProfile = async () => {
    if (!editDialog || !editDialog.name) return
    setCreating(true)

    try {
      if (editDialog.isNew) {
        // Create new profile
        const res = await fetch('/api/v1/compliance/profiles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editDialog.name,
            description: editDialog.description,
          }),
        })
        if (!res.ok) throw new Error('Failed to create profile')
        const { data: profile } = await res.json()

        // Update checks
        await fetch(`/api/v1/compliance/profiles/${profile.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ checks: editDialog.checks }),
        })
      } else {
        // Update existing
        await fetch(`/api/v1/compliance/profiles/${editDialog.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: editDialog.name,
            description: editDialog.description,
            checks: editDialog.checks,
          }),
        })
      }

      mutateProfiles()
      setEditDialog(null)
      setToast({ type: 'success', message: t('compliance.profileSaved') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    } finally {
      setCreating(false)
    }
  }

  const handleDeleteProfile = async (profileId: string) => {
    if (!confirm(t('compliance.confirmDeleteProfile'))) return
    try {
      await fetch(`/api/v1/compliance/profiles/${profileId}`, { method: 'DELETE' })
      mutateProfiles()
      setToast({ type: 'success', message: t('compliance.profileDeleted') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  const handleActivateProfile = async (profileId: string) => {
    try {
      await fetch(`/api/v1/compliance/profiles/${profileId}/activate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      mutateProfiles()
      setToast({ type: 'success', message: t('compliance.profileActivated') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  const handleDeactivateAll = async () => {
    try {
      await fetch('/api/v1/compliance/profiles/none/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      mutateProfiles()
      setToast({ type: 'success', message: t('compliance.profilesDeactivated') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    }
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {toast && (
        <Alert severity={toast.type} onClose={() => setToast(null)}>
          {toast.message}
        </Alert>
      )}

      {/* Description */}
      <Typography variant="body2" color="text.secondary">
        {t('compliance.profilesDescription')}
      </Typography>

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Button
          variant="contained"
          size="small"
          startIcon={<i className="ri-add-line" />}
          onClick={handleCreateBlank}
        >
          {t('compliance.createProfile')}
        </Button>
        {profiles.some((p: any) => p.is_active) && (
          <Button
            variant="outlined"
            size="small"
            color="warning"
            startIcon={<i className="ri-close-circle-line" />}
            onClick={handleDeactivateAll}
          >
            {t('compliance.deactivateAll')}
          </Button>
        )}
      </Box>

      {profiles.length === 0 && (
        <Alert severity="info">{t('compliance.noProfiles')}</Alert>
      )}

      {profiles.length > 0 && (
        <Card>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t('compliance.profileName')}</TableCell>
                  <TableCell>{t('compliance.profileDescription')}</TableCell>
                  <TableCell>{t('common.status')}</TableCell>
                  <TableCell>{t('common.created')}</TableCell>
                  <TableCell align="right">{t('common.actions')}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {profiles.map((p: any) => (
                  <TableRow key={p.id} hover>
                    <TableCell>
                      <Typography variant="body2" fontWeight={p.is_active ? 600 : 400}>{p.name}</Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {p.description || '-'}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {p.is_active ? (
                        <Chip label={t('compliance.active')} size="small" color="success" />
                      ) : (
                        <Chip label={t('compliance.inactive')} size="small" variant="outlined" />
                      )}
                    </TableCell>
                    <TableCell>
                      <Typography variant="caption" color="text.secondary">
                        {new Date(p.created_at).toLocaleDateString()}
                      </Typography>
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t('compliance.activate')}>
                        <IconButton size="small" onClick={() => handleActivateProfile(p.id)} disabled={p.is_active}>
                          <i className="ri-check-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.edit')}>
                        <IconButton size="small" onClick={() => handleEditProfile(p.id)}>
                          <i className="ri-edit-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t('common.delete')}>
                        <IconButton size="small" color="error" onClick={() => handleDeleteProfile(p.id)}>
                          <i className="ri-delete-bin-line" style={{ fontSize: 18 }} />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}

      {/* Profile Editor Dialog */}
      <Dialog open={!!editDialog} onClose={() => setEditDialog(null)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editDialog?.isNew ? t('compliance.createProfile') : t('compliance.editProfile')}
        </DialogTitle>
        <DialogContent>
          {editDialog && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mt: 1 }}>
              <TextField
                label={t('compliance.profileName')}
                value={editDialog.name}
                onChange={(e) => setEditDialog((prev: any) => ({ ...prev, name: e.target.value }))}
                size="small"
                fullWidth
              />
              <TextField
                label={t('compliance.profileDescription')}
                value={editDialog.description}
                onChange={(e) => setEditDialog((prev: any) => ({ ...prev, description: e.target.value }))}
                size="small"
                fullWidth
                multiline
                rows={2}
              />
              <Divider />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="subtitle2">{t('compliance.checks')}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {editDialog.checks.filter((c: any) => c.enabled).length}/{ALL_CHECKS.length} {t('compliance.enabled').toLowerCase()}
                </Typography>
              </Box>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell padding="checkbox">{t('compliance.enabled')}</TableCell>
                    <TableCell>{t('compliance.checkName')}</TableCell>
                    <TableCell>{t('compliance.category')}</TableCell>
                    <TableCell>{t('compliance.weight')}</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {editDialog.checks.map((check: any, idx: number) => {
                    const checkDef = ALL_CHECKS.find(c => c.id === check.check_id)
                    return (
                      <TableRow key={check.check_id}>
                        <TableCell padding="checkbox">
                          <Switch
                            size="small"
                            checked={check.enabled}
                            onChange={(e) => {
                              setEditDialog((prev: any) => {
                                const checks = [...prev.checks]
                                checks[idx] = { ...checks[idx], enabled: e.target.checked }
                                return { ...prev, checks }
                              })
                            }}
                          />
                        </TableCell>
                        <TableCell>
                          <Typography variant="body2" color={check.enabled ? 'text.primary' : 'text.disabled'}>
                            {checkDef?.name || check.check_id}
                          </Typography>
                        </TableCell>
                        <TableCell>
                          <Chip
                            icon={<i className={categoryIcons[checkDef?.category || ''] || 'ri-question-line'} />}
                            label={checkDef?.category || '-'}
                            size="small"
                            variant="outlined"
                            sx={{ opacity: check.enabled ? 1 : 0.5 }}
                          />
                        </TableCell>
                        <TableCell sx={{ width: 140 }}>
                          <Slider
                            value={check.weight}
                            min={0.5}
                            max={2.0}
                            step={0.1}
                            size="small"
                            disabled={!check.enabled}
                            valueLabelDisplay="auto"
                            onChange={(_, val) => {
                              setEditDialog((prev: any) => {
                                const checks = [...prev.checks]
                                checks[idx] = { ...checks[idx], weight: val as number }
                                return { ...prev, checks }
                              })
                            }}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditDialog(null)}>{t('common.cancel')}</Button>
          <Button
            variant="contained"
            onClick={handleSaveProfile}
            disabled={creating || !editDialog?.name}
            startIcon={creating ? <CircularProgress size={16} color="inherit" /> : undefined}
          >
            {t('common.save')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}

// ============================================================================
// Policies Tab
// ============================================================================
function PoliciesTab() {
  const t = useTranslations()
  const { data, isLoading, mutate } = useSecurityPolicies()
  const policies = data?.data

  const [form, setForm] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  useEffect(() => {
    if (policies && !form) {
      setForm({ ...policies })
    }
  }, [policies, form])

  const handleChange = useCallback((field: string, value: any) => {
    setForm((prev: any) => prev ? { ...prev, [field]: value } : prev)
  }, [])

  const handleSave = useCallback(async () => {
    if (!form) return
    setSaving(true)
    setToast(null)
    try {
      const res = await fetch('/api/v1/compliance/policies', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save')
      }
      mutate()
      setToast({ type: 'success', message: t('compliance.policiesSaved') })
    } catch (e: any) {
      setToast({ type: 'error', message: e?.message || 'Error' })
    } finally {
      setSaving(false)
    }
  }, [form, mutate, t])

  if (isLoading || !form) return <CardsSkeleton count={4} columns={2} />

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {toast && (
        <Alert severity={toast.type} onClose={() => setToast(null)}>
          {toast.message}
        </Alert>
      )}

      <Grid container spacing={3} sx={{ alignItems: 'stretch' }}>
        {/* Password Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-lock-password-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.passwordPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.minLength')}
                  value={form.password_min_length}
                  onChange={(e) => handleChange('password_min_length', parseInt(e.target.value) || 0)}
                  size="small"
                  inputProps={{ min: 1, max: 128 }}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_uppercase} onChange={(e) => handleChange('password_require_uppercase', e.target.checked)} />}
                  label={t('compliance.requireUppercase')}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_lowercase} onChange={(e) => handleChange('password_require_lowercase', e.target.checked)} />}
                  label={t('compliance.requireLowercase')}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_numbers} onChange={(e) => handleChange('password_require_numbers', e.target.checked)} />}
                  label={t('compliance.requireNumbers')}
                />
                <FormControlLabel
                  control={<Switch checked={form.password_require_special} onChange={(e) => handleChange('password_require_special', e.target.checked)} />}
                  label={t('compliance.requireSpecial')}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Session Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-time-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.sessionPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.sessionTimeout')}
                  value={form.session_timeout_minutes}
                  onChange={(e) => handleChange('session_timeout_minutes', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.sessionTimeoutHelper')}
                  inputProps={{ min: 0 }}
                />
                <TextField
                  type="number"
                  label={t('compliance.maxConcurrentSessions')}
                  value={form.session_max_concurrent}
                  onChange={(e) => handleChange('session_max_concurrent', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.maxConcurrentHelper')}
                  inputProps={{ min: 0 }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Login Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-login-box-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.loginPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.maxFailedAttempts')}
                  value={form.login_max_failed_attempts}
                  onChange={(e) => handleChange('login_max_failed_attempts', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.maxFailedHelper')}
                  inputProps={{ min: 0 }}
                />
                <TextField
                  type="number"
                  label={t('compliance.lockoutDuration')}
                  value={form.login_lockout_duration_minutes}
                  onChange={(e) => handleChange('login_lockout_duration_minutes', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.lockoutHelper')}
                  inputProps={{ min: 0 }}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Audit Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card sx={{ height: '100%' }}>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <i className="ri-file-list-3-line" style={{ fontSize: 20 }} />
                <Typography variant="h6">{t('compliance.auditPolicy')}</Typography>
              </Box>
              <Divider sx={{ mb: 2 }} />
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <TextField
                  type="number"
                  label={t('compliance.retentionDays')}
                  value={form.audit_retention_days}
                  onChange={(e) => handleChange('audit_retention_days', parseInt(e.target.value) || 0)}
                  size="small"
                  helperText={t('compliance.retentionHelper')}
                  inputProps={{ min: 1 }}
                />
                <FormControlLabel
                  control={<Switch checked={form.audit_auto_cleanup} onChange={(e) => handleChange('audit_auto_cleanup', e.target.checked)} />}
                  label={t('compliance.autoCleanup')}
                />
              </Box>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      {/* Save button */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="contained"
          startIcon={saving ? <CircularProgress size={16} color="inherit" /> : <i className="ri-save-line" />}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? t('common.saving') : t('common.save')}
        </Button>
      </Box>
    </Box>
  )
}

// ============================================================================
// Main Page
// ============================================================================
export default function CompliancePage() {
  const t = useTranslations()
  const { setPageInfo } = usePageTitle()
  const [tab, setTab] = useState(0)

  useEffect(() => {
    setPageInfo(t('compliance.title'), '', 'ri-shield-check-line')
  }, [setPageInfo, t])

  return (
    <EnterpriseGuard requiredFeature={Features.COMPLIANCE}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Tabs value={tab} onChange={(_, v) => setTab(v)}>
          <Tab
            icon={<i className="ri-shield-check-line" />}
            iconPosition="start"
            label={t('compliance.hardening')}
          />
          <Tab
            icon={<i className="ri-profile-line" />}
            iconPosition="start"
            label={t('compliance.profiles')}
          />
          <Tab
            icon={<i className="ri-file-shield-2-line" />}
            iconPosition="start"
            label={t('compliance.policies')}
          />
        </Tabs>

        {tab === 0 && <HardeningTab />}
        {tab === 1 && <ProfilesTab />}
        {tab === 2 && <PoliciesTab />}
      </Box>
    </EnterpriseGuard>
  )
}
