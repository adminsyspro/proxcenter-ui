'use client'

import useSWR from 'swr'
import { useTranslations } from 'next-intl'
import { Alert, Box, Card, CardContent, Chip, Skeleton, Stack, Typography } from '@mui/material'

const fetcher = url => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

export default function ConnectionStatusCard() {
  const t = useTranslations()
  const { data, error, isLoading } = useSWR('/api/v1/connections', fetcher)

  const pve = Array.isArray(data?.data) ? data.data.filter(c => c.type === 'pve') : []
  const total = pve.length
  const root = pve.filter(c => (c.sshUser || 'root') === 'root').length
  const sudo = pve.filter(c => (c.sshUser || 'root') !== 'root' && c.sshUseSudo).length
  const plain = pve.filter(c => (c.sshUser || 'root') !== 'root' && !c.sshUseSudo).length

  let chipKey = 'chipRoot'
  let chipColor = 'warning'
  if (total === 0) {
    chipKey = 'chipRoot'
    chipColor = 'default'
  } else if (root === 0 && plain === 0) {
    chipKey = 'chipHardened'
    chipColor = 'success'
  } else if (root < total) {
    chipKey = 'chipPartial'
    chipColor = 'info'
  }

  return (
    <Card variant='outlined'>
      <CardContent>
        <Stack direction='row' alignItems='center' justifyContent='space-between' sx={{ mb: 1 }}>
          <Typography variant='subtitle1' fontWeight={600}>
            {t('settings.sshCommands.status.heading')}
          </Typography>
          {!isLoading && !error && (
            <Chip size='small' color={chipColor} label={t(`settings.sshCommands.status.${chipKey}`)} />
          )}
        </Stack>

        {isLoading && <Skeleton variant='text' width='60%' />}

        {error && (
          <Alert severity='error'>{t('settings.sshCommands.errors.fetchFailed')}</Alert>
        )}

        {!isLoading && !error && total === 0 && (
          <Typography variant='body2' color='text.secondary'>
            {t('settings.sshCommands.status.noConnections')}
          </Typography>
        )}

        {!isLoading && !error && total > 0 && (
          <Box>
            <Typography variant='body2'>
              {t('settings.sshCommands.status.summary', { total, root, sudo, plain })}
            </Typography>
            {root === total && (
              <Alert severity='warning' sx={{ mt: 1.5 }} icon={<i className='ri-shield-line' />}>
                {t('settings.sshCommands.status.rootWarning')}
              </Alert>
            )}
            {root > 0 && root < total && (
              <Alert severity='info' sx={{ mt: 1.5 }}>
                {t('settings.sshCommands.status.partial')}
              </Alert>
            )}
            {root === 0 && plain === 0 && (
              <Alert severity='success' sx={{ mt: 1.5 }} icon={<i className='ri-shield-check-line' />}>
                {t('settings.sshCommands.status.hardened')}
              </Alert>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  )
}
