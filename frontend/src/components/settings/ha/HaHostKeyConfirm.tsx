import { useState } from 'react'

import { Alert, Box, Button, CircularProgress, Typography } from '@mui/material'
import { useTranslations } from 'next-intl'

import type { SshHostKeyRefusal } from '../hostKeyRefusal'

export interface HaNodeHostKey {
  /** Node name as the wizard shows it, or its IP. */
  node: string
  hostKey: SshHostKeyRefusal
}

/**
 * The SSH host keys the validation refused (a node never seen, or a key that
 * changed), each with its fingerprint and a button that trusts exactly that
 * key, then runs the validation again.
 */
export default function HaHostKeyConfirm({ keys, onTrusted, disabled }: {
  keys: HaNodeHostKey[]
  onTrusted: () => void
  disabled?: boolean
}) {
  const t = useTranslations('ha')
  const [trusting, setTrusting] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  if (keys.length === 0) return null

  const trust = async (hostKey: SshHostKeyRefusal) => {
    if (trusting) return
    setTrusting(hostKey.endpoint)
    setErrors(prev => {
      const next = { ...prev }

      delete next[hostKey.endpoint]

      return next
    })
    try {
      const res = await fetch('/api/v1/ssh/host-keys/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ host: hostKey.endpoint, fingerprint: hostKey.fingerprint }),
      })
      if (!res.ok) {
        const json = await res.json().catch(() => ({}))
        setErrors(prev => ({ ...prev, [hostKey.endpoint]: json?.error || `HTTP ${res.status}` }))

        return
      }
      onTrusted()
    } catch (e: any) {
      setErrors(prev => ({ ...prev, [hostKey.endpoint]: e?.message || String(e) }))
    } finally {
      setTrusting(null)
    }
  }

  return (
    <Alert severity="warning" sx={{ mt: 1.5 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>{t('wizard.hostKeysTitle')}</Typography>
      {keys.map(({ node, hostKey }) => (
        <Box key={hostKey.endpoint} sx={{ mt: 0.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'nowrap' }}>
            <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
              {t(hostKey.state === 'mismatch' ? 'wizard.hostKeyChanged' : 'wizard.hostKeyUnconfirmed', { node })}
            </Typography>
            <Button
              size="small"
              variant="outlined"
              color={hostKey.state === 'mismatch' ? 'error' : 'primary'}
              onClick={() => trust(hostKey)}
              disabled={disabled || trusting !== null}
              startIcon={trusting === hostKey.endpoint ? <CircularProgress size={14} /> : <i className="ri-shield-keyhole-line" />}
              sx={{ py: 0, minHeight: 26, flexShrink: 0 }}
            >
              {t(hostKey.state === 'mismatch' ? 'wizard.trustNewHostKey' : 'wizard.trustHostKey')}
            </Button>
          </Box>
          {/* The whole fingerprint, on its own line: the operator compares it. */}
          <Typography variant="caption" sx={{ display: 'block', overflowWrap: 'anywhere' }}>
            {t('wizard.hostKeyFingerprint', { keyType: hostKey.key_type, fingerprint: hostKey.fingerprint })}
          </Typography>
          {errors[hostKey.endpoint] && (
            <Typography variant="caption" color="error" sx={{ display: 'block' }}>
              {t('wizard.trustHostKeyFailed', { error: errors[hostKey.endpoint] })}
            </Typography>
          )}
        </Box>
      ))}
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        {t('wizard.hostKeyHelper')}
      </Typography>
    </Alert>
  )
}
