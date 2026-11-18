'use client'

import { useTranslations } from 'next-intl'

import { OneLine } from './dialogParts'
import { unreadClusterNames } from './useGroupGuests'

/**
 * One line saying which clusters' guests could not be read (they are missing from the list), named only when the user
 * may see every one of them; nothing when every cluster answered. `counted`: under a member count (a zone card, the
 * members of a zone panel), it says they are not counted.
 */
export function GroupGuestsUnread({ errors, clusterName, counted = false }: Readonly<{ errors: Readonly<Record<string, unknown>>; clusterName?: (id: string) => string; counted?: boolean }>) {
  const t = useTranslations('microsegPilot.policy')
  if (Object.keys(errors).length === 0) return null
  const names = unreadClusterNames(errors, clusterName)
  const key = counted ? 'guestsUncounted' : 'guestsUnread'
  const text = names ? t(key, { clusters: names.join(', ') }) : t(`${key}Some`)
  return <OneLine text={text} color='warning.main' />
}
