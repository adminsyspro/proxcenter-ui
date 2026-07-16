"use client"

import { useCallback, useRef, useState } from "react"

/**
 * Copy text to the clipboard, resilient to non-secure contexts. The async
 * Clipboard API is unavailable over plain HTTP or a bare LAN IP (common for a
 * self-hosted product), so we fall back to a hidden-textarea execCommand copy.
 * Never throws — returns whether the copy succeeded.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea")
    ta.value = text
    ta.setAttribute("readonly", "")
    ta.style.position = "fixed"
    ta.style.top = "-9999px"
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand("copy")
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

/** React hook: `copy(text)` + a transient `copied` flag for button feedback. */
export function useCopyToClipboard(resetMs = 1500): { copy: (text: string) => Promise<boolean>; copied: boolean } {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const copy = useCallback(async (text: string) => {
    const ok = await copyToClipboard(text)
    if (ok) {
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), resetMs)
    }
    return ok
  }, [resetMs])
  return { copy, copied }
}
