import useSWR, { SWRConfiguration } from 'swr'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(res => {
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json()
})

export function useSWRFetch<T = any>(url: string | null, options?: SWRConfiguration) {
  return useSWR<T>(url, fetcher, options)
}
