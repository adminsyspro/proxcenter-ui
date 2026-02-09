'use client'

import { useState, useEffect } from 'react'
import { useTranslations } from 'next-intl'

import {
  Box,
  Typography,
  Switch,
  FormControlLabel,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Stack,
  Button,
  Divider,
  Alert,
  Grid,
  Slider,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
  CircularProgress,
} from '@mui/material'
// RemixIcon replacements for @mui/icons-material
const ExpandMoreIcon = (props: any) => <i className="ri-arrow-down-s-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SaveIcon = (props: any) => <i className="ri-save-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const WarningIcon = (props: any) => <i className="ri-alert-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const SpeedIcon = (props: any) => <i className="ri-speed-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const MemoryIcon = (props: any) => <i className="ri-cpu-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const LocalOfferIcon = (props: any) => <i className="ri-price-tag-3-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const StorageIcon = (props: any) => <i className="ri-hard-drive-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const InfoIcon = (props: any) => <i className="ri-information-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

// ============================================
// Types
// ============================================

export interface DRSSettings {
  enabled: boolean
  mode: 'manual' | 'partial' | 'automatic'
  balancing_method: 'memory' | 'cpu' | 'disk'
  balancing_mode: 'used' | 'assigned' | 'psi'
  balance_types: ('vm' | 'ct')[]
  maintenance_nodes: string[]
  ignore_nodes: string[]
  cpu_high_threshold: number
  cpu_low_threshold: number
  memory_high_threshold: number
  memory_low_threshold: number
  storage_high_threshold: number
  imbalance_threshold: number
  cpu_weight: number
  memory_weight: number
  storage_weight: number
  max_concurrent_migrations: number
  migration_cooldown: string
  balance_larger_first: boolean
  prevent_overprovisioning: boolean
  enable_affinity_rules: boolean
  enforce_affinity: boolean
}

export interface ClusterVersionInfo {
  connectionId: string
  name: string
  version: number // Major version (8 or 9)
}

interface DRSSettingsPanelProps {
  settings: DRSSettings
  nodes: string[]
  clusterVersions?: ClusterVersionInfo[]
  onSave: (settings: DRSSettings) => Promise<void>
  loading?: boolean
}

// ============================================
// Default settings
// ============================================

export const defaultDRSSettings: DRSSettings = {
  enabled: true,
  mode: 'manual',
  balancing_method: 'memory',
  balancing_mode: 'used',
  balance_types: ['vm', 'ct'],
  maintenance_nodes: [],
  ignore_nodes: [],
  cpu_high_threshold: 80,
  cpu_low_threshold: 20,
  memory_high_threshold: 85,
  memory_low_threshold: 25,
  storage_high_threshold: 90,
  imbalance_threshold: 5,
  cpu_weight: 1.0,
  memory_weight: 1.0,
  storage_weight: 0.5,
  max_concurrent_migrations: 2,
  migration_cooldown: '5m',
  balance_larger_first: false,
  prevent_overprovisioning: true,
  enable_affinity_rules: true,
  enforce_affinity: false,
}

// ============================================
// Component
// ============================================

export default function DRSSettingsPanel({
  settings: initialSettings,
  nodes,
  clusterVersions = [],
  onSave,
  loading = false
}: DRSSettingsPanelProps) {
  const t = useTranslations()
  const [settings, setSettings] = useState<DRSSettings>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState<string | false>('general')
  const [hasChanges, setHasChanges] = useState(false)

  // Check PSI support
  const hasPSISupport = clusterVersions.some(v => v.version >= 9)
  const allSupportPSI = clusterVersions.length > 0 && clusterVersions.every(v => v.version >= 9)
  const pve8Clusters = clusterVersions.filter(v => v.version < 9)

  useEffect(() => {
    setSettings(initialSettings)
    setHasChanges(false)
  }, [initialSettings])

  const handleChange = <K extends keyof DRSSettings>(key: K, value: DRSSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    setHasChanges(true)
  }

  const handleSave = async () => {
    setSaving(true)

    try {
      await onSave(settings)
      setHasChanges(false)
    } finally {
      setSaving(false)
    }
  }

  const handleAccordion = (panel: string) => (_: any, isExpanded: boolean) => {
    setExpanded(isExpanded ? panel : false)
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  return (
    <Box>
      {/* Save button header */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? t('common.saving') : hasChanges ? t('common.save') : t('common.save')}
        </Button>
      </Box>

      {/* PSI Warning for mixed environments */}
      {settings.balancing_mode === 'psi' && !allSupportPSI && pve8Clusters.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }} icon={<WarningIcon />}>
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {t('drsPage.psiMixedEnvironment')}
          </Typography>
          <Typography variant="body2">
            {t('drsPage.psiPve8Fallback', { clusters: pve8Clusters.map(c => c.name).join(', ') })}
          </Typography>
        </Alert>
      )}

      {/* General Settings */}
      <Accordion expanded={expanded === 'general'} onChange={handleAccordion('general')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <SpeedIcon sx={{ mr: 2, color: 'primary.main' }} />
          <Typography sx={{ fontWeight: 600 }}>{t('drs.generalSettings')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enabled}
                    onChange={(e) => handleChange('enabled', e.target.checked)}
                    color="primary"
                  />
                }
                label={
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 500 }}>{t('drs.drsEnabled')}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {t('drsPage.enablesAnalysisRecommendations')}
                    </Typography>
                  </Box>
                }
              />
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('drsPage.operationMode')}</InputLabel>
                <Select
                  value={settings.mode}
                  label={t('drsPage.operationMode')}
                  onChange={(e) => handleChange('mode', e.target.value as DRSSettings['mode'])}
                >
                  <MenuItem value="manual">
                    <Box>
                      <Typography variant="body2">{t('drsPage.modeManual')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.modeManualDesc')}
                      </Typography>
                    </Box>
                  </MenuItem>
                  <MenuItem value="partial">
                    <Box>
                      <Typography variant="body2">{t('drsPage.modePartial')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.modePartialDesc')}
                      </Typography>
                    </Box>
                  </MenuItem>
                  <MenuItem value="automatic">
                    <Box>
                      <Typography variant="body2">{t('drsPage.modeAutomatic')}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {t('drsPage.modeAutomaticDesc')}
                      </Typography>
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('drsPage.priorityResource')}</InputLabel>
                <Select
                  value={settings.balancing_method}
                  label={t('drsPage.priorityResource')}
                  onChange={(e) => handleChange('balancing_method', e.target.value as DRSSettings['balancing_method'])}
                >
                  <MenuItem value="memory">{t('drsPage.memoryResource')}</MenuItem>
                  <MenuItem value="cpu">{t('drsPage.cpuResource')}</MenuItem>
                  <MenuItem value="disk">{t('drsPage.diskResource')}</MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12, md: 6 }}>
              <FormControl fullWidth size="small">
                <InputLabel>{t('drsPage.measurementMode')}</InputLabel>
                <Select
                  value={settings.balancing_mode}
                  label={t('drsPage.measurementMode')}
                  onChange={(e) => handleChange('balancing_mode', e.target.value as DRSSettings['balancing_mode'])}
                >
                  <MenuItem value="used">{t('drsPage.usedMode')}</MenuItem>
                  <MenuItem value="assigned">{t('drsPage.assignedMode')}</MenuItem>
                  <MenuItem value="psi" disabled={!hasPSISupport}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      PSI (Pressure Stall Info)
                      {!hasPSISupport && (
                        <Chip label="PVE 9+" size="small" color="warning" />
                      )}
                    </Box>
                  </MenuItem>
                </Select>
              </FormControl>
            </Grid>

            <Grid size={{ xs: 12 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('drsPage.guestTypesToBalance')}</Typography>
              <Stack direction="row" spacing={1}>
                <Chip
                  label="VMs (QEMU)"
                  color={settings.balance_types.includes('vm') ? 'primary' : 'default'}
                  onClick={() => {
                    const types = settings.balance_types.includes('vm')
                      ? settings.balance_types.filter(t => t !== 'vm')
                      : [...settings.balance_types, 'vm' as const]

                    handleChange('balance_types', types)
                  }}
                  variant={settings.balance_types.includes('vm') ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer' }}
                />
                <Chip
                  label="Containers (LXC)"
                  color={settings.balance_types.includes('ct') ? 'primary' : 'default'}
                  onClick={() => {
                    const types = settings.balance_types.includes('ct')
                      ? settings.balance_types.filter(t => t !== 'ct')
                      : [...settings.balance_types, 'ct' as const]

                    handleChange('balance_types', types)
                  }}
                  variant={settings.balance_types.includes('ct') ? 'filled' : 'outlined'}
                  sx={{ cursor: 'pointer' }}
                />
              </Stack>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Thresholds */}
      <Accordion expanded={expanded === 'thresholds'} onChange={handleAccordion('thresholds')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <MemoryIcon sx={{ mr: 2, color: 'warning.main' }} />
          <Typography sx={{ fontWeight: 600 }}>{t('drsPage.thresholds')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={3}>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('drsPage.cpuHighThreshold', { value: settings.cpu_high_threshold })}
              </Typography>
              <Slider
                value={settings.cpu_high_threshold}
                onChange={(_, v) => handleChange('cpu_high_threshold', v as number)}
                min={50}
                max={100}
                valueLabelDisplay="auto"
                color="error"
              />
              <Typography variant="caption" color="text.secondary">
                {t('drs.hotNodeThreshold')}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('drsPage.cpuLowThreshold', { value: settings.cpu_low_threshold })}
              </Typography>
              <Slider
                value={settings.cpu_low_threshold}
                onChange={(_, v) => handleChange('cpu_low_threshold', v as number)}
                min={0}
                max={50}
                valueLabelDisplay="auto"
                color="success"
              />
              <Typography variant="caption" color="text.secondary">
                {t('drs.coldNodeThreshold')}
              </Typography>
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('drsPage.memoryHighThreshold', { value: settings.memory_high_threshold })}
              </Typography>
              <Slider
                value={settings.memory_high_threshold}
                onChange={(_, v) => handleChange('memory_high_threshold', v as number)}
                min={50}
                max={100}
                valueLabelDisplay="auto"
                color="error"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('drsPage.memoryLowThreshold', { value: settings.memory_low_threshold })}
              </Typography>
              <Slider
                value={settings.memory_low_threshold}
                onChange={(_, v) => handleChange('memory_low_threshold', v as number)}
                min={0}
                max={50}
                valueLabelDisplay="auto"
                color="success"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <Typography variant="subtitle2" gutterBottom>
                {t('drsPage.imbalanceThreshold', { value: settings.imbalance_threshold })}
              </Typography>
              <Slider
                value={settings.imbalance_threshold}
                onChange={(_, v) => handleChange('imbalance_threshold', v as number)}
                min={1}
                max={20}
                step={0.5}
                valueLabelDisplay="auto"
              />
              <Typography variant="caption" color="text.secondary">
                {t('drsPage.imbalanceThresholdDesc')}
              </Typography>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Affinity Rules */}
      <Accordion expanded={expanded === 'affinity'} onChange={handleAccordion('affinity')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <LocalOfferIcon sx={{ mr: 2, color: 'secondary.main' }} />
          <Typography sx={{ fontWeight: 600 }}>{t('drs.affinityRules')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enable_affinity_rules}
                    onChange={(e) => handleChange('enable_affinity_rules', e.target.checked)}
                  />
                }
                label={t('drsPage.enableAffinityRules')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.enforce_affinity}
                    onChange={(e) => handleChange('enforce_affinity', e.target.checked)}
                    disabled={!settings.enable_affinity_rules}
                  />
                }
                label={t('drsPage.enforceAffinityRules')}
              />
            </Grid>
            <Grid size={{ xs: 12 }}>
              <Alert severity="info" icon={<InfoIcon />}>
                <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                  {t('drsPage.supportedProxmoxTags')}
                </Typography>
                <Box component="ul" sx={{ m: 0, pl: 2 }}>
                  <li><code>pxc_ignore_*</code> — {t('drsPage.tagIgnore')}</li>
                  <li><code>pxc_pin_nodename</code> — {t('drsPage.tagPin')}</li>
                  <li><code>pxc_affinity_groupname</code> — {t('drsPage.tagAffinity')}</li>
                  <li><code>pxc_anti_affinity_groupname</code> — {t('drsPage.tagAntiAffinity')}</li>
                </Box>
              </Alert>
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>

      {/* Advanced Options */}
      <Accordion expanded={expanded === 'advanced'} onChange={handleAccordion('advanced')}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <StorageIcon sx={{ mr: 2, color: 'text.secondary' }} />
          <Typography sx={{ fontWeight: 600 }}>{t('drsPage.advancedOptions')}</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                type="number"
                label={t('drsPage.maxConcurrentMigrations')}
                value={settings.max_concurrent_migrations}
                onChange={(e) => handleChange('max_concurrent_migrations', parseInt(e.target.value) || 1)}
                inputProps={{ min: 1, max: 10 }}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <TextField
                fullWidth
                size="small"
                label={t('drsPage.cooldownBetweenMigrations')}
                value={settings.migration_cooldown}
                onChange={(e) => handleChange('migration_cooldown', e.target.value)}
                helperText={t('drsPage.cooldownExample')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.balance_larger_first}
                    onChange={(e) => handleChange('balance_larger_first', e.target.checked)}
                  />
                }
                label={t('drsPage.migrateLargerFirst')}
              />
            </Grid>
            <Grid size={{ xs: 12, md: 6 }}>
              <FormControlLabel
                control={
                  <Switch
                    checked={settings.prevent_overprovisioning}
                    onChange={(e) => handleChange('prevent_overprovisioning', e.target.checked)}
                  />
                }
                label={t('drsPage.preventOverprovisioning')}
              />
            </Grid>
          </Grid>

          <Divider sx={{ my: 2 }} />

          <Typography variant="subtitle2" sx={{ mb: 2 }}>{t('drsPage.resourceWeights')}</Typography>
          <Grid container spacing={2}>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="caption">{t('drsPage.cpuWeight', { value: settings.cpu_weight.toFixed(1) })}</Typography>
              <Slider
                value={settings.cpu_weight}
                onChange={(_, v) => handleChange('cpu_weight', v as number)}
                min={0}
                max={2}
                step={0.1}
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="caption">{t('drsPage.memoryWeight', { value: settings.memory_weight.toFixed(1) })}</Typography>
              <Slider
                value={settings.memory_weight}
                onChange={(_, v) => handleChange('memory_weight', v as number)}
                min={0}
                max={2}
                step={0.1}
                valueLabelDisplay="auto"
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <Typography variant="caption">{t('drsPage.storageWeight', { value: settings.storage_weight.toFixed(1) })}</Typography>
              <Slider
                value={settings.storage_weight}
                onChange={(_, v) => handleChange('storage_weight', v as number)}
                min={0}
                max={2}
                step={0.1}
                valueLabelDisplay="auto"
              />
            </Grid>
          </Grid>
        </AccordionDetails>
      </Accordion>
    </Box>
  )
}
