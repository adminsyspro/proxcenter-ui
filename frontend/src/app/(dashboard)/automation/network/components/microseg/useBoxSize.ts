import { useEffect, useState, type RefCallback } from 'react'

export type BoxSize = { width: number; height: number }

/** How long a resize settles before the size changes (the first size is given at once). */
export const BOX_SIZE_DELAY = 100

/**
 * The size of an element in px (its content box), followed with a ResizeObserver: the first size at once, the next
 * ones once a resize has settled for `delay` ms, and the same object while it does not change. Null until measured,
 * and where the browser has no ResizeObserver. Attach the returned callback as the `ref` of the element.
 */
export function useBoxSize<T extends Element>(delay = BOX_SIZE_DELAY): [RefCallback<T>, BoxSize | null] {
  const [element, setElement] = useState<T | null>(null)
  const [size, setSize] = useState<BoxSize | null>(null)

  useEffect(() => {
    if (!element || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    let measured = false
    const observer = new ResizeObserver(entries => {
      const rect = entries.at(-1)?.contentRect
      if (!rect) return
      const next = { width: Math.floor(rect.width), height: Math.floor(rect.height) }
      const apply = () => setSize(prev => (prev?.width === next.width && prev?.height === next.height ? prev : next))
      clearTimeout(timer)
      if (measured) {
        timer = setTimeout(apply, delay)
      } else {
        measured = true
        apply()
      }
    })
    observer.observe(element)
    return () => {
      clearTimeout(timer)
      observer.disconnect()
    }
  }, [element, delay])

  return [setElement, size]
}
