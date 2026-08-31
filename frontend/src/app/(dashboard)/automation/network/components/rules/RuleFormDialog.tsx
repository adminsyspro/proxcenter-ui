'use client'

import { useTranslations } from 'next-intl'

import {
  Alert, Box, Button, Chip, Dialog, DialogTitle, DialogContent, DialogActions,
  FormControl, Grid, InputLabel, MenuItem, Select, TextField, alpha
} from '@mui/material'

import * as firewallAPI from '@/lib/api/firewall'
import LogLevelSelect from '@/components/firewall/LogLevelSelect'
import AliasIpsetAutocomplete, { useAliasIpsetOptions } from './shared/AliasIpsetAutocomplete'

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
  scope: { type: 'cluster' | 'security-group' | 'vm'; name?: string }
  rule: RuleFormData
  onRuleChange: (rule: RuleFormData) => void
  securityGroups: firewallAPI.SecurityGroup[]
  aliases: firewallAPI.Alias[]
  ipsets: firewallAPI.IPSet[]
  /** Warning shown above the form (e.g. the rule belongs to a shared SG). */
  notice?: string
}

const scopeColors: Record<string, string> = {
  cluster: '#06b6d4',
  'security-group': '#8b5cf6',
  vm: '#22c55e',
}

const scopeIcons: Record<string, string> = {
  cluster: 'ri-cloud-line',
  'security-group': 'ri-shield-line',
  vm: 'ri-computer-line',
}

export default function RuleFormDialog({
  open, onClose, onSubmit, isNew, scope, rule, onRuleChange, securityGroups, aliases, ipsets, notice
}: RuleFormDialogProps) {
  const t = useTranslations()

  const isGroup = rule.type === 'group'
  const scopeColor = scopeColors[scope.type] || '#3b82f6'
  const scopeLabel = scope.type === 'cluster'
    ? t('firewall.cluster')
    : scope.type === 'vm' ? (scope.name ?? '') : t('firewall.sgPrefix', { name: scope.name })
  const showGroupType = scope.type === 'cluster' // only cluster rules can be of type 'group'

  const set = (field: keyof RuleFormData, value: string | number) => {
    onRuleChange({ ...rule, [field]: value })
  }

  const autocompleteOptions = useAliasIpsetOptions(aliases, ipsets)

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <i className={scopeIcons[scope.type] || 'ri-shield-line'} style={{ fontSize: 20 }} />
          {isNew ? t('networkPage.addRuleTitle') : t('networkPage.editRuleTitle')}
          <Chip label={scopeLabel} size="small" sx={{ ml: 1, height: 22, fontSize: 11, fontWeight: 600, bgcolor: alpha(scopeColor, 0.15), color: scopeColor }} />
        </Box>
      </DialogTitle>
      <DialogContent sx={{ pt: 2 }}>
        {notice && <Alert severity='warning' sx={{ mb: 2 }}>{notice}</Alert>}
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('firewall.type')}</InputLabel>
              <Select value={rule.type} label={t('firewall.type')} onChange={(e) => set('type', e.target.value)}>
                <MenuItem value="in">IN</MenuItem>
                <MenuItem value="out">OUT</MenuItem>
                {showGroupType && <MenuItem value="group">{t('firewall.typeGroup')}</MenuItem>}
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, sm: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('firewall.action')}</InputLabel>
              {isGroup ? (
                <Select value={rule.action} label={t('firewall.action')} onChange={(e) => set('action', e.target.value)}>
                  {securityGroups.map(sg => (<MenuItem key={sg.group} value={sg.group}>{sg.group}</MenuItem>))}
                </Select>
              ) : (
                <Select value={rule.action} label={t('firewall.action')} onChange={(e) => set('action', e.target.value)}>
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
                <AliasIpsetAutocomplete
                  options={autocompleteOptions}
                  value={rule.source}
                  onChange={(v) => set('source', v)}
                  label={t('network.source')}
                  placeholder="IP, CIDR, alias..."
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <AliasIpsetAutocomplete
                  options={autocompleteOptions}
                  value={rule.dest}
                  onChange={(v) => set('dest', v)}
                  label={t('network.destination')}
                  placeholder="IP, CIDR, alias..."
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label={t('network.destPort')} value={rule.dport} onChange={(e) => set('dport', e.target.value)} placeholder="22, 80, 443..." />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label={t('firewall.sourcePort')} value={rule.sport} onChange={(e) => set('sport', e.target.value)} />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <TextField fullWidth size="small" label={t('firewall.interface')} value={rule.iface} onChange={(e) => set('iface', e.target.value)} placeholder="vmbr0, eth0..." />
              </Grid>
              <Grid size={{ xs: 12, sm: 4 }}>
                <LogLevelSelect value={rule.log} onChange={(v) => set('log', v)} />
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
