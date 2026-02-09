import useSWR from 'swr'

const reportsFetcher = async () => {
  const [typesRes, reportsRes, schedulesRes, langsRes] = await Promise.all([
    fetch('/api/v1/orchestrator/reports/types'),
    fetch('/api/v1/orchestrator/reports?limit=100'),
    fetch('/api/v1/orchestrator/reports/schedules'),
    fetch('/api/v1/orchestrator/reports/languages'),
  ])

  let reportTypes: any[] = []
  let reports: any[] = []
  let schedules: any[] = []
  let languages = [{ code: 'en', name: 'English' }, { code: 'fr', name: 'Français' }]

  if (typesRes.ok) {
    const data = await typesRes.json()
    reportTypes = Array.isArray(data) ? data : []
  }
  if (reportsRes.ok) {
    const data = await reportsRes.json()
    reports = data.data || []
  }
  if (schedulesRes.ok) {
    const data = await schedulesRes.json()
    schedules = Array.isArray(data) ? data : []
  }
  if (langsRes.ok) {
    const data = await langsRes.json()
    if (Array.isArray(data) && data.length > 0) languages = data
  }

  return { reportTypes, reports, schedules, languages }
}

export function useReportsData(isEnterprise: boolean, refreshInterval = 30000) {
  return useSWR(
    isEnterprise ? 'reports/data' : null,
    reportsFetcher,
    { refreshInterval }
  )
}
