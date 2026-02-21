'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Avatar, Box, Button, Checkbox, Chip, CircularProgress,
  Dialog, DialogContent, DialogTitle, FormControlLabel,
  IconButton, LinearProgress, Step, StepLabel, Stepper,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Typography, useTheme, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'

// ── Cluster whitelist rules to create ──

interface ClusterWhitelistRule {
  service: string
  proto: string
  dport: string
  comment: string
}

const CLUSTER_RULES: ClusterWhitelistRule[] = [
  { service: 'Corosync',           proto: 'udp', dport: '5405:5412',   comment: 'PVE Cluster - Corosync' },
  { service: 'Ceph Monitor',       proto: 'tcp', dport: '6789,3300',   comment: 'PVE Cluster - Ceph Monitor' },
  { service: 'Ceph OSD/MDS',       proto: 'tcp', dport: '6800:7300',   comment: 'PVE Cluster - Ceph OSD/MDS' },
  { service: 'PVE API/Web UI',     proto: 'tcp', dport: '8006',        comment: 'PVE Cluster - API/Web UI' },
  { service: 'SSH',                 proto: 'tcp', dport: '22',          comment: 'PVE Cluster - SSH' },
  { service: 'Live Migration',     proto: 'tcp', dport: '60000:60050', comment: 'PVE Cluster - Live Migration' },
  { service: 'VNC/SPICE Console',  proto: 'tcp', dport: '5900:5999',   comment: 'PVE Cluster - VNC/SPICE Console' },
  { service: 'SPICE Proxy',        proto: 'tcp', dport: '3128',        comment: 'PVE Cluster - SPICE Proxy' },
]

const STEPS = ['stepAnalysis', 'stepPreview', 'stepApply', 'stepActivate', 'stepDone'] as const

// ── Props ──

interface DeploymentWizardProps {
  open: boolean
  onClose: () => void
  selectedConnection: string
  clusterOptions: firewallAPI.ClusterOptions | null
  clusterRules: firewallAPI.FirewallRule[]
  nodesList: string[]
  firewallMode: firewallAPI.FirewallMode
  onComplete: () => void
}

type RuleStatus = 'pending' | 'creating' | 'success' | 'error'

export default function DeploymentWizard({
  open, onClose, selectedConnection, clusterOptions, clusterRules,
  nodesList, firewallMode, onComplete,
}: DeploymentWizardProps) {
  const theme = useTheme()
  const t = useTranslations('deployWizard')

  // ── State ──
  const [activeStep, setActiveStep] = useState(0)
  const [ruleStatuses, setRuleStatuses] = useState<RuleStatus[]>(CLUSTER_RULES.map(() => 'pending'))
  const [applyDone, setApplyDone] = useState(false)
  const [applyErrors, setApplyErrors] = useState(0)
  const [enableFirewall, setEnableFirewall] = useState(true)
  const [setDrop, setSetDrop] = useState(true)
  const [activating, setActivating] = useState(false)
  const [activateDone, setActivateDone] = useState(false)
  const [skippedActivation, setSkippedActivation] = useState(false)

  // ── Reset on close ──
  const handleClose = useCallback(() => {
    onClose()
    setTimeout(() => {
      setActiveStep(0)
      setRuleStatuses(CLUSTER_RULES.map(() => 'pending'))
      setApplyDone(false)
      setApplyErrors(0)
      setEnableFirewall(true)
      setSetDrop(true)
      setActivating(false)
      setActivateDone(false)
      setSkippedActivation(false)
    }, 300)
  }, [onClose])

  // ── Step 2: Apply rules sequentially ──
  useEffect(() => {
    if (activeStep !== 2 || applyDone) return

    let cancelled = false

    const applyRules = async () => {
      let errors = 0

      for (let i = 0; i < CLUSTER_RULES.length; i++) {
        if (cancelled) return

        setRuleStatuses(prev => {
          const next = [...prev]
          next[i] = 'creating'
          return next
        })

        try {
          await firewallAPI.addClusterRule(selectedConnection, {
            type: 'in',
            action: 'ACCEPT',
            enable: 1,
            proto: CLUSTER_RULES[i].proto,
            dport: CLUSTER_RULES[i].dport,
            comment: CLUSTER_RULES[i].comment,
          })

          if (!cancelled) {
            setRuleStatuses(prev => {
              const next = [...prev]
              next[i] = 'success'
              return next
            })
          }
        } catch {
          errors++
          if (!cancelled) {
            setRuleStatuses(prev => {
              const next = [...prev]
              next[i] = 'error'
              return next
            })
          }
        }
      }

      if (!cancelled) {
        setApplyErrors(errors)
        setApplyDone(true)
      }
    }

    applyRules()
    return () => { cancelled = true }
  }, [activeStep, applyDone, selectedConnection])

  // ── Step 3: Activate ──
  const handleActivate = async () => {
    setActivating(true)
    try {
      const opts: firewallAPI.UpdateOptionsRequest = {}
      if (enableFirewall) opts.enable = 1
      if (enableFirewall && setDrop) opts.policy_in = 'DROP'
      await firewallAPI.updateClusterOptions(selectedConnection, opts)
      setActivateDone(true)
      setActiveStep(4)
      onComplete()
    } catch {
      setActivating(false)
    }
  }

  const handleSkipActivation = () => {
    setSkippedActivation(true)
    setActiveStep(4)
    onComplete()
  }

  // ── Derived ──
  const successCount = ruleStatuses.filter(s => s === 'success').length

  // ── Render helpers ──

  const renderAnalysis = () => (
    <Box sx={{ py: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('analysisTitle')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#3b82f6', 0.15) }}>
            <i className="ri-server-line" style={{ fontSize: 16, color: '#3b82f6' }} />
          </Avatar>
          <Typography variant="body2">{t('analysisNodes', { count: nodesList.length })}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#ef4444', 0.15) }}>
            <i className="ri-shield-cross-line" style={{ fontSize: 16, color: '#ef4444' }} />
          </Avatar>
          <Typography variant="body2">{t('analysisFirewallOff')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#f59e0b', 0.15) }}>
            <i className="ri-list-check-3" style={{ fontSize: 16, color: '#f59e0b' }} />
          </Avatar>
          <Typography variant="body2">{t('analysisNoRules')}</Typography>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Avatar sx={{ width: 32, height: 32, bgcolor: alpha('#f59e0b', 0.15) }}>
            <i className="ri-arrow-down-line" style={{ fontSize: 16, color: '#f59e0b' }} />
          </Avatar>
          <Typography variant="body2">{t('analysisPolicyAccept')}</Typography>
        </Box>
      </Box>
      <Alert severity="warning" sx={{ mb: 2 }}>{t('analysisWarning')}</Alert>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button variant="text" onClick={handleClose}>{t('cancel')}</Button>
        <Button variant="contained" onClick={() => setActiveStep(1)}>{t('next')}</Button>
      </Box>
    </Box>
  )

  const renderPreview = () => (
    <Box sx={{ py: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>{t('previewTitle')}</Typography>
      <Alert severity="info" sx={{ mb: 2 }}>{t('previewDescription', { count: CLUSTER_RULES.length })}</Alert>
      <TableContainer sx={{ mb: 2 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ fontWeight: 700 }}>{t('previewService')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('previewProtocol')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('previewPorts')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('previewDirection')}</TableCell>
              <TableCell sx={{ fontWeight: 700 }}>{t('previewAction')}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {CLUSTER_RULES.map((rule, idx) => (
              <TableRow key={idx}>
                <TableCell>{rule.service}</TableCell>
                <TableCell><Chip label={rule.proto.toUpperCase()} size="small" sx={{ height: 22, fontSize: 11, fontWeight: 600 }} /></TableCell>
                <TableCell sx={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12 }}>{rule.dport}</TableCell>
                <TableCell><Chip label="IN" size="small" color="info" sx={{ height: 22, fontSize: 11, fontWeight: 600 }} /></TableCell>
                <TableCell><Chip label="ACCEPT" size="small" color="success" sx={{ height: 22, fontSize: 11, fontWeight: 600 }} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button variant="text" onClick={handleClose}>{t('cancel')}</Button>
        <Button variant="contained" onClick={() => setActiveStep(2)}>{t('next')}</Button>
      </Box>
    </Box>
  )

  const renderApply = () => (
    <Box sx={{ py: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>{t('applyTitle')}</Typography>
      {!applyDone && (
        <LinearProgress variant="determinate" value={(successCount / CLUSTER_RULES.length) * 100} sx={{ mb: 2, height: 6, borderRadius: 3 }} />
      )}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
        {CLUSTER_RULES.map((rule, idx) => (
          <Box key={idx} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1, borderRadius: 1, bgcolor: alpha(theme.palette.divider, 0.04) }}>
            {ruleStatuses[idx] === 'pending' && (
              <i className="ri-time-line" style={{ fontSize: 18, color: theme.palette.text.disabled }} />
            )}
            {ruleStatuses[idx] === 'creating' && (
              <CircularProgress size={18} />
            )}
            {ruleStatuses[idx] === 'success' && (
              <i className="ri-check-line" style={{ fontSize: 18, color: '#22c55e' }} />
            )}
            {ruleStatuses[idx] === 'error' && (
              <i className="ri-close-line" style={{ fontSize: 18, color: '#ef4444' }} />
            )}
            <Typography variant="body2" sx={{ flex: 1, fontSize: 13 }}>
              {rule.service}
              <Typography component="span" sx={{ color: 'text.secondary', ml: 1, fontSize: 11 }}>
                {rule.proto.toUpperCase()} {rule.dport}
              </Typography>
            </Typography>
            {ruleStatuses[idx] === 'success' && <Chip label="OK" size="small" color="success" sx={{ height: 20, fontSize: 10 }} />}
            {ruleStatuses[idx] === 'error' && <Chip label="Error" size="small" color="error" sx={{ height: 20, fontSize: 10 }} />}
          </Box>
        ))}
      </Box>
      {applyDone && applyErrors === 0 && (
        <Alert severity="success" sx={{ mb: 2 }}>{t('applyComplete', { count: CLUSTER_RULES.length })}</Alert>
      )}
      {applyDone && applyErrors > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>{t('applyPartial', { success: successCount, total: CLUSTER_RULES.length, failed: applyErrors })}</Alert>
      )}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="contained" disabled={!applyDone} onClick={() => setActiveStep(3)}>{t('next')}</Button>
      </Box>
    </Box>
  )

  const renderActivate = () => (
    <Box sx={{ py: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('activateTitle')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
        <FormControlLabel
          control={<Checkbox checked={enableFirewall} onChange={(_, v) => { setEnableFirewall(v); if (!v) setSetDrop(false) }} />}
          label={t('activateEnableFirewall')}
        />
        <FormControlLabel
          control={<Checkbox checked={setDrop} onChange={(_, v) => setSetDrop(v)} disabled={!enableFirewall} />}
          label={t('activateSetDrop')}
          sx={{ ml: 2 }}
        />
      </Box>
      <Alert severity="warning" sx={{ mb: 3 }}>{t('activateWarning')}</Alert>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant="text" onClick={handleSkipActivation} sx={{ fontSize: 12, color: 'text.secondary' }}>{t('activateSkip')}</Button>
        <Button
          variant="contained"
          color="warning"
          onClick={handleActivate}
          disabled={activating || (!enableFirewall && !setDrop)}
          startIcon={activating ? <CircularProgress size={16} color="inherit" /> : <i className="ri-shield-flash-line" />}
        >
          {activating ? t('activating') : t('activateButton')}
        </Button>
      </Box>
    </Box>
  )

  const renderDone = () => (
    <Box sx={{ py: 2, textAlign: 'center' }}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: alpha('#22c55e', 0.15), mx: 'auto', mb: 2 }}>
        <i className="ri-check-double-line" style={{ fontSize: 32, color: '#22c55e' }} />
      </Avatar>
      <Typography variant="h6" sx={{ fontWeight: 700, mb: 3 }}>{t('doneTitle')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3, alignItems: 'center' }}>
        <Chip icon={<i className="ri-list-check-3" style={{ fontSize: 14 }} />} label={t('doneRulesCreated', { count: successCount })} color="success" sx={{ height: 28 }} />
        <Chip
          icon={<i className={skippedActivation || !enableFirewall ? "ri-shield-cross-line" : "ri-shield-check-line"} style={{ fontSize: 14 }} />}
          label={activateDone && enableFirewall ? t('doneFirewallEnabled') : t('doneFirewallNotEnabled')}
          color={activateDone && enableFirewall ? 'success' : 'default'}
          sx={{ height: 28 }}
        />
        <Chip
          icon={<i className="ri-arrow-down-line" style={{ fontSize: 14 }} />}
          label={activateDone && setDrop ? t('donePolicyDrop') : t('donePolicyAccept')}
          color={activateDone && setDrop ? 'warning' : 'default'}
          sx={{ height: 28 }}
        />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'center', gap: 1.5 }}>
        <Button variant="outlined" onClick={handleClose}>{t('doneClose')}</Button>
      </Box>
    </Box>
  )

  return (
    <Dialog open={open} onClose={activeStep < 2 ? handleClose : undefined} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className="ri-shield-flash-line" style={{ fontSize: 22, color: theme.palette.warning.main }} />
          <Typography variant="h6" sx={{ fontWeight: 700 }}>{t('dialogTitle')}</Typography>
        </Box>
        {activeStep < 2 && (
          <IconButton onClick={handleClose} size="small"><i className="ri-close-line" /></IconButton>
        )}
      </DialogTitle>

      <Stepper activeStep={activeStep} alternativeLabel sx={{ px: 3, pb: 2 }}>
        {STEPS.map((key) => (
          <Step key={key}><StepLabel>{t(key)}</StepLabel></Step>
        ))}
      </Stepper>

      <DialogContent sx={{ pt: 0 }}>
        {activeStep === 0 && renderAnalysis()}
        {activeStep === 1 && renderPreview()}
        {activeStep === 2 && renderApply()}
        {activeStep === 3 && renderActivate()}
        {activeStep === 4 && renderDone()}
      </DialogContent>
    </Dialog>
  )
}
