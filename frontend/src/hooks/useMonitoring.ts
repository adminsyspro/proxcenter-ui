import useSWR from 'swr'

const monitoringFetcher = async (url: string) => {
  const { monitoringApi } = await import('@/lib/api/monitoring')
  const res = await monitoringApi.summary()
  return (res as any)?.data?.data ?? (res as any)?.data ?? null
}

export function useMonitoringSummary(refreshInterval = 10000) {
  return useSWR('monitoring/summary', monitoringFetcher, { refreshInterval })
}
