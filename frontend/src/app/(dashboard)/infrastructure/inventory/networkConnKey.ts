/**
 * Identity of the connection set the Network tree was loaded for. Clusters
 * stream in one by one on first load, so the tree compares this key to know
 * when a cluster arrived after its fetch and the data must be reloaded.
 */
export function networkConnKey(clusters: ReadonlyArray<{ connId?: string | null }>): string {
  return clusters
    .map(c => c.connId)
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => a.localeCompare(b))
    .join(',')
}
