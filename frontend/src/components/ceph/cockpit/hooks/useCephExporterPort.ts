'use client'

import useSWR from 'swr'

import { fetchCockpitData } from './cockpitFetch'

export const DEFAULT_EXPORTER_PORT = 9926

/**
 * Port du ceph-exporter d'une connexion (champ `cephExporterPort` de l'API des connexions), pour le texte de l'encadre
 * d'information. `enabled` faux : aucun appel. Illisible ou invalide : le port par defaut.
 */
export function useCephExporterPort(conn: string | null, enabled: boolean): number {
  const { data } = useSWR<number>(
    conn && enabled ? ['ceph-cockpit', 'exporter-port', conn] : null,
    async ([, , id]: readonly [string, string, string]) => {
      try {
        const c = await fetchCockpitData<{ cephExporterPort?: unknown }>(`/api/v1/connections/${encodeURIComponent(id)}`)
        const port = c?.cephExporterPort

        return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : DEFAULT_EXPORTER_PORT
      } catch {
        return DEFAULT_EXPORTER_PORT
      }
    },
    { revalidateOnFocus: false, dedupingInterval: 60_000 },
  )

  return data ?? DEFAULT_EXPORTER_PORT
}
