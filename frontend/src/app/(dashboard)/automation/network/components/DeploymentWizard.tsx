'use client'

import { useEffect, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'

import {
  Alert, Avatar, Box, Button, Chip, CircularProgress, Dialog, DialogContent, DialogTitle, IconButton, Step, StepLabel, Stepper,
  Typography, useTheme, alpha,
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'

const STEPS = ['stepAnalysis', 'stepActivate', 'stepDone'] as const

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

/** What the wizard knows of a node's own firewall: off (`enable: 0`), on once the cluster firewall is, or not read. */
export type NodeFirewall = 'off' | 'follows' | 'unknown'

/**
 * A node's firewall is off only with an explicit `enable: 0` in its options: an absent value means it turns on with the
 * cluster firewall (PVE, Firewall.pm).
 */
export function nodeFirewallOf(options: Pick<firewallAPI.NodeOptions, 'enable'> | null | undefined): NodeFirewall {
  if (!options) return 'unknown'
  // PVE may hand the flag as a number or as its text.
  return Number(options.enable) === 0 && options.enable !== undefined && options.enable !== null ? 'off' : 'follows'
}

/** Reads the firewall options of each node once the wizard opens; a node that cannot be read is `unknown`. */
function useNodeFirewalls(open: boolean, connection: string, nodes: string[]) {
  const [states, setStates] = useState<Record<string, NodeFirewall> | null>(null)
  const key = nodes.join(',')
  useEffect(() => {
    if (!open || !connection) return
    let cancelled = false
    void Promise.all(nodes.map(async node => {
      try {
        return [node, nodeFirewallOf(await firewallAPI.getNodeOptions(connection, node))] as const
      } catch {
        return [node, 'unknown'] as const
      }
    })).then(entries => { if (!cancelled) setStates(Object.fromEntries(entries)) })
    return () => { cancelled = true }
    // `key` stands for the node list: a new array of the same nodes must not read them again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection, key])
  return open ? states : null
}

/**
 * Turns the cluster firewall on, which the guests' firewalls (and the micro-segmentation) need. It writes nothing else:
 * no cluster rule, no inbound policy, nothing on the nodes. Those apply to the nodes only, and ProxCenter leaves the
 * nodes' firewalls alone. The analysis says which nodes have their own firewall on once the cluster firewall is (no
 * `enable: 0`), since PVE then filters them with what their admin set up.
 */
export default function DeploymentWizard({ open, onClose, selectedConnection, nodesList, onComplete }: DeploymentWizardProps) {
  const theme = useTheme()
  const t = useTranslations('deployWizard')

  const [activeStep, setActiveStep] = useState(0)
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState(false)
  const [activated, setActivated] = useState(false)
  const nodeFirewalls = useNodeFirewalls(open, selectedConnection, nodesList)
  const following = nodeFirewalls ? Object.entries(nodeFirewalls).filter(([, s]) => s === 'follows').map(([n]) => n).sort() : []
  const unknown = nodeFirewalls ? Object.entries(nodeFirewalls).filter(([, s]) => s === 'unknown').map(([n]) => n).sort() : []

  const handleClose = useCallback(() => {
    onClose()
    setTimeout(() => {
      setActiveStep(0)
      setActivating(false)
      setActivateError(false)
      setActivated(false)
    }, 300)
  }, [onClose])

  const handleActivate = async () => {
    setActivating(true)
    setActivateError(false)
    try {
      await firewallAPI.updateClusterOptions(selectedConnection, { enable: 1 })
      setActivated(true)
      setActiveStep(2)
      onComplete()
    } catch {
      setActivateError(true)
    } finally {
      setActivating(false)
    }
  }

  const handleSkipActivation = () => {
    setActiveStep(2)
    onComplete()
  }

  const line = (icon: string, color: string, text: string, testId?: string) => (
    <Box data-testid={testId} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Avatar sx={{ width: 32, height: 32, bgcolor: alpha(color, 0.15) }}>
        <i className={icon} style={{ fontSize: 16, color }} />
      </Avatar>
      <Typography variant='body2'>{text}</Typography>
    </Box>
  )

  const renderAnalysis = () => (
    <Box sx={{ py: 2 }}>
      <Typography variant='h6' sx={{ fontWeight: 700, mb: 3 }}>{t('analysisTitle')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 3 }}>
        {line('ri-server-line', '#3b82f6', t('analysisNodes', { count: nodesList.length }))}
        {line('ri-shield-cross-line', '#ef4444', t('analysisFirewallOff'))}
        {nodeFirewalls === null
          ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pl: 0.5 }}><CircularProgress size={18} /><Typography variant='body2' color='text.secondary'>{t('analysisNodesReading')}</Typography></Box>
          : line('ri-node-tree', following.length + unknown.length > 0 ? '#f59e0b' : '#22c55e',
            following.length + unknown.length > 0 ? t('analysisNodesFollow', { count: following.length, nodes: following.join(', ') }) : t('analysisNodesOff'), 'wizard-node-firewalls')}
      </Box>
      <Alert severity='info' sx={{ mb: 2 }}>{t('analysisInfo')}</Alert>
      {following.length > 0 && <Alert severity='warning' data-testid='wizard-nodes-follow' sx={{ mb: 2 }}>{t('analysisNodesWarning', { nodes: following.join(', ') })}</Alert>}
      {unknown.length > 0 && <Alert severity='warning' sx={{ mb: 2 }}>{t('analysisNodesUnknown', { nodes: unknown.join(', ') })}</Alert>}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
        <Button variant='text' onClick={handleClose}>{t('cancel')}</Button>
        <Button variant='contained' onClick={() => setActiveStep(1)} disabled={nodeFirewalls === null}>{t('next')}</Button>
      </Box>
    </Box>
  )

  const renderActivate = () => (
    <Box sx={{ py: 2 }}>
      <Typography variant='h6' sx={{ fontWeight: 700, mb: 2 }}>{t('activateTitle')}</Typography>
      <Typography variant='body2' sx={{ mb: 2 }}>{t('activateDescription')}</Typography>
      {activateError && <Alert severity='error' sx={{ mb: 2 }}>{t('activateFailed')}</Alert>}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Button variant='text' onClick={handleSkipActivation} sx={{ fontSize: 12, color: 'text.secondary' }}>{t('activateSkip')}</Button>
        <Button
          variant='contained'
          color='warning'
          onClick={handleActivate}
          disabled={activating}
          startIcon={activating ? <CircularProgress size={16} color='inherit' /> : <i className='ri-shield-flash-line' />}
        >
          {activating ? t('activating') : t('activateButton')}
        </Button>
      </Box>
    </Box>
  )

  const renderDone = () => (
    <Box sx={{ py: 2, textAlign: 'center' }}>
      <Avatar sx={{ width: 64, height: 64, bgcolor: alpha(activated ? '#22c55e' : theme.palette.text.disabled, 0.15), mx: 'auto', mb: 2 }}>
        <i className={activated ? 'ri-check-double-line' : 'ri-shield-cross-line'} style={{ fontSize: 32, color: activated ? '#22c55e' : theme.palette.text.disabled }} />
      </Avatar>
      <Typography variant='h6' sx={{ fontWeight: 700, mb: 3 }}>{t('doneTitle')}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3, alignItems: 'center' }}>
        <Chip
          icon={<i className={activated ? 'ri-shield-check-line' : 'ri-shield-cross-line'} style={{ fontSize: 14 }} />}
          label={activated ? t('doneFirewallEnabled') : t('doneFirewallNotEnabled')}
          color={activated ? 'success' : 'default'}
          sx={{ height: 28 }}
        />
      </Box>
      <Button variant='outlined' onClick={handleClose}>{t('doneClose')}</Button>
    </Box>
  )

  return (
    <Dialog open={open} onClose={activating ? undefined : handleClose} maxWidth='md' fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <i className='ri-shield-flash-line' style={{ fontSize: 22, color: theme.palette.warning.main }} />
          <Typography variant='h6' sx={{ fontWeight: 700 }}>{t('dialogTitle')}</Typography>
        </Box>
        {!activating && <IconButton onClick={handleClose} size='small' aria-label={t('cancel')}><i className='ri-close-line' /></IconButton>}
      </DialogTitle>

      <Stepper activeStep={activeStep} alternativeLabel sx={{ px: 3, pb: 2 }}>
        {STEPS.map(key => <Step key={key}><StepLabel>{t(key)}</StepLabel></Step>)}
      </Stepper>

      <DialogContent sx={{ pt: 0 }}>
        {activeStep === 0 && renderAnalysis()}
        {activeStep === 1 && renderActivate()}
        {activeStep === 2 && renderDone()}
      </DialogContent>
    </Dialog>
  )
}
