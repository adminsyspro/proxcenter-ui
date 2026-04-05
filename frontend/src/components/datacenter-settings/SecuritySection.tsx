'use client'

import {
  Alert,
  Box,
  Card,
  CardContent,
  Divider,
  Stack,
  TextField,
  Typography,
  useTheme,
} from '@mui/material'

interface Props {
  u2fAppId: string
  u2fOrigin: string
  webauthnName: string
  webauthnOrigin: string
  webauthnId: string
  onChange: (field: string, value: string) => void
  t: (key: string) => string
}

export default function SecuritySection({
  u2fAppId, u2fOrigin, webauthnName, webauthnOrigin, webauthnId,
  onChange, t,
}: Props) {
  const theme = useTheme()

  return (
    <Card variant="outlined">
      <CardContent sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <i className="ri-shield-keyhole-line" style={{ fontSize: 18, color: theme.palette.primary.main }} />
          <Typography variant="subtitle1" fontWeight={700}>{t('dcSettingsSecurityTitle')}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('dcSettingsSecurityDesc')}
        </Typography>

        {/* U2F */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('dcSettingsU2f')}</Typography>
        <Alert severity="warning" sx={{ mb: 1.5, py: 0.5 }}>
          {t('dcSettingsU2fDeprecated')}
        </Alert>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 2 }}>
          <TextField
            size="small"
            label={t('dcSettingsU2fAppId')}
            value={u2fAppId}
            onChange={e => onChange('u2fAppId', e.target.value)}
            placeholder="Defaults to origin"
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsU2fOrigin')}
            value={u2fOrigin}
            onChange={e => onChange('u2fOrigin', e.target.value)}
            placeholder="Defaults to requesting host URI"
            fullWidth
          />
        </Stack>

        <Divider sx={{ my: 2 }} />

        {/* WebAuthn */}
        <Typography variant="subtitle2" sx={{ mb: 1 }}>{t('dcSettingsWebauthn')}</Typography>
        <Alert severity="info" sx={{ mb: 1.5, py: 0.5 }}>
          {t('dcSettingsWebauthnNote')}
        </Alert>
        <Box sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr 1fr' },
          gap: 2,
        }}>
          <TextField
            size="small"
            label={t('dcSettingsWebauthnName')}
            value={webauthnName}
            onChange={e => onChange('webauthnName', e.target.value)}
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsWebauthnOrigin')}
            value={webauthnOrigin}
            onChange={e => onChange('webauthnOrigin', e.target.value)}
            placeholder="https://10.99.99.100:8006"
            fullWidth
          />
          <TextField
            size="small"
            label={t('dcSettingsWebauthnId')}
            value={webauthnId}
            onChange={e => onChange('webauthnId', e.target.value)}
            fullWidth
          />
        </Box>
      </CardContent>
    </Card>
  )
}
