'use client'

import { useCallback } from 'react'
import { useToast } from '@/contexts/ToastContext'

const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

/**
 * Hook that provides a guarded fetch for demo mode.
 * Mutating requests (POST/PUT/PATCH/DELETE) show a toast and are blocked.
 * GET requests pass through normally.
 */
export function useDemoGuard() {
  const toast = useToast()

  const guardedFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const method = (init?.method || 'GET').toUpperCase()

      if (isDemo && method !== 'GET') {
        toast.warning('This action is disabled in demo mode')
        return new Response(JSON.stringify({ success: false, demo: true, message: 'Action disabled in demo mode' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      }

      return fetch(input, init)
    },
    [toast]
  )

  return { isDemo, guardedFetch }
}

/**
 * Returns true if demo mode is active. Works outside React components.
 */
export function isDemoMode(): boolean {
  return isDemo
}
