'use client'

import {
  Box,
  Card,
  CardContent,
  InputAdornment,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

interface Props {
  bwDefault: string
  bwRestore: string
  bwMigration: string
  bwClone: string
  bwMove: string
  onChange: (field: string, value: string) => void
  t: (key: string) => string
}

export default function BandwidthSection({
  bwDefault, bwRestore, bwMigration, bwClone, bwMove,
  onChange, t,
}: Props) {
  const theme = useTheme()

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <i className="ri-speed-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
          <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsBwTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('dcSettingsBwDesc')}
        </Typography>

        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr 1fr 1fr' },
          gap: 2,
        }}>
          <TextField
            size="small"
            label={t('dcSettingsBwDefault')}
            value={bwDefault}
            onChange={e => onChange('bwDefault', e.target.value)}
            type="number"
            inputProps={{ min: 0 }}
            InputProps={{ endAdornment: <InputAdornment position="end">MiB/s</InputAdornment> }}
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsBwRestore')}
            value={bwRestore}
            onChange={e => onChange('bwRestore', e.target.value)}
            type="number"
            inputProps={{ min: 0 }}
            InputProps={{ endAdornment: <InputAdornment position="end">MiB/s</InputAdornment> }}
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsBwMigration')}
            value={bwMigration}
            onChange={e => onChange('bwMigration', e.target.value)}
            type="number"
            inputProps={{ min: 0 }}
            InputProps={{ endAdornment: <InputAdornment position="end">MiB/s</InputAdornment> }}
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsBwClone')}
            value={bwClone}
            onChange={e => onChange('bwClone', e.target.value)}
            type="number"
            inputProps={{ min: 0 }}
            InputProps={{ endAdornment: <InputAdornment position="end">MiB/s</InputAdornment> }}
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsBwMove')}
            value={bwMove}
            onChange={e => onChange('bwMove', e.target.value)}
            type="number"
            inputProps={{ min: 0 }}
            InputProps={{ endAdornment: <InputAdornment position="end">MiB/s</InputAdornment> }}
            fullWidth
          />
        </Box>
      </CardContent>
    </Card>
  )
}
