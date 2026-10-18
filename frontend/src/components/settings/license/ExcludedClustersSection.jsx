'use client'

import { Box, Button, Card, Typography } from '@mui/material'

// The clusters declared outside the license (roadmap#58): visible, counted in
// no quota, every change refused by ProxCenter. Each one can be counted
// again; the header opens the dialog that excludes one more.
// excluded: node_status.excluded, [{ connection_id, nodes }].
export default function ExcludedClustersSection({ excluded, connName, t, busyId = null, onExclude, onInclude }) {
  return (
    <Card variant='outlined' sx={{ mb: 2 }}>
      <Box sx={{ px: 2.5, py: 1.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Typography variant='subtitle1' fontWeight={600} sx={{ flex: 1 }}>{t('settings.licenseTab.excluded.title')}</Typography>
          <Button size='small' variant='outlined' onClick={onExclude} startIcon={<i className='ri-forbid-line' />}>
            {t('settings.licenseTab.excluded.exclude')}
          </Button>
        </Box>
        <Typography variant='body2' color='text.secondary' sx={{ mt: 0.5 }}>{t('settings.licenseTab.excluded.help')}</Typography>
      </Box>

      {excluded.length === 0 ? (
        <Typography variant='body2' color='text.secondary' sx={{ px: 2.5, pb: 1.75 }}>{t('settings.licenseTab.excluded.none')}</Typography>
      ) : (
        <Box sx={{ borderTop: 1, borderColor: 'divider' }}>
          {excluded.map(e => (
            <Box key={e.connection_id} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, px: 2.5, py: 1.25, '& + &': { borderTop: 1, borderColor: 'divider' } }}>
              <Box sx={{ width: 32, height: 32, borderRadius: 1.5, bgcolor: 'action.hover', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, color: 'text.secondary' }}>
                <i className='ri-server-line' style={{ fontSize: 16 }} aria-hidden='true' />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant='body2' fontWeight={600} noWrap>{connName[e.connection_id] || e.connection_id}</Typography>
                <Typography variant='caption' color='text.secondary'>{t('settings.licenseTab.excluded.nodes', { count: e.nodes })}</Typography>
              </Box>
              <Button size='small' variant='outlined' disabled={busyId === e.connection_id} onClick={() => onInclude(e.connection_id)}>
                {t('settings.licenseTab.excluded.include')}
              </Button>
            </Box>
          ))}
        </Box>
      )}
    </Card>
  )
}
