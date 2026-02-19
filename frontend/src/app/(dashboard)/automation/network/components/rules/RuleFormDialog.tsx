'use client'

import { useTranslations } from 'next-intl'

import {
  Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, InputLabel, MenuItem, Select, TextField, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import { monoStyle } from '../../types'

export interface RuleFormData {
  type: string
  action: string
  enable: number
  proto: string
  dport: string
  sport: string
  source: string
  dest: string
  macro: string
  iface: string
  log: string
  comment: string
}

interface RuleFormDialogProps {
  open: boolean
  onClose: () => void
  onSubmit: () => void
  isNew: boolean
  scope: { type: 'cluster' | 'security-group'; name?: string }
  rule: RuleFormData
  onRuleChange: (rule: RuleFormData) => void
  securityGroups: firewallAPI.SecurityGroup[]
}

const scopeColors: Record<string, string> = {
  cluster: '#06b6d4',
  'security-group': '#8b5cf6',
}

export default function RuleFormDialog({
  open, onClose, onSubmit, isNew, scope, rule, onRuleChange, securityGroups
}: RuleFormDialogProps) {
  const t = useTranslations()

  const isGroup = rule.type === 'group'
  const scopeColor = scopeColors[scope.type] || '#3b82f6'
  const scopeLabel = scope.type === 'cluster' ? 'Cluster' : `SG: ${scope.name}`
  const showGroupType = scope.type === 'cluster' // only cluster rules can be of type 'group'

  const set = (field: keyof RuleFormData, value: string | number) => {
    onRuleChange({ ...rule, [field]: value })
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <i className={scope.type === 'cluster' ? 'ri-cloud-line' : 'ri-shield-line'} style={{ fontSize: 20 }} />
          {isNew ? t('networkPage.addRuleTitle') : t('networkPage.editRuleTitle')}
          <Chip label={scopeLabel} size="small" sx={{ ml: 1, height: 22, fontSize: 11, fontWeight: 600, bgcolor: alpha(scopeColor, 0.15), color: scopeColor }} />
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Type</InputLabel>
              <Select value={rule.type} label="Type" onChange={(e) => set('type', e.target.value)}>
                <MenuItem value="in">IN</MenuItem>
                <MenuItem value="out">OUT</MenuItem>
                {showGroupType && <MenuItem value="group">GROUP (Security Group)</MenuItem>}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>Action</InputLabel>
              {isGroup ? (
                <Select value={rule.action} label="Action" onChange={(e) => set('action', e.target.value)}>
                  {securityGroups.map(sg => (<MenuItem key={sg.group} value={sg.group}>{sg.group}</MenuItem>))}
                </Select>
              ) : (
                <Select value={rule.action} label="Action" onChange={(e) => set('action', e.target.value)}>
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              )}
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('common.active')}</InputLabel>
              <Select value={rule.enable} label={t('common.active')} onChange={(e) => set('enable', Number(e.target.value))}>
                <MenuItem value={1}>{t('networkPage.active')}</MenuItem>
                <MenuItem value={0}>{t('networkPage.inactive')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          {!isGroup && (
            <>
              <Grid size={{ xs: 12, sm: 4 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('network.protocol')}</InputLabel>
                  <Select value={rule.proto} label={t('network.protocol')} onChange={(e) => set('proto', e.target.value)}>
                    <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                    <MenuItem value="tcp">TCP</MenuItem>
                    <MenuItem value="udp">UDP</MenuItem>
                    <MenuItem value="icmp">ICMP</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label={t('network.source')} value={rule.source} onChange={(e) => set('source', e.target.value)} placeholder="IP, CIDR, alias..." InputProps={{ sx: monoStyle }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label={t('network.destination')} value={rule.dest} onChange={(e) => set('dest', e.target.value)} placeholder="IP, CIDR, alias..." InputProps={{ sx: monoStyle }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label={t('network.destPort')} value={rule.dport} onChange={(e) => set('dport', e.target.value)} placeholder="22, 80, 443..." InputProps={{ sx: monoStyle }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label="Port source" value={rule.sport} onChange={(e) => set('sport', e.target.value)} InputProps={{ sx: monoStyle }} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label="Interface" value={rule.iface} onChange={(e) => set('iface', e.target.value)} placeholder="vmbr0, eth0..." InputProps={{ sx: monoStyle }} />
              </Grid>
            </>
          )}
          <Grid size={{ xs: 12 }}>
            <TextField fullWidth size="small" label={t('network.comment')} value={rule.comment} onChange={(e) => set('comment', e.target.value)} />
          </Grid>
        </Grid>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button variant="contained" onClick={onSubmit} startIcon={<i className={isNew ? 'ri-add-line' : 'ri-check-line'} />}>
          {isNew ? t('common.add') : t('common.save')}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
