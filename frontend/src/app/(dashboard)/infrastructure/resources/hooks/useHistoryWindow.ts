'use client'

import { useCallback, useEffect, useState } from 'react'

import { DEFAULT_HISTORY_WINDOW_DAYS, isHistoryWindowDays, type HistoryWindowDays } from '../algorithms/historyWindow'

export const HISTORY_WINDOW_STORAGE_KEY = 'proxcenter_resources_history_days'

// The window is a per-viewer preference, so it lives in the browser; an unreadable
// or blocked storage keeps the default.
export function useHistoryWindow(): [HistoryWindowDays, (days: HistoryWindowDays) => void] {
  const [days, setDays] = useState<HistoryWindowDays>(DEFAULT_HISTORY_WINDOW_DAYS)

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(HISTORY_WINDOW_STORAGE_KEY))

      if (isHistoryWindowDays(saved)) setDays(saved)
    } catch {
      // storage unavailable: keep the default
    }
  }, [])

  const update = useCallback((next: HistoryWindowDays) => {
    setDays(next)
    try {
      localStorage.setItem(HISTORY_WINDOW_STORAGE_KEY, String(next))
    } catch {
      // storage unavailable: the choice lasts for this visit only
    }
  }, [])

  return [days, update]
}
