import { redirectToLoginOnce } from '@/hooks/useSWRFetch'

/** Erreur HTTP du cockpit : `status` permet de distinguer le 404 (Ceph absent, Community) d'une vraie panne. */
export class CockpitHttpError extends Error {
  readonly status: number

  constructor(status: number) {
    super(`API error: ${status}`)
    this.name = 'CockpitHttpError'
    this.status = status
  }
}

export function isNotFound(e: unknown): boolean {
  return e instanceof CockpitHttpError && e.status === 404
}

/** GET JSON et retourne le champ `data`. 401 redirige vers le login, tout statut non 2xx jette `CockpitHttpError`. */
export async function fetchCockpitData<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', signal })

  if (!res.ok) {
    if (res.status === 401) redirectToLoginOnce()
    throw new CockpitHttpError(res.status)
  }

  const body = await res.json()

  return (body?.data ?? body) as T
}

/** Reponse 2xx sans la forme attendue : traitee comme une lecture en echec, jamais rendue. */
export class CockpitShapeError extends Error {
  constructor(url: string) {
    super(`Unexpected response shape: ${url}`)
    this.name = 'CockpitShapeError'
  }
}

/** Comme fetchCockpitData, puis verifie la forme du champ `data` (voir lib/ceph/shape). */
export async function fetchCockpitShaped<T>(url: string, isShape: (v: unknown) => v is T, signal?: AbortSignal): Promise<T> {
  const data = await fetchCockpitData<unknown>(url, signal)

  if (!isShape(data)) throw new CockpitShapeError(url)

  return data
}

/*
   Limite acceptee (R16) : un reessai SWR deja arme avant le masquage de l'onglet peut encore partir
   onglet cache (au plus 3). Les nouveaux reessais sont coupes onglet cache et rejoues a la reprise
   par useRevalidateErrorOnResume (crush, history) ou par le rechargement de reprise (inventaire).
*/
/** Reessais SWR : jamais sur un 404 (Ceph absent, Community) ni onglet cache, au plus 3 sinon. Le reste suit la logique par defaut de SWR. */
export const COCKPIT_SWR_RETRY = {
  // Onglet cache : pas de reessai en arriere-plan (0 appel PVE), la reprise recharge.
  shouldRetryOnError: (error: unknown) => !isNotFound(error) && !(typeof document !== 'undefined' && document.visibilityState === 'hidden'),
  errorRetryCount: 3,
}
