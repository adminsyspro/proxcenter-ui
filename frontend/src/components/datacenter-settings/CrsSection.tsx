'use client'

import {
  Box,
  Card,
  CardContent,
  FormControl,
  FormControlLabel,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Switch,
  Typography,
  useTheme,
} from '@mui/material'

const CRS_HA_MODES = [
  { value: 'basic', label: 'Default (basic)' },
  { value: 'static', label: 'Static Load' },
]

interface Props {
  haScheduling: string
  rebalanceOnStart: boolean
  onChange: (field: string, value: string | boolean) => void
  t: (key: string) => string
}

export default function CrsSection({ haScheduling, rebalanceOnStart, onChange, t }: Props) {
  const theme = useTheme()

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <i className="ri-cpu-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
          <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsCrsTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('dcSettingsCrsDesc')}
        </Typography>

        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }}>
          <FormControl size="small" sx={{ minWidth: 220 }}>
            <InputLabel>{t('dcSettingsCrsHaScheduling')}</InputLabel>
            <Select
              value={haScheduling}
              label={t('dcSettingsCrsHaScheduling')}
              onChange={e => onChange('haScheduling', e.target.value)}
            >
              {CRS_HA_MODES.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>

          <FormControlLabel
            control={
              <Switch
                checked={rebalanceOnStart}
                onChange={e => onChange('rebalanceOnStart', e.target.checked)}
                size="small"
              />
            }
            label={<Typography variant="body2">{t('dcSettingsCrsRebalance')}</Typography>}
          />
        </Stack>
      </CardContent>
    </Card>
  )
}
