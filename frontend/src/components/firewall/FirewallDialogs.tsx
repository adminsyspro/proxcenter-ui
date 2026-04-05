'use client'

import React from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

import type { FirewallRule, SecurityGroup } from './types'
import { MONO_STYLE } from './shared'

interface AutocompleteOption {
  label: string
  secondary?: string
}

interface FirewallDialogsProps {
  // Add Rule dialog
  addRuleOpen: boolean
  setAddRuleOpen: (open: boolean) => void
  newRule: Partial<FirewallRule>
  setNewRule: (rule: Partial<FirewallRule> | ((prev: Partial<FirewallRule>) => Partial<FirewallRule>)) => void
  saving: boolean
  onAddRule: () => void

  // Add Security Group dialog
  addGroupOpen: boolean
  setAddGroupOpen: (open: boolean) => void
  selectedGroup: string
  setSelectedGroup: (group: string) => void
  availableGroups: SecurityGroup[]
  onAddSecurityGroup: () => void

  // Edit Rule dialog
  editRuleOpen: boolean
  setEditRuleOpen: (open: boolean) => void
  editingRule: FirewallRule | null
  setEditingRule: (rule: FirewallRule | null | ((prev: FirewallRule | null) => FirewallRule | null)) => void
  onUpdateRule: () => void

  // Delete Confirmation dialog
  deleteConfirmOpen: boolean
  setDeleteConfirmOpen: (open: boolean) => void
  ruleToDelete: number | null
  onDeleteRule: () => void

  // Optional: autocomplete options for source/dest (VM scope)
  autocompleteOptions?: AutocompleteOption[]

  // Type label for add rule direction field (VM uses "Direction", Node/Cluster uses "Type")
  directionLabel?: string
}

export default function FirewallDialogs({
  addRuleOpen,
  setAddRuleOpen,
  newRule,
  setNewRule,
  saving,
  onAddRule,
  addGroupOpen,
  setAddGroupOpen,
  selectedGroup,
  setSelectedGroup,
  availableGroups,
  onAddSecurityGroup,
  editRuleOpen,
  setEditRuleOpen,
  editingRule,
  setEditingRule,
  onUpdateRule,
  deleteConfirmOpen,
  setDeleteConfirmOpen,
  ruleToDelete,
  onDeleteRule,
  autocompleteOptions,
  directionLabel,
}: FirewallDialogsProps) {
  const theme = useTheme()
  const t = useTranslations()
  const typeLabel = directionLabel || 'Type'

  const renderAutocompleteOption = (props: React.HTMLAttributes<HTMLLIElement>, opt: string | AutocompleteOption) => (
    <li {...props} key={typeof opt === 'string' ? opt : opt.label}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
        <code style={{ fontSize: 12 }}>{typeof opt === 'string' ? opt : opt.label}</code>
        {typeof opt !== 'string' && opt.secondary && (
          <span style={{ fontSize: 11, opacity: 0.6, marginLeft: 8 }}>{opt.secondary}</span>
        )}
      </Box>
    </li>
  )

  const renderSourceDestFields = (
    sourceValue: string,
    destValue: string,
    onSourceChange: (v: string) => void,
    onDestChange: (v: string) => void,
  ) => {
    if (autocompleteOptions) {
      return (
        <>
          <Grid size={{ xs: 6 }}>
            <Autocomplete
              freeSolo
              options={autocompleteOptions}
              getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
              inputValue={sourceValue}
              onInputChange={(_, v) => onSourceChange(v)}
              renderOption={renderAutocompleteOption}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Source"
                  fullWidth
                  size="small"
                  placeholder="IP, CIDR, alias, +ipset"
                  helperText="CIDR, alias, ou +ipset"
                  InputProps={{ ...params.InputProps, sx: MONO_STYLE }}
                />
              )}
            />
          </Grid>
          <Grid size={{ xs: 6 }}>
            <Autocomplete
              freeSolo
              options={autocompleteOptions}
              getOptionLabel={(opt) => typeof opt === 'string' ? opt : opt.label}
              inputValue={destValue}
              onInputChange={(_, v) => onDestChange(v)}
              renderOption={renderAutocompleteOption}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label="Destination"
                  fullWidth
                  size="small"
                  placeholder="IP, CIDR, alias, +ipset"
                  helperText="CIDR, alias, ou +ipset"
                  InputProps={{ ...params.InputProps, sx: MONO_STYLE }}
                />
              )}
            />
          </Grid>
        </>
      )
    }

    return (
      <>
        <Grid size={{ xs: 6 }}>
          <TextField
            label="Source"
            value={sourceValue}
            onChange={(e) => onSourceChange(e.target.value)}
            placeholder="any, 10.0.0.0/8, alias"
            fullWidth
            size="small"
            helperText="CIDR, alias, ou +ipset"
            InputProps={{ sx: MONO_STYLE }}
          />
        </Grid>
        <Grid size={{ xs: 6 }}>
          <TextField
            label="Destination"
            value={destValue}
            onChange={(e) => onDestChange(e.target.value)}
            placeholder="any, 10.0.0.0/8, alias"
            fullWidth
            size="small"
            helperText="CIDR, alias, ou +ipset"
            InputProps={{ sx: MONO_STYLE }}
          />
        </Grid>
      </>
    )
  }

  return (
    <>
      {/* Add Rule Dialog */}
      <Dialog open={addRuleOpen} onClose={() => setAddRuleOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>{t('network.addRule')}</DialogTitle>
        <DialogContent>
          <Grid container spacing={2} sx={{ mt: 1 }}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{typeLabel}</InputLabel>
                <Select
                  value={newRule.type || 'in'}
                  label={typeLabel}
                  onChange={(e) => setNewRule({ ...newRule, type: e.target.value })}
                >
                  <MenuItem value="in">IN</MenuItem>
                  <MenuItem value="out">OUT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>Action</InputLabel>
                <Select
                  value={newRule.action || 'ACCEPT'}
                  label="Action"
                  onChange={(e) => setNewRule({ ...newRule, action: e.target.value })}
                >
                  <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                  <MenuItem value="DROP">DROP</MenuItem>
                  <MenuItem value="REJECT">REJECT</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('network.protocol')}</InputLabel>
                <Select
                  value={newRule.proto || ''}
                  label={t('network.protocol')}
                  onChange={(e) => setNewRule({ ...newRule, proto: e.target.value })}
                >
                  <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                  <MenuItem value="tcp">TCP</MenuItem>
                  <MenuItem value="udp">UDP</MenuItem>
                  <MenuItem value="icmp">ICMP</MenuItem>
                </Select>
              </FormControl>
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <TextField
                label={t('network.destPort')}
                value={newRule.dport || ''}
                onChange={(e) => setNewRule({ ...newRule, dport: e.target.value })}
                placeholder="22, 80:443"
                fullWidth
                size="small"
                InputProps={{ sx: MONO_STYLE }}
              />
            </Grid>
            {renderSourceDestFields(
              newRule.source || '',
              newRule.dest || '',
              (v) => setNewRule((prev: Partial<FirewallRule>) => ({ ...prev, source: v })),
              (v) => setNewRule((prev: Partial<FirewallRule>) => ({ ...prev, dest: v })),
            )}
            <Grid size={{ xs: 12 }}>
              <TextField
                label={t('network.comment')}
                value={newRule.comment || ''}
                onChange={(e) => setNewRule({ ...newRule, comment: e.target.value })}
                fullWidth
                size="small"
              />
            </Grid>
          </Grid>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddRuleOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={onAddRule} disabled={saving}>{t('common.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Add Security Group Dialog */}
      <Dialog open={addGroupOpen} onClose={() => { setAddGroupOpen(false); setSelectedGroup(''); }} maxWidth="sm" fullWidth>
        <DialogTitle>{t('network.addSecurityGroup')}</DialogTitle>
        <DialogContent>
          <FormControl fullWidth size="small" sx={{ mt: 2 }}>
            <InputLabel>Security Group</InputLabel>
            <Select
              value={selectedGroup}
              label="Security Group"
              onChange={(e) => setSelectedGroup(e.target.value as string)}
              renderValue={(value) => value}
            >
              {availableGroups.map((g) => (
                <MenuItem key={g.group} value={g.group}>
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>{g.group}</Typography>
                    {g.comment && (
                      <Typography variant="caption" color="text.secondary">{g.comment}</Typography>
                    )}
                  </Box>
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {selectedGroup && (
            <Box sx={{ mt: 2 }}>
              <Alert severity="info">
                {t('network.securityGroupRulesApplied', { name: selectedGroup })}
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setAddGroupOpen(false); setSelectedGroup(''); }}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={onAddSecurityGroup} disabled={saving || !selectedGroup}>{t('common.add')}</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Rule Dialog */}
      <Dialog open={editRuleOpen} onClose={() => setEditRuleOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>
          {editingRule?.type === 'group' ? t('network.editSecurityGroup') : t('network.editRule')}
        </DialogTitle>
        <DialogContent>
          {editingRule?.type === 'group' ? (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  label="Security Group"
                  value={editingRule?.action || ''}
                  fullWidth
                  size="small"
                  disabled
                  InputProps={{
                    sx: MONO_STYLE,
                    startAdornment: <i className="ri-shield-check-line" style={{ marginRight: 8, color: theme.palette.primary.main }} />
                  }}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <FormControlLabel
                  control={
                    <Switch
                      checked={editingRule?.enable === 1}
                      onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, enable: e.target.checked ? 1 : 0 } : null)}
                      color="success"
                    />
                  }
                  label={t('common.enabled')}
                />
              </Grid>
              <Grid size={{ xs: 12 }}>
                <TextField
                  label={t('network.comment')}
                  value={editingRule?.comment || ''}
                  onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, comment: e.target.value } : null)}
                  fullWidth
                  size="small"
                  placeholder={t('network.optionalDescription')}
                />
              </Grid>
            </Grid>
          ) : (
            <Grid container spacing={2} sx={{ mt: 1 }}>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{typeLabel}</InputLabel>
                  <Select
                    value={editingRule?.type || 'in'}
                    label={typeLabel}
                    onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, type: e.target.value } : null)}
                  >
                    <MenuItem value="in">IN</MenuItem>
                    <MenuItem value="out">OUT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>Action</InputLabel>
                  <Select
                    value={editingRule?.action || 'ACCEPT'}
                    label="Action"
                    onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, action: e.target.value } : null)}
                  >
                    <MenuItem value="ACCEPT">ACCEPT</MenuItem>
                    <MenuItem value="DROP">DROP</MenuItem>
                    <MenuItem value="REJECT">REJECT</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <FormControl fullWidth size="small">
                  <InputLabel>{t('network.protocol')}</InputLabel>
                  <Select
                    value={editingRule?.proto || ''}
                    label={t('network.protocol')}
                    onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, proto: e.target.value } : null)}
                  >
                    <MenuItem value="">{t('network.allProtocols')}</MenuItem>
                    <MenuItem value="tcp">TCP</MenuItem>
                    <MenuItem value="udp">UDP</MenuItem>
                    <MenuItem value="icmp">ICMP</MenuItem>
                  </Select>
                </FormControl>
              </Grid>
              <Grid size={{ xs: 6, sm: 3 }}>
                <TextField
                  label={t('network.destPort')}
                  value={editingRule?.dport || ''}
                  onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, dport: e.target.value } : null)}
                  fullWidth
                  size="small"
                  InputProps={{ sx: MONO_STYLE }}
                />
              </Grid>
              {renderSourceDestFields(
                editingRule?.source || '',
                editingRule?.dest || '',
                (v) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, source: v } : null),
                (v) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, dest: v } : null),
              )}
              <Grid size={{ xs: 12 }}>
                <TextField
                  label={t('network.comment')}
                  value={editingRule?.comment || ''}
                  onChange={(e) => setEditingRule((prev: FirewallRule | null) => prev ? { ...prev, comment: e.target.value } : null)}
                  fullWidth
                  size="small"
                />
              </Grid>
            </Grid>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditRuleOpen(false)}>{t('common.cancel')}</Button>
          <Button variant="contained" onClick={onUpdateRule} disabled={saving}>{t('common.save')}</Button>
        </DialogActions>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteConfirmOpen} onClose={() => setDeleteConfirmOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>{t('common.confirmDelete')}</DialogTitle>
        <DialogContent>
          <Typography>{t('common.deleteConfirmation')}</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => { setDeleteConfirmOpen(false); }}>{t('common.cancel')}</Button>
          <Button variant="contained" color="error" onClick={onDeleteRule} disabled={saving}>
            {t('common.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
