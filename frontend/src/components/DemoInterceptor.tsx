'use client'

import { useEffect, useRef } from 'react'
import { useToast } from '@/contexts/ToastContext'

/**
 * Intercepts fetch responses in demo mode.
 * When a mutating request returns the demo-mode JSON, shows a warning toast.
 * Must be placed inside ToastProvider.
 */
export default function DemoInterceptor() {
  const toast = useToast()
  const toastRef = useRef(toast)
  toastRef.current = toast

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE !== 'true') return

    const originalFetch = window.fetch

    window.fetch = async function (...args: Parameters<typeof fetch>) {
      const [input, init] = args
      const method = (init?.method || 'GET').toUpperCase()

      // Only intercept mutating requests to our API
      if (method === 'GET') return originalFetch.apply(this, args)

      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
      if (!url.includes('/api/')) return originalFetch.apply(this, args)

      const response = await originalFetch.apply(this, args)

      // Check for demo mode header
      if (response.headers.get('x-demo-mode') === 'true') {
        const clone = response.clone()
        try {
          const body = await clone.json()
          if (body?.demo === true) {
            toastRef.current.warning('This action is disabled in demo mode')
          }
        } catch {
          // ignore parse errors
        }
      }

      return response
    }

    return () => {
      window.fetch = originalFetch
    }
  }, [])

  return null
}
