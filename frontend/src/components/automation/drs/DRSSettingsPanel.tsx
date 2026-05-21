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
  Tooltip,
  CircularProgress,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Tabs,
  Tab,
  Autocomplete,
  useMediaQuery,
  useTheme,
  alpha,
} from '@mui/material'
// RemixIcon replacements for @mui/icons-material
const SaveIcon = (props: any) => <i className="ri-save-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const WarningIcon = (props: any) => <i className="ri-alert-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />
const InfoIcon = (props: any) => <i className="ri-information-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: props?.sx?.color, ...props?.style }} />

// Help tooltip component
const HelpTip = ({ text }: { text: string }) => (
  <Tooltip
    title={text}
    arrow
    placement="top"
    slotProps={{
      tooltip: {
        sx: {
          bgcolor: 'background.paper',
          color: 'text.primary',
          border: '1px solid',
          borderColor: 'divider',
          borderRadius: 1.5,
          boxShadow: 3,
          fontSize: 12,
          maxWidth: 320,
        },
      },
      arrow: {
        sx: {
          color: 'background.paper',
          '&::before': {
            border: '1px solid',
            borderColor: 'divider',
          },
        },
      },
    }}
  >
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', ml: 0.5, cursor: 'help', opacity: 0.5, '&:hover': { opacity: 1 } }}>
      <i className="ri-question-line" style={{ fontSize: 16 }} />
    </Box>
  </Tooltip>
)

// SubsectionHeader factorises the "icon + bold subtitle (+ optional help
// tooltip)" pattern used to introduce each block in the Advanced section.
// Three repeated blocks were tripping SonarCloud's duplication detector.
interface SubsectionHeaderProps {
  icon: string
  label: string
  help?: string
  mb?: number
}

const SubsectionHeader = ({ icon, label, help, mb = 1.5 }: SubsectionHeaderProps) => (
  <Typography variant="subtitle2" sx={{ mb, fontWeight: 600 }}>
    <i className={icon} style={{ fontSize: 18, marginRight: 8, verticalAlign: 'middle' }} />
    {label}
    {help && <HelpTip text={help} />}
  </Typography>
)

// LabeledSlider factorises the "title + ? tooltip + bounded slider" pattern
// used several times in the Advanced section. Without this, each repeated
// block was tripping SonarCloud's duplication detector.
interface LabeledSliderProps {
  label: string
  help: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  marks: { value: number; label: string }[]
  valueLabelFormat?: (v: number) => string
}

const LabeledSlider = ({ label, help, value, onChange, min, max, step = 1, marks, valueLabelFormat }: LabeledSliderProps) => (
  <>
    <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
      {label}
      <HelpTip text={help} />
    </Typography>
    <Box sx={{ px: 1 }}>
      <Slider
        value={value}
        onChange={(_, val) => onChange(val as number)}
        min={min}
        max={max}
        step={step}
        marks={marks}
        valueLabelDisplay="auto"
        valueLabelFormat={valueLabelFormat}
        size="small"
      />
    </Box>
  </>
)

// ============================================
// Types (shared with the API route — see ./drsSettings)
// ============================================

import { type DRSSettings, type ClusterVersionInfo, defaultDRSSettings } from './drsSettings'
// Re-export so existing consumers of DRSSettingsPanel keep working.
export { type DRSSettings, type ClusterVersionInfo, defaultDRSSettings }

interface DRSSettingsPanelProps {
  settings: DRSSettings
  clusterNodes: Record<string, string[]>
  clusters?: { id: string; name: string }[]
  clusterVersions?: ClusterVersionInfo[]
  onSave: (settings: DRSSettings) => Promise<void>
  loading?: boolean
}

// ============================================
// Section definitions
// ============================================

type SectionKey = 'general' | 'thresholds' | 'affinity' | 'advanced'

const validIntervalOptions = ['15m', '30m', '1h', '2h', '3h', '4h', '6h', '8h', '12h', '24h']

const SECTIONS: { key: SectionKey; icon: string; colorKey: string }[] = [
  { key: 'general', icon: 'ri-speed-line', colorKey: 'primary.main' },
  { key: 'thresholds', icon: 'ri-cpu-line', colorKey: 'warning.main' },
  { key: 'affinity', icon: 'ri-price-tag-3-line', colorKey: 'secondary.main' },
  { key: 'advanced', icon: 'ri-settings-3-line', colorKey: 'text.secondary' },
]

// ============================================
// Component
// ============================================

export default function DRSSettingsPanel({
  settings: initialSettings,
  clusterNodes,
  clusters = [],
  clusterVersions = [],
  onSave,
  loading = false
}: DRSSettingsPanelProps) {
  const t = useTranslations()
  const muiTheme = useTheme()
  const isMobile = useMediaQuery(muiTheme.breakpoints.down('sm'))
  const [settings, setSettings] = useState<DRSSettings>(initialSettings)
  const [saving, setSaving] = useState(false)
  const [activeSection, setActiveSection] = useState<SectionKey>('general')
  const [hasChanges, setHasChanges] = useState(false)

  // Check PSI support
  const hasPSISupport = clusterVersions.some(v => v.version >= 9)
  const allSupportPSI = clusterVersions.length > 0 && clusterVersions.every(v => v.version >= 9)
  const pve8Clusters = clusterVersions.filter(v => v.version < 9)

  useEffect(() => {
    // Fall back to 1h when the persisted value is not one of the options we
    // expose. Sub-1h was once clamped here but is now a first-class choice;
    // this guard now only catches genuinely unknown values (typos, removed
    // options) so the Select doesn't render with an empty/uncontrolled value.
    const normalized = { ...initialSettings }
    if (!validIntervalOptions.includes(normalized.rebalance_interval)) {
      normalized.rebalance_interval = '1h'
    }
    setSettings(normalized)
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

  const sectionLabel = (key: SectionKey) => {
    switch (key) {
      case 'general': return t('drs.generalSettings')
      case 'thresholds': return t('drsPage.thresholds')
      case 'affinity': return t('drs.affinityRules')
      case 'advanced': return t('drsPage.advancedOptions')
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
        <CircularProgress />
      </Box>
    )
  }

  // ── Section content renderers ──

  const renderGeneral = () => (
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

      {settings.mode !== 'manual' && settings.max_concurrent_migrations > 1 && (
        <Grid size={12}>
          <Alert severity="warning" icon={<i className="ri-alert-line" style={{ fontSize: 20 }} />}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('drsPage.concurrentMigrationWarningTitle')}</Typography>
            <Typography variant="caption">
              {t('drsPage.concurrentMigrationWarningDesc')}
            </Typography>
          </Alert>
        </Grid>
      )}

      {/* Active clusters selector */}
      {clusters.length > 0 && (
        <Grid size={{ xs: 12 }}>
          <Autocomplete
            multiple
            options={clusters}
            getOptionLabel={(option) => option.name}
            value={clusters.filter(c => !settings.excluded_clusters.includes(c.id))}
            onChange={(_, selected) => {
              const selectedIds = selected.map(c => c.id)
              const excluded = clusters.filter(c => !selectedIds.includes(c.id)).map(c => c.id)
              handleChange('excluded_clusters', excluded)
            }}
            isOptionEqualToValue={(option, value) => option.id === value.id}
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label={t('drsPage.activeClusters')}
                helperText={
                  settings.excluded_clusters.length === 0
                    ? t('drsPage.allClustersDefault')
                    : t('drsPage.activeClustersHelp')
                }
              />
            )}
            renderTags={(value, getTagProps) =>
              value.map((option, index) => (
                <Chip
                  {...getTagProps({ index })}
                  key={option.id}
                  label={option.name}
                  size="small"
                />
              ))
            }
          />
        </Grid>
      )}

      {/* Per-cluster mode overrides */}
      {clusters.length > 0 && (() => {
        const activeClusters = clusters.filter(c => !settings.excluded_clusters.includes(c.id))
        if (activeClusters.length === 0) return null
        return (
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
              {t('drsPage.clusterModeOverrides')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('drsPage.clusterModeOverridesDesc')}
            </Typography>
            <Stack spacing={1}>
              {activeClusters.map(cluster => (
                <Box key={cluster.id} sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 500 }}>{cluster.name}</Typography>
                  <FormControl size="small" sx={{ minWidth: 220 }}>
                    <Select
                      value={settings.cluster_modes[cluster.id] || ''}
                      displayEmpty
                      onChange={(e) => {
                        const val = e.target.value as string
                        const newModes = { ...settings.cluster_modes }
                        if (val === '') {
                          delete newModes[cluster.id]
                        } else {
                          newModes[cluster.id] = val
                        }
                        handleChange('cluster_modes', newModes)
                      }}
                    >
                      <MenuItem value="">
                        <Typography variant="body2" color="text.secondary">
                          {t('drsPage.clusterModeGlobalDefault', { mode: t(`drsPage.mode${settings.mode.charAt(0).toUpperCase() + settings.mode.slice(1)}`) })}
                        </Typography>
                      </MenuItem>
                      <MenuItem value="manual">{t('drsPage.modeManual')}</MenuItem>
                      <MenuItem value="partial">{t('drsPage.modePartial')}</MenuItem>
                      <MenuItem value="automatic">{t('drsPage.modeAutomatic')}</MenuItem>
                    </Select>
                  </FormControl>
                </Box>
              ))}
            </Stack>
          </Grid>
        )
      })()}

      {/* Per-cluster excluded nodes */}
      {clusters.length > 0 && (() => {
        const activeClusters = clusters.filter(c => !settings.excluded_clusters.includes(c.id))
        if (activeClusters.length === 0) return null
        return (
          <Grid size={{ xs: 12 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5, fontWeight: 600 }}>
              {t('drsPage.excludedNodesTitle')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
              {t('drsPage.excludedNodesDesc')}
            </Typography>
            <Stack spacing={1.5}>
              {activeClusters.map(cluster => {
                const nodesForCluster = clusterNodes[cluster.id] || []
                if (nodesForCluster.length === 0) return null
                return (
                  <Box key={cluster.id} sx={{ display: 'flex', alignItems: 'flex-start', gap: 2 }}>
                    <Typography variant="body2" sx={{ minWidth: 140, fontWeight: 500, mt: 1 }}>{cluster.name}</Typography>
                    <Autocomplete
                      multiple
                      size="small"
                      sx={{ flex: 1 }}
                      options={nodesForCluster}
                      value={settings.excluded_nodes[cluster.id] || []}
                      onChange={(_, selected) => {
                        const newExcluded = { ...settings.excluded_nodes }
                        if (selected.length === 0) {
                          delete newExcluded[cluster.id]
                        } else {
                          newExcluded[cluster.id] = selected
                        }
                        handleChange('excluded_nodes', newExcluded)
                      }}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          placeholder={t('drsPage.excludedNodesPlaceholder')}
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((node, index) => (
                          <Chip
                            {...getTagProps({ index })}
                            key={node}
                            label={node}
                            size="small"
                            color="error"
                            variant="outlined"
                          />
                        ))
                      }
                    />
                  </Box>
                )
              })}
            </Stack>
          </Grid>
        )
      })()}

      {/* Rebalance scheduling — only shown for non-manual modes */}
      {settings.mode !== 'manual' && (
        <>
          <Grid size={{ xs: 12 }}>
            <Divider sx={{ my: 1 }} />
            <Typography variant="subtitle2" sx={{ mt: 1, mb: 1, fontWeight: 600 }}>
              <i className="ri-calendar-schedule-line" style={{ fontSize: 18, marginRight: 8, verticalAlign: 'middle' }} />
              {t('drsPage.rebalanceSchedule')}
            </Typography>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            <FormControl fullWidth size="small">
              <InputLabel>{t('drsPage.rebalanceSchedule')}</InputLabel>
              <Select
                value={settings.rebalance_schedule}
                label={t('drsPage.rebalanceSchedule')}
                onChange={(e) => handleChange('rebalance_schedule', e.target.value as DRSSettings['rebalance_schedule'])}
              >
                <MenuItem value="interval">{t('drsPage.scheduleInterval')}</MenuItem>
                <MenuItem value="daily">{t('drsPage.scheduleDaily')}</MenuItem>
              </Select>
            </FormControl>
          </Grid>
          <Grid size={{ xs: 12, md: 6 }}>
            {settings.rebalance_schedule === 'interval' ? (
              <FormControl fullWidth size="small">
                <InputLabel>{t('drsPage.rebalanceEvery')}</InputLabel>
                <Select
                  value={validIntervalOptions.includes(settings.rebalance_interval) ? settings.rebalance_interval : '1h'}
                  label={t('drsPage.rebalanceEvery')}
                  onChange={(e) => handleChange('rebalance_interval', e.target.value)}
                >
                  <MenuItem value="15m">15 min</MenuItem>
                  <MenuItem value="30m">30 min</MenuItem>
                  <MenuItem value="1h">1 h</MenuItem>
                  <MenuItem value="2h">2 h</MenuItem>
                  <MenuItem value="3h">3 h</MenuItem>
                  <MenuItem value="4h">4 h</MenuItem>
                  <MenuItem value="6h">6 h</MenuItem>
                  <MenuItem value="8h">8 h</MenuItem>
                  <MenuItem value="12h">12 h</MenuItem>
                  <MenuItem value="24h">24 h</MenuItem>
                </Select>
              </FormControl>
            ) : (
              <TextField
                fullWidth
                size="small"
                type="time"
                label={t('drsPage.rebalanceAt')}
                value={settings.rebalance_time}
                onChange={(e) => handleChange('rebalance_time', e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
            )}
          </Grid>
          <Grid size={{ xs: 12 }}>
            <Typography variant="caption" color="text.secondary">
              {settings.rebalance_schedule === 'interval'
                ? t('drsPage.scheduleSummaryInterval', { interval: settings.rebalance_interval })
                : t('drsPage.scheduleSummaryDaily', { time: settings.rebalance_time })}
            </Typography>
          </Grid>
        </>
      )}

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
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('drsPage.helpPriorityResource')}
          </Typography>
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
  )

  const renderThresholds = () => (
    <Grid container spacing={3}>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('drsPage.cpuHighThreshold', { value: settings.cpu_high_threshold })}
          <HelpTip text={t('drsPage.helpCpuHigh')} />
        </Typography>
        <Slider
          value={settings.cpu_high_threshold}
          onChange={(_, v) => handleChange('cpu_high_threshold', v as number)}
          min={50}
          max={100}
          valueLabelDisplay="auto"
          color="error"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('drsPage.cpuLowThreshold', { value: settings.cpu_low_threshold })}
          <HelpTip text={t('drsPage.helpCpuLow')} />
        </Typography>
        <Slider
          value={settings.cpu_low_threshold}
          onChange={(_, v) => handleChange('cpu_low_threshold', v as number)}
          min={0}
          max={50}
          valueLabelDisplay="auto"
          color="success"
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('drsPage.memoryHighThreshold', { value: settings.memory_high_threshold })}
          <HelpTip text={t('drsPage.helpMemoryHigh')} />
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
          <HelpTip text={t('drsPage.helpMemoryLow')} />
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
          <HelpTip text={t('drsPage.helpImbalanceThreshold')} />
        </Typography>
        <Slider
          value={settings.imbalance_threshold}
          onChange={(_, v) => handleChange('imbalance_threshold', v as number)}
          min={1}
          max={20}
          step={0.5}
          valueLabelDisplay="auto"
        />
      </Grid>

      <Grid size={{ xs: 12 }}>
        <Divider sx={{ my: 1 }} />
      </Grid>

      <Grid size={{ xs: 12, md: 6 }}>
        <FormControlLabel
          control={
            <Switch
              checked={settings.homogenization_enabled}
              onChange={(e) => handleChange('homogenization_enabled', e.target.checked)}
              color="primary"
            />
          }
          label={
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {t('drsPage.homogenizationEnabled')}
                <HelpTip text={t('drsPage.helpHomogenization')} />
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {t('drsPage.homogenizationEnabledDesc')}
              </Typography>
            </Box>
          }
        />
      </Grid>
      <Grid size={{ xs: 12, md: 6 }}>
        <Typography variant="subtitle2" gutterBottom>
          {t('drsPage.maxLoadSpread', { value: settings.max_load_spread })}
          <HelpTip text={t('drsPage.helpMaxLoadSpread')} />
        </Typography>
        <Slider
          value={settings.max_load_spread}
          onChange={(_, v) => handleChange('max_load_spread', v as number)}
          min={1}
          max={20}
          step={0.5}
          valueLabelDisplay="auto"
          disabled={!settings.homogenization_enabled}
        />
      </Grid>
    </Grid>
  )

  const renderAffinity = () => (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, md: 6 }}>
        <FormControlLabel
          control={
            <Switch
              checked={settings.enable_affinity_rules}
              onChange={(e) => handleChange('enable_affinity_rules', e.target.checked)}
            />
          }
          label={<>{t('drsPage.enableAffinityRules')}<HelpTip text={t('drsPage.helpEnableAffinity')} /></>}
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
          label={<>{t('drsPage.enforceAffinityRules')}<HelpTip text={t('drsPage.helpEnforceAffinity')} /></>}
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
  )

  const renderAdvanced = () => (
    <>
      <SubsectionHeader icon="ri-speed-up-line" label={t('drsPage.sectionMigrationLimits')} />
      <Grid container spacing={2.5} sx={{ mb: 1 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <LabeledSlider
            label={t('drsPage.maxConcurrentPerCluster')}
            help={t('drsPage.helpMaxConcurrentPerCluster')}
            value={settings.max_concurrent_migrations_per_cluster || 2}
            onChange={(v) => handleChange('max_concurrent_migrations_per_cluster', v)}
            min={1}
            max={10}
            marks={[{ value: 1, label: '1' }, { value: 5, label: '5' }, { value: 10, label: '10' }]}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <LabeledSlider
            label={t('drsPage.maxTargetInflowPerCycle')}
            help={t('drsPage.helpMaxTargetInflow')}
            value={settings.max_target_inflow_per_cycle}
            onChange={(v) => handleChange('max_target_inflow_per_cycle', v)}
            min={0}
            max={5}
            marks={[{ value: 0, label: 'off' }, { value: 1, label: '1' }, { value: 3, label: '3' }, { value: 5, label: '5' }]}
            valueLabelFormat={(v) => (v === 0 ? 'off' : String(v))}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 2 }} />

      <SubsectionHeader icon="ri-tools-line" label={t('drsPage.sectionMigrationBehavior')} />
      <Grid container spacing={2.5} sx={{ mb: 1 }}>
        <Grid size={{ xs: 12, md: 6 }}>
          <LabeledSlider
            label={t('drsPage.cooldownBetweenMigrations')}
            help={t('drsPage.helpCooldown')}
            value={(() => {
              const s = settings.migration_cooldown || '5m'
              // Parse Go duration format: "5m", "5m0s", "1h30m", "30s"
              let totalMinutes = 0
              const hMatch = s.match(/(\d+)h/)
              const mMatch = s.match(/(\d+)m/)
              const sMatch = s.match(/^(\d+)s$/)
              if (hMatch) totalMinutes += Number.parseInt(hMatch[1]) * 60
              if (mMatch) totalMinutes += Number.parseInt(mMatch[1])
              if (sMatch) totalMinutes = Math.max(1, Math.round(Number.parseInt(sMatch[1]) / 60))
              return totalMinutes || 5
            })()}
            onChange={(v) => handleChange('migration_cooldown', `${v}m`)}
            min={1}
            max={30}
            marks={[{ value: 1, label: '1m' }, { value: 5, label: '5m' }, { value: 15, label: '15m' }, { value: 30, label: '30m' }]}
            valueLabelFormat={(v) => `${v}m`}
          />
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <LabeledSlider
            label={t('drsPage.maxPendingRecommendations')}
            help={t('drsPage.helpMaxPending')}
            value={settings.max_pending_recommendations}
            onChange={(v) => handleChange('max_pending_recommendations', v)}
            min={1}
            max={20}
            marks={[{ value: 1, label: '1' }, { value: 5, label: '5' }, { value: 10, label: '10' }, { value: 20, label: '20' }]}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 2 }} />

      <SubsectionHeader icon="ri-scales-3-line" label={t('drsPage.resourceWeights')} help={t('drsPage.helpResourceWeights')} mb={0.5} />
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 2 }}>
        {t('drsPage.helpResourceWeightsDesc')}
      </Typography>
      <Grid container spacing={2.5}>
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
    </>
  )

  const renderSection = () => {
    switch (activeSection) {
      case 'general': return renderGeneral()
      case 'thresholds': return renderThresholds()
      case 'affinity': return renderAffinity()
      case 'advanced': return renderAdvanced()
    }
  }

  return (
    <Box>
      {/* Header: unsaved indicator + save button */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 1.5, mb: 2 }}>
        {hasChanges && (
          <Chip
            size="small"
            label={t('drsPage.unsavedChanges')}
            color="warning"
            variant="outlined"
            icon={<i className="ri-error-warning-line" style={{ fontSize: 16 }} />}
          />
        )}
        <Button
          variant="contained"
          startIcon={<SaveIcon />}
          onClick={handleSave}
          disabled={saving || !hasChanges}
        >
          {saving ? t('common.saving') : t('common.save')}
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

      {/* Mobile: horizontal tabs */}
      {isMobile ? (
        <Box>
          <Tabs
            value={activeSection}
            onChange={(_, v) => setActiveSection(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
          >
            {SECTIONS.map(s => (
              <Tab
                key={s.key}
                value={s.key}
                icon={<i className={s.icon} style={{ fontSize: 18 }} />}
                iconPosition="start"
                label={sectionLabel(s.key)}
                sx={{ minHeight: 48, textTransform: 'none', fontSize: '0.8rem' }}
              />
            ))}
          </Tabs>
          <Box>{renderSection()}</Box>
        </Box>
      ) : (
        /* Desktop: side-nav + content */
        <Box sx={{ display: 'flex', gap: 0, border: 1, borderColor: 'divider', borderRadius: 1, overflow: 'hidden' }}>
          {/* Left nav */}
          <Box
            sx={{
              width: 200,
              minWidth: 200,
              borderRight: 1,
              borderColor: 'divider',
              bgcolor: (theme) => alpha(theme.palette.background.default, 0.5),
            }}
          >
            <List disablePadding>
              {SECTIONS.map(s => (
                <ListItemButton
                  key={s.key}
                  selected={activeSection === s.key}
                  onClick={() => setActiveSection(s.key)}
                  sx={{
                    py: 1.5,
                    px: 2,
                    '&.Mui-selected': {
                      bgcolor: (theme) => alpha(theme.palette.primary.main, 0.08),
                      borderRight: 2,
                      borderColor: 'primary.main',
                    },
                  }}
                >
                  <ListItemIcon sx={{ minWidth: 32 }}>
                    <i className={s.icon} style={{ fontSize: 20, color: activeSection === s.key ? undefined : 'inherit' }} />
                  </ListItemIcon>
                  <ListItemText
                    primary={sectionLabel(s.key)}
                    primaryTypographyProps={{
                      variant: 'body2',
                      fontWeight: activeSection === s.key ? 600 : 400,
                    }}
                  />
                </ListItemButton>
              ))}
            </List>
          </Box>

          {/* Right content */}
          <Box sx={{ flex: 1, p: 3, minHeight: 300 }}>
            {renderSection()}
          </Box>
        </Box>
      )}
    </Box>
  )
}
