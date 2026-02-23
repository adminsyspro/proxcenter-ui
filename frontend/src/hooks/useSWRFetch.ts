import useSWR, { SWRConfiguration } from 'swr'

const fetcher = (url: string) => fetch(url, { cache: 'no-store' }).then(async res => {
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Invalid JSON response from ${url}`)
  }
})

export function useSWRFetch<T = any>(url: string | null, options?: SWRConfiguration) {
  return useSWR<T>(url, fetcher, options)
}
