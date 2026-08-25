/**
 * Reading guest NIC MAC addresses off a Proxmox cluster.
 *
 * This is what lets a sampled flow be attributed to a guest when the guest's
 * interface is not a port of the sampled bridge, which is the case for every
 * guest behind an SDN VNet.
 */

// Matches an Ethernet address anywhere in a guest NIC line, whichever key
// carries it: virtio=, e1000=, vmxnet3= for VMs, hwaddr= for containers.
const MAC_RE = /[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}/

/**
 * The path matters, and the obvious one is wrong.
 *
 * `/etc/pve/qemu-server` is a per-node SYMLINK into `nodes/<local>/qemu-server`,
 * so it only lists the guests of the node answering the question: asking a node
 * that happens to host no guest returns nothing and no MAC is ever mapped.
 * `/etc/pve/nodes/*` is the cluster-wide view, and /etc/pve is a replicated
 * filesystem, so any member answers for the whole cluster.
 */
export const GUEST_MACS_COMMAND =
  `grep -H "^net" /etc/pve/nodes/*/qemu-server/*.conf /etc/pve/nodes/*/lxc/*.conf 2>/dev/null || true`

/**
 * Parse the grep output into a MAC (lower case) to guest id map.
 *
 * Lines look like:
 *   /etc/pve/nodes/pve3/qemu-server/101.conf:net0: virtio=BC:24:11:B6:00:5D,bridge=CLIENT
 *   /etc/pve/nodes/pve3/lxc/109.conf:net0: name=eth0,bridge=vmbr0,hwaddr=AA:BB:CC:DD:EE:FF
 *
 * A guest with a pending change yields two lines for the same net index, the
 * live one and the pending one. Both carry the same MAC and guest id, so the
 * map is unaffected.
 *
 * Keyed by MAC rather than by guest id on purpose: a guest with several NICs
 * contributes several addresses, and the lookup at attribution time only ever
 * has a MAC to go on.
 */
export function parseGuestMACs(output: string): Record<string, number> {
  const macs: Record<string, number> = {}

  for (const line of output.split("\n")) {
    const vmidMatch = /\/(\d+)\.conf:/.exec(line)
    if (!vmidMatch) continue
    const macMatch = MAC_RE.exec(line)
    if (!macMatch) continue
    macs[macMatch[0].toLowerCase()] = Number.parseInt(vmidMatch[1], 10)
  }

  return macs
}
