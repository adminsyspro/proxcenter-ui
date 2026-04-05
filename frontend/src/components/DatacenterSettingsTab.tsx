'use client'

import { useState, useEffect, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  FormControl,
  FormControlLabel,
  IconButton,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'
import { useToast } from '@/contexts/ToastContext'

/* ------------------------------------------------------------------ */
/* Types & constants                                                   */
/* ------------------------------------------------------------------ */

interface TagColorEntry {
  tag: string
  bg: string
  fg: string
}

interface DatacenterOptions {
  console?: string
  keyboard?: string
  language?: string
  http_proxy?: string
  email_from?: string
  max_workers?: number | string
  migration?: string        // type=secure,network=X
  migration_unsecure?: string
  ha?: string               // shutdown_policy=freeze|failover|migrate|conditional
  mac_prefix?: string
  bwlimit?: string
  crs?: string              // ha-rebalance-on-start=0|1
  'tag-style'?: string      // color-map=...;shape=...;ordering=...
  description?: string
  u2f?: string
  webauthn?: string
  'next-id'?: string
  notify?: string
}

const CONSOLE_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'applet', label: 'Java Applet (deprecated)' },
  { value: 'vv', label: 'SPICE (virt-viewer)' },
  { value: 'html5', label: 'noVNC' },
  { value: 'xtermjs', label: 'xterm.js' },
]

const KEYBOARD_LAYOUTS = [
  { value: '', label: 'Default' },
  { value: 'de', label: 'German' },
  { value: 'de-ch', label: 'German (Swiss)' },
  { value: 'en-gb', label: 'English (UK)' },
  { value: 'en-us', label: 'English (US)' },
  { value: 'es', label: 'Spanish' },
  { value: 'fi', label: 'Finnish' },
  { value: 'fr', label: 'French' },
  { value: 'fr-be', label: 'French (Belgium)' },
  { value: 'fr-ca', label: 'French (Canada)' },
  { value: 'fr-ch', label: 'French (Swiss)' },
  { value: 'hu', label: 'Hungarian' },
  { value: 'is', label: 'Icelandic' },
  { value: 'it', label: 'Italian' },
  { value: 'ja', label: 'Japanese' },
  { value: 'lt', label: 'Lithuanian' },
  { value: 'mk', label: 'Macedonian' },
  { value: 'nl', label: 'Dutch' },
  { value: 'no', label: 'Norwegian' },
  { value: 'pl', label: 'Polish' },
  { value: 'pt', label: 'Portuguese' },
  { value: 'pt-br', label: 'Portuguese (Brazil)' },
  { value: 'sl', label: 'Slovenian' },
  { value: 'sv', label: 'Swedish' },
  { value: 'tr', label: 'Turkish' },
]

const HA_SHUTDOWN_POLICIES = [
  { value: '', label: 'Default' },
  { value: 'freeze', label: 'Freeze' },
  { value: 'failover', label: 'Failover' },
  { value: 'migrate', label: 'Migrate' },
  { value: 'conditional', label: 'Conditional' },
]

const MIGRATION_TYPES = [
  { value: '', label: 'Default' },
  { value: 'secure', label: 'Secure' },
  { value: 'insecure', label: 'Insecure' },
]

/* ------------------------------------------------------------------ */
/* tag-style parsing helpers                                           */
/* ------------------------------------------------------------------ */

function parseTagStyle(tagStyle: any): {
  colorMap: TagColorEntry[]
  shape: string
  ordering: string
  caseSensitive: boolean
} {
  const result = { colorMap: [] as TagColorEntry[], shape: 'full', ordering: 'config', caseSensitive: false }
  if (!tagStyle) return result

  // PVE may return an object { "color-map": "...", shape: "full", ordering: "config" } or a string
  if (typeof tagStyle === 'object') {
    if (tagStyle['color-map']) {
      String(tagStyle['color-map']).split(';').forEach(entry => {
        if (!entry) return
        const segments = entry.split(':')
        if (segments.length < 2) return
        const tag = segments[0]
        const bgHex = segments[1]
        const fgHex = segments[2]
        if (!tag || !bgHex || bgHex.length < 6) return
        result.colorMap.push({
          tag,
          bg: `#${bgHex.slice(0, 6)}`,
          fg: fgHex && fgHex.length >= 6 ? `#${fgHex.slice(0, 6)}` : '#ffffff',
        })
      })
    }
    if (tagStyle.shape) result.shape = tagStyle.shape
    if (tagStyle.ordering) result.ordering = tagStyle.ordering
    if (tagStyle['case-sensitive'] === 1 || tagStyle['case-sensitive'] === '1') result.caseSensitive = true
    return result
  }

  // String format: "color-map=tag:RRGGBB:RRGGBB;tag2:RRGGBB,shape=full,ordering=config,case-sensitive=1"
  const parts = String(tagStyle).split(',')
  for (const part of parts) {
    const [key, ...rest] = part.split('=')
    const val = rest.join('=')
    if (key === 'color-map' && val) {
      val.split(';').forEach(entry => {
        if (!entry) return
        const segments = entry.split(':')
        if (segments.length < 2) return
        const tag = segments[0]
        const bgHex = segments[1]
        const fgHex = segments[2]
        if (!tag || !bgHex || bgHex.length < 6) return
        result.colorMap.push({
          tag,
          bg: `#${bgHex.slice(0, 6)}`,
          fg: fgHex && fgHex.length >= 6 ? `#${fgHex.slice(0, 6)}` : '#ffffff',
        })
      })
    } else if (key === 'shape') {
      result.shape = val || 'full'
    } else if (key === 'ordering') {
      result.ordering = val || 'config'
    } else if (key === 'case-sensitive') {
      result.caseSensitive = val === '1'
    }
  }
  return result
}

function buildTagStyleString(
  colorMap: TagColorEntry[],
  shape: string,
  ordering: string,
  caseSensitive: boolean,
): string {
  const parts: string[] = []

  if (colorMap.length > 0) {
    const mapStr = colorMap
      .filter(e => e.tag && e.bg)
      .map(e => {
        const bg = e.bg.replace('#', '')
        const fg = e.fg.replace('#', '')
        return fg && fg !== 'ffffff' ? `${e.tag}:${bg}:${fg}` : `${e.tag}:${bg}`
      })
      .join(';')
    if (mapStr) parts.push(`color-map=${mapStr}`)
  }

  if (shape && shape !== 'full') parts.push(`shape=${shape}`)
  if (ordering && ordering !== 'config') parts.push(`ordering=${ordering}`)
  if (caseSensitive) parts.push('case-sensitive=1')

  return parts.join(',')
}

/* ------------------------------------------------------------------ */
/* Parse HA shutdown_policy from PVE ha option string                  */
/* ------------------------------------------------------------------ */

function parseHaOption(ha: any): string {
  if (!ha) return ''
  // PVE may return an object { shutdown_policy: "freeze" } or a string "shutdown_policy=freeze"
  if (typeof ha === 'object') {
    return ha.shutdown_policy || ''
  }
  const match = String(ha).match(/shutdown_policy=(\w+)/)
  return match ? match[1] : String(ha)
}

function buildHaOption(policy: string): string {
  return policy ? `shutdown_policy=${policy}` : ''
}

/* ------------------------------------------------------------------ */
/* Parse migration type from PVE migration option string               */
/* ------------------------------------------------------------------ */

function parseMigrationOption(migration: any): { type: string; network: string } {
  if (!migration) return { type: '', network: '' }
  // PVE may return an object { type: "secure", network: "..." } or a string "type=secure,network=..."
  if (typeof migration === 'object') {
    return { type: migration.type || '', network: migration.network || '' }
  }
  const result = { type: '', network: '' }
  String(migration).split(',').forEach(part => {
    const [k, v] = part.split('=')
    if (k === 'type') result.type = v || ''
    if (k === 'network') result.network = v || ''
  })
  return result
}

function buildMigrationOption(type: string, network: string): string {
  const parts: string[] = []
  if (type) parts.push(`type=${type}`)
  if (network) parts.push(`network=${network}`)
  return parts.join(',')
}

/* ------------------------------------------------------------------ */
/* Parse CRS option                                                    */
/* ------------------------------------------------------------------ */

function parseCrsOption(crs: any): boolean {
  if (!crs) return false
  // PVE may return an object { "ha-rebalance-on-start": 1 } or a string
  if (typeof crs === 'object') {
    return crs['ha-rebalance-on-start'] === 1 || crs['ha-rebalance-on-start'] === '1'
  }
  return String(crs).includes('ha-rebalance-on-start=1')
}

function buildCrsOption(rebalance: boolean): string {
  return rebalance ? 'ha-rebalance-on-start=1' : ''
}

/* ------------------------------------------------------------------ */
/* Component                                                           */
/* ------------------------------------------------------------------ */

interface Props {
  connectionId: string
}

export default function DatacenterSettingsTab({ connectionId }: Props) {
  const t = useTranslations('inventory')
  const theme = useTheme()
  const toast = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Raw options from PVE
  const [rawOptions, setRawOptions] = useState<DatacenterOptions>({})

  // Tag style state
  const [tagColors, setTagColors] = useState<TagColorEntry[]>([])
  const [tagShape, setTagShape] = useState('full')
  const [tagOrdering, setTagOrdering] = useState('config')
  const [tagCaseSensitive, setTagCaseSensitive] = useState(false)

  // General options state
  const [consoleType, setConsoleType] = useState('')
  const [keyboard, setKeyboard] = useState('')
  const [language, setLanguage] = useState('')
  const [httpProxy, setHttpProxy] = useState('')
  const [emailFrom, setEmailFrom] = useState('')
  const [maxWorkers, setMaxWorkers] = useState('')
  const [migrationType, setMigrationType] = useState('')
  const [migrationNetwork, setMigrationNetwork] = useState('')
  const [haShutdownPolicy, setHaShutdownPolicy] = useState('')
  const [macPrefix, setMacPrefix] = useState('')
  const [bwLimit, setBwLimit] = useState('')
  const [crsRebalance, setCrsRebalance] = useState(false)

  // Track if there are unsaved changes
  const [dirty, setDirty] = useState(false)

  /* ---- Fetch options on mount ---- */

  const fetchOptions = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/options`, { cache: 'no-store' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      const data: DatacenterOptions = json?.data || {}
      setRawOptions(data)

      // Parse tag-style (may be string or object from PVE)
      const ts = parseTagStyle(data['tag-style'])
      setTagColors(ts.colorMap)
      setTagShape(ts.shape)
      setTagOrdering(ts.ordering)
      setTagCaseSensitive(ts.caseSensitive)

      // General options
      setConsoleType(data.console || '')
      setKeyboard(data.keyboard || '')
      setLanguage(data.language || '')
      setHttpProxy(data.http_proxy || '')
      setEmailFrom(data.email_from || '')
      setMaxWorkers(data.max_workers != null ? String(data.max_workers) : '')
      const mig = parseMigrationOption(data.migration)
      setMigrationType(mig.type)
      setMigrationNetwork(mig.network)
      setHaShutdownPolicy(parseHaOption(data.ha))
      setMacPrefix(data.mac_prefix || '')
      setBwLimit(data.bwlimit || '')
      setCrsRebalance(parseCrsOption(data.crs))

      setDirty(false)
    } catch (e: any) {
      setError(e?.message || 'Load failed')
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionId])

  useEffect(() => { fetchOptions() }, [fetchOptions])

  /* ---- Save handler ---- */

  const handleSave = async () => {
    setSaving(true)
    try {
      const body: Record<string, string> = {}
      const deleteKeys: string[] = []

      // Tag style - always send current state
      const tagStyleStr = buildTagStyleString(tagColors, tagShape, tagOrdering, tagCaseSensitive)
      if (tagStyleStr) {
        body['tag-style'] = tagStyleStr
      } else if (rawOptions['tag-style']) {
        deleteKeys.push('tag-style')
      }

      // Simple string fields - send value or mark for deletion
      const stringFields: Array<{ key: string; value: string }> = [
        { key: 'console', value: consoleType },
        { key: 'keyboard', value: keyboard },
        { key: 'language', value: language },
        { key: 'http_proxy', value: httpProxy },
        { key: 'email_from', value: emailFrom },
        { key: 'max_workers', value: maxWorkers },
        { key: 'mac_prefix', value: macPrefix },
        { key: 'bwlimit', value: bwLimit },
      ]

      for (const { key, value } of stringFields) {
        if (value) body[key] = value
        else if (rawOptions[key as keyof DatacenterOptions]) deleteKeys.push(key)
      }

      // Composite fields
      const migStr = buildMigrationOption(migrationType, migrationNetwork)
      if (migStr) body.migration = migStr
      else if (rawOptions.migration) deleteKeys.push('migration')

      const haStr = buildHaOption(haShutdownPolicy)
      if (haStr) body.ha = haStr
      else if (rawOptions.ha) deleteKeys.push('ha')

      const crsStr = buildCrsOption(crsRebalance)
      if (crsStr) body.crs = crsStr
      else if (rawOptions.crs) deleteKeys.push('crs')

      if (deleteKeys.length > 0) {
        body.delete = deleteKeys.join(',')
      }

      // Only send if there's something to update
      if (Object.keys(body).length === 0) {
        setDirty(false)
        return
      }

      const res = await fetch(`/api/v1/connections/${encodeURIComponent(connectionId)}/cluster/options`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || `HTTP ${res.status}`)
      }

      toast.success(t('dcSettingsSaveSuccess'))
      // Reload to get fresh state
      await fetchOptions()
    } catch (e: any) {
      toast.error(t('dcSettingsSaveError') + ': ' + (e?.message || String(e)))
    } finally {
      setSaving(false)
    }
  }

  /* ---- Tag color CRUD ---- */

  const addTagColor = () => {
    setTagColors(prev => [...prev, { tag: '', bg: '#1565c0', fg: '#ffffff' }])
    setDirty(true)
  }

  const updateTagColor = (index: number, field: keyof TagColorEntry, value: string) => {
    setTagColors(prev => prev.map((e, i) => i === index ? { ...e, [field]: value } : e))
    setDirty(true)
  }

  const removeTagColor = (index: number) => {
    setTagColors(prev => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  /* ---- Render ---- */

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', p: 6 }}>
        <CircularProgress size={32} />
      </Box>
    )
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error">{error}</Alert>
      </Box>
    )
  }

  return (
    <Box sx={{ p: 2, overflow: 'auto' }}>
      <Stack spacing={3}>
        {/* ============ Section: Tag Style ============ */}
        <Card variant="outlined">
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <i className="ri-price-tag-3-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
              <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsTagStyleTitle')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('dcSettingsTagStyleDesc')}
            </Typography>

            {/* Tag shape, ordering, case-sensitive */}
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>{t('dcSettingsTagShape')}</InputLabel>
                <Select
                  value={tagShape}
                  label={t('dcSettingsTagShape')}
                  onChange={e => { setTagShape(e.target.value); setDirty(true) }}
                >
                  <MenuItem value="full">{t('dcSettingsTagShapeFull')}</MenuItem>
                  <MenuItem value="circle">{t('dcSettingsTagShapeCircle')}</MenuItem>
                  <MenuItem value="dense">{t('dcSettingsTagShapeDense')}</MenuItem>
                  <MenuItem value="none">{t('dcSettingsTagShapeNone')}</MenuItem>
                </Select>
              </FormControl>

              <FormControl size="small" sx={{ minWidth: 160 }}>
                <InputLabel>{t('dcSettingsTagOrdering')}</InputLabel>
                <Select
                  value={tagOrdering}
                  label={t('dcSettingsTagOrdering')}
                  onChange={e => { setTagOrdering(e.target.value); setDirty(true) }}
                >
                  <MenuItem value="config">{t('dcSettingsTagOrderingConfig')}</MenuItem>
                  <MenuItem value="alphabetical">{t('dcSettingsTagOrderingAlpha')}</MenuItem>
                </Select>
              </FormControl>

              <FormControlLabel
                control={
                  <Switch
                    checked={tagCaseSensitive}
                    onChange={e => { setTagCaseSensitive(e.target.checked); setDirty(true) }}
                    size="small"
                  />
                }
                label={<Typography variant="body2">{t('dcSettingsTagCaseSensitive')}</Typography>}
              />
            </Stack>

            <Divider sx={{ mb: 2 }} />

            {/* Tag color overrides */}
            <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('dcSettingsTagColors')}</Typography>

            {tagColors.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {t('dcSettingsNoOverrides')}
              </Typography>
            )}

            <Stack spacing={1} sx={{ mb: 1.5 }}>
              {tagColors.map((entry, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <TextField
                    size="small"
                    label={t('dcSettingsTagName')}
                    value={entry.tag}
                    onChange={e => updateTagColor(i, 'tag', e.target.value)}
                    sx={{ width: 160 }}
                  />
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{t('dcSettingsTagBg')}</Typography>
                    <input
                      type="color"
                      value={entry.bg}
                      onChange={e => updateTagColor(i, 'bg', e.target.value)}
                      style={{ width: 32, height: 32, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                    />
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary">{t('dcSettingsTagFg')}</Typography>
                    <input
                      type="color"
                      value={entry.fg}
                      onChange={e => updateTagColor(i, 'fg', e.target.value)}
                      style={{ width: 32, height: 32, border: 'none', borderRadius: 4, cursor: 'pointer', background: 'transparent' }}
                    />
                  </Box>
                  {/* Preview chip */}
                  <Chip
                    label={entry.tag || 'tag'}
                    size="small"
                    sx={{
                      bgcolor: entry.bg,
                      color: entry.fg,
                      fontWeight: 600,
                      fontSize: 11,
                      height: 22,
                      borderRadius: tagShape === 'circle' ? '50%' : tagShape === 'dense' ? 0.5 : 1,
                      minWidth: tagShape === 'circle' ? 22 : undefined,
                      '& .MuiChip-label': { px: tagShape === 'circle' ? 0 : 0.75 },
                    }}
                  />
                  <IconButton size="small" onClick={() => removeTagColor(i)} color="error">
                    <i className="ri-delete-bin-line" style={{ fontSize: 16 }} />
                  </IconButton>
                </Stack>
              ))}
            </Stack>

            <Button
              size="small"
              startIcon={<i className="ri-add-line" />}
              onClick={addTagColor}
              variant="outlined"
            >
              {t('dcSettingsAddTag')}
            </Button>
          </CardContent>
        </Card>

        {/* ============ Section: General Options ============ */}
        <Card variant="outlined">
          <CardContent sx={{ p: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
              <i className="ri-settings-3-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
              <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsGeneralTitle')}</Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              {t('dcSettingsGeneralDesc')}
            </Typography>

            <Box sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
              gap: 2,
            }}>
              <FormControl size="small" fullWidth>
                <InputLabel>{t('dcSettingsConsole')}</InputLabel>
                <Select
                  value={consoleType}
                  label={t('dcSettingsConsole')}
                  onChange={e => { setConsoleType(e.target.value); setDirty(true) }}
                >
                  {CONSOLE_OPTIONS.map(o => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <FormControl size="small" fullWidth>
                <InputLabel>{t('dcSettingsKeyboard')}</InputLabel>
                <Select
                  value={keyboard}
                  label={t('dcSettingsKeyboard')}
                  onChange={e => { setKeyboard(e.target.value); setDirty(true) }}
                >
                  {KEYBOARD_LAYOUTS.map(o => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                size="small"
                label={t('dcSettingsLanguage')}
                value={language}
                onChange={e => { setLanguage(e.target.value); setDirty(true) }}
                fullWidth
              />

              <TextField
                size="small"
                label={t('dcSettingsHttpProxy')}
                value={httpProxy}
                onChange={e => { setHttpProxy(e.target.value); setDirty(true) }}
                placeholder="http://proxy:3128"
                fullWidth
              />

              <TextField
                size="small"
                label={t('dcSettingsEmailFrom')}
                value={emailFrom}
                onChange={e => { setEmailFrom(e.target.value); setDirty(true) }}
                placeholder="admin@example.com"
                fullWidth
              />

              <TextField
                size="small"
                label={t('dcSettingsMaxWorkers')}
                value={maxWorkers}
                onChange={e => { setMaxWorkers(e.target.value); setDirty(true) }}
                type="number"
                inputProps={{ min: 1, max: 64 }}
                fullWidth
              />

              <FormControl size="small" fullWidth>
                <InputLabel>{t('dcSettingsMigrationType')}</InputLabel>
                <Select
                  value={migrationType}
                  label={t('dcSettingsMigrationType')}
                  onChange={e => { setMigrationType(e.target.value); setDirty(true) }}
                >
                  {MIGRATION_TYPES.map(o => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                size="small"
                label={t('dcSettingsMigrationNetwork')}
                value={migrationNetwork}
                onChange={e => { setMigrationNetwork(e.target.value); setDirty(true) }}
                placeholder="10.0.0.0/24"
                fullWidth
              />

              <FormControl size="small" fullWidth>
                <InputLabel>{t('dcSettingsHaShutdownPolicy')}</InputLabel>
                <Select
                  value={haShutdownPolicy}
                  label={t('dcSettingsHaShutdownPolicy')}
                  onChange={e => { setHaShutdownPolicy(e.target.value); setDirty(true) }}
                >
                  {HA_SHUTDOWN_POLICIES.map(o => (
                    <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
                  ))}
                </Select>
              </FormControl>

              <TextField
                size="small"
                label={t('dcSettingsMacPrefix')}
                value={macPrefix}
                onChange={e => { setMacPrefix(e.target.value); setDirty(true) }}
                placeholder="BC:24:11"
                fullWidth
              />

              <TextField
                size="small"
                label={t('dcSettingsBwLimit')}
                value={bwLimit}
                onChange={e => { setBwLimit(e.target.value); setDirty(true) }}
                placeholder="clone=0,default=0,migration=0,move=0,restore=0"
                fullWidth
              />

              <FormControlLabel
                control={
                  <Switch
                    checked={crsRebalance}
                    onChange={e => { setCrsRebalance(e.target.checked); setDirty(true) }}
                    size="small"
                  />
                }
                label={<Typography variant="body2">{t('dcSettingsCrs')}</Typography>}
              />
            </Box>
          </CardContent>
        </Card>

        {/* ============ Save / Reset buttons ============ */}
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end' }}>
          <Button
            variant="outlined"
            onClick={fetchOptions}
            disabled={saving || !dirty}
            startIcon={<i className="ri-refresh-line" />}
          >
            {t('dcSettingsReset')}
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={saving || !dirty}
            startIcon={saving ? <CircularProgress size={16} /> : <i className="ri-save-line" />}
          >
            {t('dcSettingsSave')}
          </Button>
        </Box>
      </Stack>
    </Box>
  )
}
