'use client'

import { Button } from '@mui/material'
import { useTranslations } from 'next-intl'

interface LoginSsoButtonProps {
  providerName: string
  onClick: () => void
  disabled?: boolean
}

export default function LoginSsoButton({ providerName, onClick, disabled }: LoginSsoButtonProps) {
  const t = useTranslations()
  return (
    <Button
      fullWidth
      variant='contained'
      size='large'
      disabled={disabled}
      onClick={onClick}
      startIcon={<i className='ri-shield-keyhole-line' />}
      sx={{ py: 1.5, fontWeight: 600 }}
    >
      {t('auth.continueWith', { provider: providerName })}
    </Button>
  )
}
