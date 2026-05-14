'use client'

// Network reservation block for the ISO deploy wizard.
//
// Pure presentational subcomponent — no useEffect, no fetch on mount.
// All async I/O (initial prefill, refresh button) is delegated to the
// parent via the `onAutoPick` callback. This keeps the subcomponent
// trivially stable: a remount under the parent's render cycle never
// triggers a network call, so the field values stay editable even if
// the parent's bridge state churns between renders.

import { useTranslations } from 'next-intl'
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material'

interface SubnetInfo {
  cidr: string
  gateway: string
  dnsServers: string[]
}

interface Props {

  /** Current static IP value (controlled by parent). */
  ip: string

  /** Current static MAC value (controlled by parent). */
  mac: string

  /** Subnet metadata for the gateway / DNS / cidr-helper display. */
  subnet: SubnetInfo

  /** Loading flag — true while the parent is fetching next-free. */
  loading?: boolean

  /** Error message from the last next-free fetch, if any. */
  error?: string | null

  onIpChange: (ip: string) => void
  onMacChange: (mac: string) => void

  /** Triggered when the user clicks one of the refresh icons. The
   *  parent fetches /ipam/next-free and updates the corresponding
   *  field. `which` says whether to overwrite IP, MAC, or both. */
  onAutoPick: (which: 'ip' | 'mac') => void
}

export default function IsoNetworkReservation({
  ip,
  mac,
  subnet,
  loading = false,
  error,
  onIpChange,
  onMacChange,
  onAutoPick,
}: Props) {
  const t = useTranslations()

  const ipValid = !ip || /^\d{1,3}(\.\d{1,3}){3}$/.test(ip.trim())
  const macValid = !mac || /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/.test(mac.trim())

  return (
    <Box sx={{ mt: 2.5, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 1.5, bgcolor: (theme) => alpha(theme.palette.warning.main, 0.04) }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
        <Box component="i" className="ri-flashlight-line" sx={{ fontSize: 18, color: 'warning.main' }} />
        <Typography variant="subtitle2" fontWeight={700}>{t('templates.deploy.iso.networkReservationTitle')}</Typography>
        {loading && <CircularProgress size={14} sx={{ ml: 'auto' }} />}
      </Stack>
      <Alert severity="warning" variant="outlined" sx={{ mb: 1.5, fontSize: '0.8rem' }} icon={<i className="ri-information-line" style={{ fontSize: 16 }} />}>
        {t('templates.deploy.iso.networkReservationHelp')}
      </Alert>
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
          <TextField
            size="small"
            label={t('templates.deploy.iso.staticIp')}
            value={ip}
            onChange={(e) => onIpChange(e.target.value)}
            placeholder="10.42.0.10"
            error={!ipValid}
            helperText={t('templates.deploy.iso.staticIpHelp', { cidr: subnet.cidr })}
            fullWidth
            required
          />
          <Tooltip title={t('templates.deploy.iso.staticIpAutoPick')} arrow>
            <IconButton size="small" sx={{ mt: 0.5 }} onClick={() => onAutoPick('ip')}>
              <Box component="i" className="ri-refresh-line" sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
          <TextField
            size="small"
            label={t('templates.deploy.iso.staticMac')}
            value={mac}
            onChange={(e) => onMacChange(e.target.value.toUpperCase())}
            error={!macValid}
            fullWidth
            required
          />
          <Tooltip title={t('templates.deploy.iso.regenerateMac')} arrow>
            <IconButton size="small" sx={{ mt: 0.5 }} onClick={() => onAutoPick('mac')}>
              <Box component="i" className="ri-refresh-line" sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        </Box>

        <TextField
          size="small"
          label={t('templates.deploy.iso.staticGateway')}
          value={subnet.gateway}
          fullWidth
          InputProps={{ readOnly: true }}
        />
        <TextField
          size="small"
          label={t('templates.deploy.iso.staticDns')}
          value={(subnet.dnsServers || []).join(', ')}
          fullWidth
          InputProps={{ readOnly: true }}
          placeholder="—"
        />
      </Box>
      {error && <Alert severity="error" sx={{ mt: 1.5 }}>{error}</Alert>}
    </Box>
  )
}
