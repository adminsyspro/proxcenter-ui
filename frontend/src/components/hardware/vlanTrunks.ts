/**
 * The VLAN trunks of a NIC, as typed in the network dialogs. Proxmox VE writes
 * them as ids or ranges separated by ';' ("225;230;605-606"); a comma would
 * end the option inside the netN string, so commas and spaces typed by the
 * user are read as separators too and written back with ';'.
 */
const TOKEN = /^(\d+)(?:-(\d+))?$/

export function normalizeVlanTrunks(input: string): { value: string; valid: boolean } {
  const tokens = input.split(/[;,\s]+/).filter(Boolean)
  for (const token of tokens) {
    const m = TOKEN.exec(token)
    if (!m) return { value: input, valid: false }
    const start = Number(m[1])
    const end = m[2] === undefined ? start : Number(m[2])
    if (start < 1 || end > 4094 || end < start) return { value: input, valid: false }
  }
  return { value: tokens.join(';'), valid: true }
}

type Translate = ((key: string, values?: Record<string, string>) => string)

/**
 * Helper line of the trunks picker: the syntax error first, then the bridge
 * that cannot carry trunks (a Linux bridge that is not VLAN aware).
 */
export function trunksHelper(t: Translate, valid: boolean, unsupported: boolean, bridge: string): string | undefined {
  if (!valid) return t('hardware.nicVlanTrunksInvalid')
  if (unsupported) return t('hardware.nicTrunksNotVlanAware', { bridge })
  return undefined
}
