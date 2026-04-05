'use client'

import {
  Box,
  Card,
  CardContent,
  Divider,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

const USER_TAG_ACCESS_MODES = [
  { value: 'free', label: 'Free' },
  { value: 'list', label: 'List' },
  { value: 'existing', label: 'Existing' },
  { value: 'none', label: 'None' },
]

interface Props {
  nextIdLower: string
  nextIdUpper: string
  userTagAccess: string
  registeredTags: string
  consentText: string
  onChange: (field: string, value: string) => void
  t: (key: string) => string
}

export default function AdvancedSection({
  nextIdLower, nextIdUpper, userTagAccess, registeredTags, consentText,
  onChange, t,
}: Props) {
  const theme = useTheme()

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <i className="ri-tools-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
          <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsAdvancedTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('dcSettingsAdvancedDesc')}
        </Typography>

        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' },
          gap: 2,
          mb: 2,
        }}>
          <TextField
            size="small"
            label={t('dcSettingsNextIdLower')}
            value={nextIdLower}
            onChange={e => onChange('nextIdLower', e.target.value)}
            type="number"
            inputProps={{ min: 100 }}
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsNextIdUpper')}
            value={nextIdUpper}
            onChange={e => onChange('nextIdUpper', e.target.value)}
            type="number"
            inputProps={{ min: 100 }}
            fullWidth
          />
          <FormControl size="small" fullWidth>
            <InputLabel>{t('dcSettingsUserTagAccess')}</InputLabel>
            <Select
              value={userTagAccess}
              label={t('dcSettingsUserTagAccess')}
              onChange={e => onChange('userTagAccess', e.target.value)}
            >
              {USER_TAG_ACCESS_MODES.map(o => <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>)}
            </Select>
          </FormControl>
        </Box>

        <TextField
          size="small"
          label={t('dcSettingsRegisteredTags')}
          value={registeredTags}
          onChange={e => onChange('registeredTags', e.target.value)}
          fullWidth
          placeholder="tag1;tag2;tag3"
          sx={{ mb: 2 }}
        />

        <Divider sx={{ my: 2 }} />

        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('dcSettingsConsentText')}</Typography>
        <TextField
          size="small"
          value={consentText}
          onChange={e => onChange('consentText', e.target.value)}
          fullWidth
          multiline
          minRows={3}
          maxRows={8}
          placeholder={t('dcSettingsConsentTextPlaceholder')}
        />
      </CardContent>
    </Card>
  )
}
