// Proxmox applies `ha-manager crm-command node-maintenance` asynchronously:
// the CRM picks the request up on its next round, so /cluster/resources keeps
// reporting the previous hastate for ~10 s after the command returned. A tree
// refreshed right away reads that stale state and keeps it in the inventory
// cache, which is how a node that left maintenance kept its maintenance icon
// and its "Exit maintenance" menu entry (ui#1164 recette).
//
// Polls the node's maintenance route until it reports the expected state, so
// the caller refreshes the inventory once Proxmox agrees. Resolves true once
// it does, false on timeout or when the route keeps failing; never throws.
export async function waitForNodeMaintenance(
  connId: string,
  node: string,
  inMaintenance: boolean,
  opts: { timeoutMs?: number; intervalMs?: number; sleep?: (ms: number) => Promise<void> } = {}
): Promise<boolean> {
  const timeoutMs = opts.timeoutMs ?? 45_000
  const intervalMs = opts.intervalMs ?? 2_000
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)))
  const url = `/api/v1/connections/${encodeURIComponent(connId)}/nodes/${encodeURIComponent(node)}/maintenance`

  for (let waited = 0; waited <= timeoutMs; waited += intervalMs) {
    try {
      const res = await fetch(url)
      if (res.ok) {
        const json = await res.json().catch(() => null)
        // An unreadable answer says nothing: only a real `data` is judged.
        if (json?.data && (json.data.maintenance === 'maintenance') === inMaintenance) return true
      }
    } catch {
      // A transient failure is retried like a stale answer.
    }
    if (waited + intervalMs > timeoutMs) break
    await sleep(intervalMs)
  }
  return false
}
