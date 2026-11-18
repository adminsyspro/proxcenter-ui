import { useCallback, useState } from 'react'

const storageKey = (connectionId: string) => `microseg.ignoredDrifts.${connectionId}`

function read(connectionId: string): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(storageKey(connectionId)) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [])
  } catch {
    return new Set()
  }
}

function write(connectionId: string, keys: Set<string>) {
  try {
    window.localStorage.setItem(storageKey(connectionId), JSON.stringify([...keys]))
  } catch {
    // Private window or blocked storage: the drift is hidden until the page is left.
  }
}

/**
 * The drifts the admin chose to ignore on this connection, kept in the browser
 * (a convenience, not shared: another browser still shows them).
 */
export function useIgnoredDrifts(connectionId: string) {
  const [ignored, setIgnored] = useState<Set<string>>(() => read(connectionId))

  const update = useCallback((change: (keys: Set<string>) => void) => {
    const next = new Set(ignored)
    change(next)
    write(connectionId, next)
    setIgnored(next)
  }, [connectionId, ignored])

  const ignore = useCallback((key: string) => update(keys => keys.add(key)), [update])
  /** Several at once (the bulk bar): one write, so none is lost to a stale set. */
  const ignoreAll = useCallback((list: readonly string[]) => update(keys => { for (const k of list) keys.add(k) }), [update])
  const restore = useCallback((key: string) => update(keys => keys.delete(key)), [update])
  return { ignored, ignore, ignoreAll, restore }
}

/** A drift to ignore or show again: the cluster it was read from and its `driftKey`. */
export type IgnoredDrift = { connectionId: string; key: string }

/**
 * The drifts ignored on every cluster of a policy, each one stored under its OWN cluster with the plain `driftKey`,
 * the key a policy of one cluster always used: the lists depend neither on the cluster the page was opened from nor on
 * which cluster is the anchor, and a list kept before an association goes on hiding its drifts afterwards. Kept in the
 * browser (a convenience, not shared); held in memory too, so an ignore lasts the session when the storage is blocked.
 */
export function useIgnoredClusterDrifts(clusterIds: readonly string[]) {
  const idsKey = clusterIds.join('\n')
  const [state, setState] = useState<{ key: string; byCluster: ReadonlyMap<string, ReadonlySet<string>> }>(
    () => ({ key: idsKey, byCluster: new Map((idsKey ? idsKey.split('\n') : []).map(id => [id, read(id)])) }),
  )
  let byCluster = state.byCluster
  if (state.key !== idsKey) {
    // Another group: a cluster already known keeps its list (its session ignores included), a new one is read.
    byCluster = new Map((idsKey ? idsKey.split('\n') : []).map(id => [id, state.byCluster.get(id) ?? read(id)]))
    setState({ key: idsKey, byCluster })
  }

  const isIgnored = useCallback((connectionId: string, key: string) => !!byCluster.get(connectionId)?.has(key), [byCluster])
  const change = useCallback((items: readonly IgnoredDrift[], add: boolean) => {
    setState(prev => {
      const next = new Map(prev.byCluster)
      for (const item of items) {
        const keys = new Set(next.get(item.connectionId) ?? read(item.connectionId))
        if (add) keys.add(item.key)
        else keys.delete(item.key)
        next.set(item.connectionId, keys)
      }
      for (const connectionId of new Set(items.map(i => i.connectionId))) write(connectionId, next.get(connectionId) as Set<string>)
      return { key: prev.key, byCluster: next }
    })
  }, [])
  /** One or several at once (the bulk bar): one write per cluster. */
  const ignore = useCallback((items: readonly IgnoredDrift[]) => change(items, true), [change])
  const restore = useCallback((item: IgnoredDrift) => change([item], false), [change])
  return { isIgnored, ignore, restore }
}
