'use client'

import React, { useEffect, useMemo } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Grid,
  Paper,
  Snackbar,
  Stack,
  Switch,
  Typography,
  alpha,
  useTheme,
} from '@mui/material'
import { useLicense } from '@/contexts/LicenseContext'

import { useFirewallState } from './firewall/useFirewallState'
import { PolicyChip } from './firewall/shared'
import FirewallRulesTable from './firewall/FirewallRulesTable'
import FirewallDialogs from './firewall/FirewallDialogs'
import type { FirewallAPIAdapter } from './firewall/types'

/* ═══════════════════════════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════════════════════════ */

interface Props {
  connectionId: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════════════════════════════════ */

export default function ClusterFirewallTab({ connectionId }: Props) {
  const theme = useTheme()
  const t = useTranslations()
  const { isEnterprise } = useLicense()

  // Cluster-specific API adapter
  const api = useMemo<FirewallAPIAdapter>(() => {
    const base = `/api/v1/firewall/cluster/${connectionId}`
    const headers = { 'Content-Type': 'application/json' }

    return {
      getOptions: async () => {
        const res = await fetch(`${base}?type=options`)
        return res.ok ? res.json() : {}
      },
      getRules: async () => {
        const res = await fetch(`${base}?type=rules`)
        return res.ok ? res.json() : []
      },
      getGroups: async () => {
        const res = await fetch(`/api/v1/firewall/groups/${connectionId}`)
        return res.ok ? res.json() : []
      },
      updateOptions: async (data) => {
        const res = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(data) })
        if (!res.ok) throw new Error(t('errors.updateError'))
      },
      addRule: async (data) => {
        const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(data) })
        if (!res.ok) throw new Error(t('errors.addError'))
      },
      updateRule: async (pos, data) => {
        const res = await fetch(`${base}/rules/${pos}`, { method: 'PUT', headers, body: JSON.stringify(data) })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error || t('common.error'))
      },
      deleteRule: async (pos) => {
        const res = await fetch(`${base}/rules/${pos}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(t('errors.deleteError'))
      },
    }
  }, [connectionId, t])

  const fw = useFirewallState(api)

  useEffect(() => {
    if (!isEnterprise) return

    fw.loadFirewallData()
  }, [fw.loadFirewallData, isEnterprise])

  // Enterprise guard
  if (!isEnterprise) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', py: 8, textAlign: 'center' }}>
        <i className='ri-vip-crown-fill' style={{ fontSize: 48, color: 'var(--mui-palette-warning-main)', marginBottom: 16 }} />
        <Typography variant='h6' sx={{ mb: 1 }}>Enterprise Feature</Typography>
        <Typography variant='body2' sx={{ opacity: 0.6 }}>
          Cluster Firewall management requires an Enterprise license.
        </Typography>
      </Box>
    )
  }

  if (fw.loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', py: 8 }}>
        <CircularProgress />
      </Box>
    )
  }

  if (fw.error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>{fw.error}</Alert>
    )
  }

  return (
    <Box sx={{ py: 2 }}>
      <Stack spacing={3}>
        {/* Options Card */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
              <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <i className="ri-shield-keyhole-line" style={{ fontSize: 20 }} />
                Firewall
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Typography variant="body2" color="text.secondary">
                  {fw.options.enable === 1 ? t('common.active') : t('common.inactive')}
                </Typography>
                <Switch
                  checked={fw.options.enable === 1}
                  onChange={fw.handleToggleFirewall}
                  disabled={fw.saving}
                  color="success"
                />
              </Box>
            </Box>

            {fw.options.enable !== 1 && (
              <Alert severity="warning" sx={{ mb: 2 }}>
                {t('security.firewall')} {t('common.disabled')}
              </Alert>
            )}

            <Grid container spacing={2}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Policy IN
                  </Typography>
                  <PolicyChip policy={fw.options.policy_in || 'DROP'} />
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Policy OUT
                  </Typography>
                  <PolicyChip policy={fw.options.policy_out || 'ACCEPT'} />
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    ebtables
                  </Typography>
                  <Chip
                    size="small"
                    label={fw.options.ebtables === 1 ? t('common.enabled') : t('common.disabled')}
                    color={fw.options.ebtables === 1 ? 'success' : 'default'}
                    sx={{ height: 26 }}
                  />
                </Paper>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <Paper sx={{ p: 2, bgcolor: alpha(theme.palette.background.default, 0.5), textAlign: 'center' }}>
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
                    Log Rate Limit
                  </Typography>
                  <Chip
                    size="small"
                    label={fw.options.log_ratelimit || 'Default'}
                    sx={{ height: 26 }}
                  />
                </Paper>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Unified Rules Card */}
        <Card variant="outlined" sx={{ borderRadius: 2 }}>
          <CardContent>
            <FirewallRulesTable
              rules={fw.rules}
              saving={fw.saving}
              draggedRule={fw.draggedRule}
              dragOverRule={fw.dragOverRule}
              availableGroups={fw.availableGroups}
              variant="node"
              onAddRuleOpen={() => fw.setAddRuleOpen(true)}
              onAddGroupOpen={() => fw.setAddGroupOpen(true)}
              onToggleRule={fw.handleToggleRule}
              onEditRule={(rule) => { fw.setEditingRule(rule); fw.setEditRuleOpen(true); }}
              onDeleteRule={fw.confirmDeleteRule}
              onDragStart={fw.handleDragStart}
              onDragEnd={fw.handleDragEnd}
              onDragOver={fw.handleDragOver}
              onDragLeave={fw.handleDragLeave}
              onDrop={fw.handleDrop}
            />
          </CardContent>
        </Card>
      </Stack>

      {/* Shared Dialogs */}
      <FirewallDialogs
        addRuleOpen={fw.addRuleOpen}
        setAddRuleOpen={fw.setAddRuleOpen}
        newRule={fw.newRule}
        setNewRule={fw.setNewRule}
        saving={fw.saving}
        onAddRule={() => fw.handleAddRule()}
        addGroupOpen={fw.addGroupOpen}
        setAddGroupOpen={fw.setAddGroupOpen}
        selectedGroup={fw.selectedGroup}
        setSelectedGroup={fw.setSelectedGroup}
        availableGroups={fw.availableGroups}
        onAddSecurityGroup={fw.handleAddSecurityGroup}
        editRuleOpen={fw.editRuleOpen}
        setEditRuleOpen={fw.setEditRuleOpen}
        editingRule={fw.editingRule}
        setEditingRule={fw.setEditingRule}
        onUpdateRule={() => fw.handleUpdateRule()}
        deleteConfirmOpen={fw.deleteConfirmOpen}
        setDeleteConfirmOpen={fw.setDeleteConfirmOpen}
        ruleToDelete={fw.ruleToDelete}
        onDeleteRule={fw.handleDeleteRule}
      />

      {/* Snackbar */}
      <Snackbar
        open={fw.snackbar.open}
        autoHideDuration={4000}
        onClose={() => fw.setSnackbar({ ...fw.snackbar, open: false })}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert severity={fw.snackbar.severity} onClose={() => fw.setSnackbar({ ...fw.snackbar, open: false })}>
          {fw.snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  )
}
