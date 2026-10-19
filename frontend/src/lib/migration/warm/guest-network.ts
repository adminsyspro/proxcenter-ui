/**
 * Keep a Linux guest's interface names across the migration.
 *
 * The MAC address is carried over, but the interface name is not: systemd
 * names a NIC after its slot, so `ens192` on vSphere comes up as `ens18` or
 * `enp6s18` on Proxmox, and every configuration that names the interface (a
 * NetworkManager profile, an ifcfg file, /etc/network/interfaces, netplan, a
 * VLAN parent, a firewall zone) no longer applies: the static IP is gone. The
 * guest conversion writes one systemd `.link` file per interface the guest
 * configuration names, matching the NIC by MAC and giving it its old name
 * back, so nothing else in the guest has to change.
 *
 * Which NIC a name belongs to comes from the source: VMware names a NIC
 * `ens<pciSlotNumber>`, XCP-ng's netfront `eth<device>` (`enX<device>` under
 * systemd 253 and later). A guest with a single
 * NIC whose configuration names a single interface gets it pinned whatever
 * the naming scheme was (biosdevname, `eno16777736`, ...). Anything else is
 * reported, never guessed.
 */

/** One target NIC: the MAC it keeps on Proxmox and the names it may have had on the source. */
export interface GuestNic { mac: string; names: string[] }

/** Where the in-guest script leaves its report, copied out of the overlay afterwards. */
export const NETWORK_PIN_REPORT = "/tmp/proxcenter-netpin.txt"

const MAC_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i
const NAME_RE = /^[A-Za-z0-9_-]{1,15}$/

/** MAC of a Proxmox `netN` value (`virtio,bridge=vmbr0,macaddr=..` or `virtio=..,bridge=vmbr0`). */
export function macOfNetValue(value: string): string | undefined {
  const mac = /(?:^|,)(?:macaddr|[a-z0-9]+)=((?:[0-9a-f]{2}:){5}[0-9a-f]{2})(?:,|$)/i.exec(value || "")?.[1]
  return mac?.toLowerCase()
}

/**
 * The target NICs in `netN` order, with the source names `namesOf(i)` gives
 * for the i-th one. A NIC without a fixed MAC (Proxmox draws one) cannot be
 * matched and is left out.
 */
export function guestNicsFromNets(nets: Record<string, string>, namesOf: (index: number) => string[]): GuestNic[] {
  const nics: GuestNic[] = []
  for (const [key, value] of Object.entries(nets || {})) {
    const index = Number(/^net(\d+)$/.exec(key)?.[1])
    const mac = macOfNetValue(value)
    if (!Number.isInteger(index) || !mac) continue
    nics.push({ mac, names: namesOf(index).filter(n => NAME_RE.test(n)) })
  }
  return nics
}

/**
 * The script virt-customize runs inside the guest (its own /bin/sh). It lists
 * the ethernet names the network configuration refers to, pins each one it can
 * attribute to a NIC, and writes one line per decision to NETWORK_PIN_REPORT:
 * `pinned <name> <mac>`, `unmatched <name>`, `kept <name>` (already pinned by
 * the guest), `nosystemd`.
 */
export function buildNetworkPinScript(nics: GuestNic[]): string {
  const table = nics
    .filter(n => MAC_RE.test(n.mac))
    .map(n => [n.mac.toLowerCase(), ...n.names.filter(x => NAME_RE.test(x))].join(" "))
    .join("\n")
  const single = nics.length === 1 && MAC_RE.test(nics[0].mac) ? nics[0].mac.toLowerCase() : ""
  return `#!/bin/sh
OUT=${NETWORK_PIN_REPORT}
DIR=/etc/systemd/network
NICS='${table}'
SINGLE='${single}'
: > "$OUT"
if [ ! -d /usr/lib/systemd ] && [ ! -d /lib/systemd ]; then echo nosystemd >> "$OUT"; exit 0; fi
# Kernel names (eth0) are what the guest gets anyway when it turned predictable names off.
NOIFNAMES=0
grep -qs 'net.ifnames=0' /etc/default/grub /etc/kernel/cmdline /boot/loader/entries/*.conf /boot/grub2/grubenv && NOIFNAMES=1
names=$( {
  sed -n -e 's/^interface-name=//p' -e 's/^parent=//p' /etc/NetworkManager/system-connections/* 2>/dev/null
  sed -n 's/^DEVICE=//p' /etc/sysconfig/network-scripts/ifcfg-* /etc/sysconfig/network/ifcfg-* 2>/dev/null
  for f in /etc/sysconfig/network-scripts/ifcfg-* /etc/sysconfig/network/ifcfg-*; do [ -f "$f" ] && echo "\${f##*/ifcfg-}"; done
  cat /etc/network/interfaces /etc/network/interfaces.d/* 2>/dev/null | awk '$1=="auto" || $1 ~ /^allow-/ { for (i = 2; i <= NF; i++) print $i } $1=="iface" { print $2 }'
  grep -hE '^[[:space:]]+(en|eth)[[:alnum:]_-]*:[[:space:]]*$' /etc/netplan/*.yaml 2>/dev/null | tr -d ' :\\t'
  sed -n 's/^Name=//p' /etc/systemd/network/*.network 2>/dev/null | tr ' ' '\\n'
} | tr -d "\\"'" | sed 's/[.:].*//' | grep -E '^(en|eth)[[:alnum:]_-]*$' | grep -vx ethernets | sort -u )
pin() {
  if grep -qsil "^MACAddress=$2" "$DIR"/*.link; then echo "kept $1" >> "$OUT"; return; fi
  mkdir -p "$DIR"
  printf '%s\\n' "# Written by ProxCenter when this guest was migrated to Proxmox VE:" \\
    "# the interface keeps the name it had on the source hypervisor." \\
    "[Match]" "MACAddress=$2" "" "[Link]" "Name=$1" > "$DIR/10-proxcenter-$1.link"
  echo "pinned $1 $2" >> "$OUT"
}
unmatched=""
used=""
for n in $names; do
  case "$n" in eth*) [ "$NOIFNAMES" = 1 ] && continue ;; esac
  mac=$(printf '%s\\n' "$NICS" | awk -v n="$n" '{ for (i = 2; i <= NF; i++) if ($i == n) { print $1; exit } }')
  case " $used " in *" $mac "*) mac="" ;; esac
  if [ -n "$mac" ]; then pin "$n" "$mac"; used="$used $mac"; else unmatched="$unmatched $n"; fi
done
set -- $unmatched
if [ $# -eq 1 ] && [ -n "$SINGLE" ] && [ -z "$used" ]; then pin "$1" "$SINGLE"; exit 0; fi
for n in $unmatched; do echo "unmatched $n" >> "$OUT"; done
exit 0
`
}

export interface NetworkPinReport { pinned: { name: string; mac: string }[]; kept: string[]; unmatched: string[]; noSystemd: boolean }

export function parseNetworkPinReport(text: string): NetworkPinReport {
  const report: NetworkPinReport = { pinned: [], kept: [], unmatched: [], noSystemd: false }
  for (const line of (text || "").split("\n")) {
    const [kind, name, mac] = line.trim().split(/\s+/)
    if (kind === "pinned" && name && mac) report.pinned.push({ name, mac })
    else if (kind === "kept" && name) report.kept.push(name)
    else if (kind === "unmatched" && name) report.unmatched.push(name)
    else if (kind === "nosystemd") report.noSystemd = true
  }
  return report
}

/** Job log lines for a report: what was pinned, and what the operator should look at. */
export function describeNetworkPinReport(r: NetworkPinReport): { msg: string; level: "success" | "info" | "warn" }[] {
  const lines: { msg: string; level: "success" | "info" | "warn" }[] = []
  if (r.noSystemd) {
    lines.push({ msg: "Guest network: no systemd in this guest, interface names were not pinned; check its network configuration after the first boot", level: "warn" })
    return lines
  }
  if (r.pinned.length > 0) {
    lines.push({ msg: `Guest network: ${r.pinned.map(p => `${p.name} (${p.mac})`).join(", ")} keep${r.pinned.length === 1 ? "s" : ""} the name ${r.pinned.length === 1 ? "it" : "they"} had on the source, so the guest network configuration still applies`, level: "success" })
  }
  if (r.kept.length > 0) lines.push({ msg: `Guest network: ${r.kept.join(", ")} already pinned to a MAC address by the guest, left as is`, level: "info" })
  if (r.unmatched.length > 0) {
    lines.push({ msg: `Guest network: the guest configuration names ${r.unmatched.join(", ")}, which could not be matched to a NIC of this VM; its name may change on Proxmox, check the network settings after the first boot`, level: "warn" })
  }
  return lines
}
