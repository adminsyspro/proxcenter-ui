'use client'

import React, { createContext, useContext, useState, useCallback, useRef } from 'react'

/* ------------------------------------------------------------------ */
/* PVE tag-style color-map parsing                                    */
/* ------------------------------------------------------------------ */

export type TagColorOverride = { bg: string; fg: string }

/**
 * Parse PVE datacenter.cfg `tag-style` color-map string.
 * Format: "tag:RRGGBB[:RRGGBB];tag2:RRGGBB[:RRGGBB]"
 * First hex is background, optional second hex is font color.
 */
export function parseColorMap(colorMap: string): Record<string, TagColorOverride> {
  const result: Record<string, TagColorOverride> = {}
  if (!colorMap) return result

  colorMap.split(';').forEach(entry => {
    if (!entry) return
    const parts = entry.split(':')
    if (parts.length < 2) return
    const tag = parts[0]
    const bgHex = parts[1]
    const fgHex = parts[2]
    if (!tag || !bgHex || bgHex.length < 6) return

    result[tag] = {
      bg: `#${bgHex.slice(0, 6)}`,
      fg: fgHex && fgHex.length >= 6 ? `#${fgHex.slice(0, 6)}` : '#ffffff',
    }
  })

  return result
}

/**
 * Extract color-map from PVE tag-style property string.
 * tag-style is a key=value property string like:
 *   "color-map=prod:FF0000:FFFFFF;dev:00FF00,shape=full,ordering=config"
 * or the API may return it as a structured object.
 */
function extractColorMap(tagStyle: any): string {
  if (!tagStyle) return ''

  // If it's an object with color-map key (PVE API sometimes returns structured)
  if (typeof tagStyle === 'object' && tagStyle['color-map']) {
    return tagStyle['color-map']
  }

  // If it's a string, parse key=value pairs
  if (typeof tagStyle === 'string') {
    // PVE property format: "key=value,key=value" or "key=value key=value"
    const match = tagStyle.match(/color-map=([^,\s]+)/)
    if (match) return match[1]
  }

  return ''
}

/* ------------------------------------------------------------------ */
/* Context                                                            */
/* ------------------------------------------------------------------ */

type TagColorMap = Record<string, TagColorOverride>

type TagColorContextValue = {
  /** Get PVE color override for a tag on a specific connection */
  getOverride: (connId: string, tag: string) => TagColorOverride | undefined
  /** Load color map for a connection (idempotent, fetches once) */
  loadConnection: (connId: string) => void
  /** Check if a connection's colors have been loaded */
  isLoaded: (connId: string) => boolean
}

const TagColorContext = createContext<TagColorContextValue>({
  getOverride: () => undefined,
  loadConnection: () => {},
  isLoaded: () => false,
})

export function TagColorProvider({ children }: { children: React.ReactNode }) {
  const [colorMaps, setColorMaps] = useState<Record<string, TagColorMap>>({})
  const fetchingRef = useRef<Set<string>>(new Set())
  const loadedRef = useRef<Set<string>>(new Set())

  const loadConnection = useCallback((connId: string) => {
    if (!connId || loadedRef.current.has(connId) || fetchingRef.current.has(connId)) return
    fetchingRef.current.add(connId)

    fetch(`/api/v1/connections/${encodeURIComponent(connId)}/cluster/options`, { cache: 'no-store' })
      .then(res => res.ok ? res.json() : null)
      .then(json => {
        const data = json?.data
        if (!data) return

        const tagStyle = data['tag-style']
        const colorMapStr = extractColorMap(tagStyle)
        const parsed = parseColorMap(colorMapStr)

        loadedRef.current.add(connId)
        if (Object.keys(parsed).length > 0) {
          setColorMaps(prev => ({ ...prev, [connId]: parsed }))
        }
      })
      .catch(() => {
        // Silently fail - fallback colors will be used
        loadedRef.current.add(connId)
      })
      .finally(() => {
        fetchingRef.current.delete(connId)
      })
  }, [])

  const getOverride = useCallback((connId: string, tag: string): TagColorOverride | undefined => {
    return colorMaps[connId]?.[tag]
  }, [colorMaps])

  const isLoaded = useCallback((connId: string) => loadedRef.current.has(connId), [])

  return (
    <TagColorContext.Provider value={{ getOverride, loadConnection, isLoaded }}>
      {children}
    </TagColorContext.Provider>
  )
}

/**
 * Hook to get tag color with PVE override support.
 * Returns a getColor function that checks PVE overrides first, then falls back to hash-based palette.
 */
export function useTagColors(connId?: string) {
  const ctx = useContext(TagColorContext)

  // Trigger load for this connection
  React.useEffect(() => {
    if (connId) ctx.loadConnection(connId)
  }, [connId, ctx])

  const getColor = useCallback((tag: string, overrideConnId?: string): { bg: string; fg: string } => {
    const id = overrideConnId || connId
    if (id) {
      const override = ctx.getOverride(id, tag)
      if (override) return override
    }
    // Fallback to hash-based palette
    return { bg: tagColorFallback(tag), fg: '#ffffff' }
  }, [connId, ctx])

  return { getColor, getOverride: ctx.getOverride, loadConnection: ctx.loadConnection }
}

/* ------------------------------------------------------------------ */
/* Fallback hash-based palette (same as existing tagColor)            */
/* ------------------------------------------------------------------ */

const TAG_PALETTE = [
  '#e57000', '#2e7d32', '#1565c0', '#6a1b9a', '#00838f',
  '#c62828', '#ad1457', '#4e342e', '#455a64', '#7a7a00',
]

function hashStringToInt(str: string) {
  let h = 0
  for (let i = 0; i < str.length; i++) h = Math.trunc(h * 31 + str.codePointAt(i)!)
  return Math.abs(h)
}

export function tagColorFallback(tag: string): string {
  const idx = hashStringToInt(tag.toLowerCase()) % TAG_PALETTE.length
  return TAG_PALETTE[idx]
}
