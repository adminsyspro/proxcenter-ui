/**
 * What Proxmox applies when `policy_in` / `policy_out` is absent from a
 * cluster or guest firewall config (pve-firewall: `policy_in || 'DROP'`,
 * `policy_out || 'ACCEPT'`). The API omits an unset policy, so any display
 * that falls back on something else shows a policy PVE is not enforcing.
 * Node options carry no policy: the host follows the cluster's.
 */
export const PVE_DEFAULT_POLICY_IN = 'DROP'
export const PVE_DEFAULT_POLICY_OUT = 'ACCEPT'

/**
 * A guest's firewall filters traffic only when it is enabled in the guest's
 * firewall options (PVE "Firewall: Yes") AND `firewall=1` is set on at least
 * one of its NICs. Either one alone does nothing.
 */
export function hasNICFirewall(config: Record<string, any> | null | undefined): boolean {
  if (!config) return false

  return Object.entries(config).some(([key, value]) =>
    /^net\d+$/.test(key) && typeof value === 'string' && /(^|,)firewall=1(,|$)/.test(value)
  )
}
