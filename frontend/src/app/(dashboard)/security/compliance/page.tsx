'use client'

import { Fragment, useCallback, useEffect, useState } from 'react'

import { useTranslations } from 'next-intl'
import {
  Alert, Autocomplete, Box, Button, Card, CardContent, Chip, CircularProgress,
  Collapse, Divider, FormControlLabel, Grid, IconButton, Switch, Tab, Table,
  TableBody, TableCell, TableContainer, TableHead, TableRow, Tabs, TextField, Typography
} from '@mui/material'

import { usePageTitle } from '@/contexts/PageTitleContext'
import EnterpriseGuard from '@/components/guards/EnterpriseGuard'
import { Features } from '@/contexts/LicenseContext'
import { CardsSkeleton, TableSkeleton } from '@/components/skeletons'
import { usePVEConnections } from '@/hooks/useConnections'
import { useHardeningChecks, useSecurityPolicies } from '@/hooks/useHardeningChecks'

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

// ============================================================================
// Hardening Tab
// ============================================================================
function HardeningTab() {
  const t = useTranslations()
  const { data: connectionsData } = usePVEConnections()
  const connections = connectionsData?.data || []

  const [selectedConnection, setSelectedConnection] = useState<any>(null)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())
  const { data, isLoading, mutate } = useHardeningChecks(selectedConnection?.id)

  // Auto-select first connection
  useEffect(() => {
    if (connections.length > 0 && !selectedConnection) {
      setSelectedConnection(connections[0])
    }
  }, [connections, selectedConnection])

  const checks = data?.checks || []
  const summary = data?.summary || { score: 0, total: 0, passed: 0, failed: 0, warnings: 0, skipped: 0, critical: 0 }
  const score = data?.score ?? 0

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      {/* Connection selector + scan button */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
        <Autocomplete
          options={connections}
          getOptionLabel={(opt: any) => opt.name || opt.id}
          value={selectedConnection}
          onChange={(_, v) => setSelectedConnection(v)}
          renderInput={(params) => (
            <TextField {...params} label={t('compliance.selectConnection')} size="small" />
          )}
          sx={{ minWidth: 300 }}
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
          {/* Score gauge + stat cards */}
          <Grid container spacing={3}>
            {/* Score gauge */}
            <Grid size={{ xs: 12, md: 3 }}>
              <Card sx={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <CardContent sx={{ textAlign: 'center' }}>
                  <Box sx={{ position: 'relative', display: 'inline-flex', mb: 1 }}>
                    <CircularProgress
                      variant="determinate"
                      value={100}
                      size={100}
                      thickness={4}
                      sx={{ color: 'action.hover', position: 'absolute' }}
                    />
                    <CircularProgress
                      variant="determinate"
                      value={score}
                      size={100}
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
              <Grid size={{ xs: 6, md: 2.25 }} key={stat.label}>
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
                              {check.earned}/{check.maxPoints}
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

      <Grid container spacing={3}>
        {/* Password Policy */}
        <Grid size={{ xs: 12, md: 6 }}>
          <Card>
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
          <Card>
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
          <Card>
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
          <Card>
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
            icon={<i className="ri-file-shield-2-line" />}
            iconPosition="start"
            label={t('compliance.policies')}
          />
        </Tabs>

        {tab === 0 && <HardeningTab />}
        {tab === 1 && <PoliciesTab />}
      </Box>
    </EnterpriseGuard>
  )
}
