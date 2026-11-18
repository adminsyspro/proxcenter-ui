'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'

import { MicrosegApiError, microsegApi, microsegErrorKeyOf } from '@/lib/microseg/api'

import MicrosegConfirmDialog from './MicrosegConfirmDialog'
import { isTrafficRefusal, socleRefusalLines } from './preflightModel'

type Props = {
  open: boolean
  /** The cluster whose firewall is turned back on. */
  connectionId: string
  /** Its name as the user knows it; null for a cluster they cannot name. */
  name: string | null
  onClose: () => void
  /** The firewall is back on: the caller reads the drifts and the status again. */
  onDone: () => void
}

/**
 * Confirms turning the cluster firewall of one cluster back on. The backend checks the node access rules first and
 * refuses without them (SOCLE_MISSING): the dialog then stays open and says which addresses the rules leave out.
 * Under an emergency stop the backend writes nothing and has the lift turn it on.
 */
export default function EnableClusterFirewallDialog({ open, connectionId, name, onClose, onDone }: Readonly<Props>) {
  const t = useTranslations()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const close = () => { setError(null); onClose() }

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      await microsegApi(connectionId).enableClusterFirewall()
      onDone()
      onClose()
    } catch (e) {
      setError(e)
    } finally {
      setBusy(false)
    }
  }

  const refused = error instanceof MicrosegApiError && error.code === 'SOCLE_MISSING'
  const socle = refused ? socleRefusalLines(error.detail).map(line => t(`microsegPilot.${line.key}`, line.values)) : []
  // Its own wording: the generic one of this refusal speaks of resuming after an emergency stop.
  let message: string | null = null
  const refusedKey = refused && isTrafficRefusal(error.detail) ? 'refusedTraffic' : 'refused'
  if (error) message = refused ? t(`microsegPilot.drifts.enableFirewall.${refusedKey}`) : t(microsegErrorKeyOf(error))
  const serverMessage = error instanceof MicrosegApiError ? error.serverMessage : null

  return (
    <MicrosegConfirmDialog
      open={open}
      title={name === null ? t('microsegPilot.drifts.enableFirewall.titleUnknown') : t('microsegPilot.drifts.enableFirewall.title', { name })}
      body={t('microsegPilot.drifts.enableFirewall.body')}
      infoLines={[
        { icon: 'ri-shield-check-line', text: t('microsegPilot.drifts.enableFirewall.check') },
        { icon: 'ri-refresh-line', text: t('microsegPilot.drifts.enableFirewall.after') },
        { icon: 'ri-stop-circle-line', text: t('microsegPilot.drifts.enableFirewall.stop') },
      ]}
      confirmLabel={t('microsegPilot.drifts.enableFirewall.confirm')}
      busy={busy}
      error={message}
      errorDetail={socle.length > 0 ? null : serverMessage}
      errorLines={socle}
      onConfirm={run}
      onCancel={close}
    />
  )
}
