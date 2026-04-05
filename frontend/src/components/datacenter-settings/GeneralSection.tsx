'use client'

import {
  Box,
  Card,
  CardContent,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

const CONSOLE_OPTIONS = [
  { value: '', label: 'Default (xterm.js)' },
  { value: 'vv', label: 'SPICE (remote-viewer)' },
  { value: 'html5', label: 'HTML5 (noVNC)' },
  { value: 'xtermjs', label: 'xterm.js' },
]

const KEYBOARD_LAYOUTS = [
  { value: '', label: 'Default' },
  { value: 'da', label: 'Danish' },
  { value: 'de', label: 'German' },
  { value: 'de-ch', label: 'German (Swiss)' },
  { value: 'en-gb', label: 'English (UK)' },
  { value: 'en-us', label: 'English (USA)' },
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
  { value: 'conditional', label: 'Default (conditional)' },
  { value: 'freeze', label: 'freeze' },
  { value: 'failover', label: 'failover' },
  { value: 'migrate', label: 'migrate' },
]

const MIGRATION_TYPES = [
  { value: '', label: 'Default' },
  { value: 'secure', label: 'secure' },
  { value: 'insecure', label: 'insecure' },
]

interface Props {
  consoleType: string
  keyboard: string
  language: string
  httpProxy: string
  emailFrom: string
  macPrefix: string
  maxWorkers: string
  migrationType: string
  migrationNetwork: string
  haShutdownPolicy: string
  onChange: (field: string, value: string) => void
  t: (key: string) => string
}

export default function GeneralSection({
  consoleType, keyboard, language, httpProxy, emailFrom, macPrefix, maxWorkers,
  migrationType, migrationNetwork, haShutdownPolicy,
  onChange, t,
}: Props) {
  const theme = useTheme()

  return (
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
            <InputLabel>{t('dcSettingsKeyboard')}</InputLabel>
            <Select value={keyboard} label={t('dcSettingsKeyboard')} onChange={e => onChange('keyboard', e.target.value)}>
              {KEYBOARD_LAYOUTS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControl size="small" fullWidth>
            <InputLabel>{t('dcSettingsConsole')}</InputLabel>
            <Select value={consoleType} label={t('dcSettingsConsole')} onChange={e => onChange('console', e.target.value)}>
              {CONSOLE_OPTIONS.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>

          <TextField size="small" label={t('dcSettingsLanguage')} value={language} onChange={e => onChange('language', e.target.value)} fullWidth />
          <TextField size="small" label={t('dcSettingsHttpProxy')} value={httpProxy} onChange={e => onChange('httpProxy', e.target.value)} placeholder="http://proxy:3128" fullWidth />
          <TextField size="small" label={t('dcSettingsEmailFrom')} value={emailFrom} onChange={e => onChange('emailFrom', e.target.value)} placeholder="admin@example.com" fullWidth />
          <TextField size="small" label={t('dcSettingsMacPrefix')} value={macPrefix} onChange={e => onChange('macPrefix', e.target.value)} placeholder="BC:24:11" fullWidth />
          <TextField size="small" label={t('dcSettingsMaxWorkers')} value={maxWorkers} onChange={e => onChange('maxWorkers', e.target.value)} type="number" inputProps={{ min: 1, max: 64 }} fullWidth />

          <FormControl size="small" fullWidth>
            <InputLabel>{t('dcSettingsMigrationType')}</InputLabel>
            <Select value={migrationType} label={t('dcSettingsMigrationType')} onChange={e => onChange('migrationType', e.target.value)}>
              {MIGRATION_TYPES.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>

          <TextField size="small" label={t('dcSettingsMigrationNetwork')} value={migrationNetwork} onChange={e => onChange('migrationNetwork', e.target.value)} placeholder="10.0.0.0/24" fullWidth />

          <FormControl size="small" fullWidth>
            <InputLabel>{t('dcSettingsHaShutdownPolicy')}</InputLabel>
            <Select value={haShutdownPolicy} label={t('dcSettingsHaShutdownPolicy')} onChange={e => onChange('haShutdownPolicy', e.target.value)}>
              {HA_SHUTDOWN_POLICIES.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>
      </CardContent>
    </Card>
  )
}
