'use client'

import { Tabs, Tab, Box } from '@mui/material'
import { useTranslations } from 'next-intl'

export default function LoginAuthTabs({ value, onChange, disabled }) {
  const t = useTranslations()


return (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
      <Tabs
        value={value}
        onChange={(_, v) => onChange(v)}
        variant='fullWidth'
      >
        <Tab
          value='local'
          disabled={disabled}
          icon={<i className='ri-user-line' />}
          iconPosition='start'
          label={t('auth.localAccount')}
          sx={{ minHeight: 48, gap: 1 }}
        />
        <Tab
          value='ldap'
          disabled={disabled}
          icon={<i className='ri-server-line' />}
          iconPosition='start'
          label={t('auth.ldapAd')}
          sx={{ minHeight: 48, gap: 1 }}
        />
      </Tabs>
    </Box>
  )
}
