import type { FlowMatrixData, FlowMatrixCell, FlowStatus, FirewallRule, NetworkInfo } from '../types'

interface DeriveFlowMatrixParams {
  networks: NetworkInfo[]
  clusterRules: FirewallRule[]
  securityGroups: { group: string; rules?: FirewallRule[] }[]
  aliases: { name: string; cidr: string }[]
}

export function deriveFlowMatrix({
  networks,
  clusterRules,
  securityGroups,
  aliases,
}: DeriveFlowMatrixParams): FlowMatrixData {
  const labels = networks.map((n) => n.name)

  // Build alias→cidr and cidr→networkName lookups
  const aliasToCidr = new Map<string, string>()

  aliases.forEach((a) => {
    aliasToCidr.set(a.name.toLowerCase(), a.cidr)
  })

  const cidrToNetwork = new Map<string, string>()

  networks.forEach((n) => {
    cidrToNetwork.set(n.cidr, n.name)
  })

  // Collect all rules (cluster + SG rules)
  const allRules: FirewallRule[] = [
    ...clusterRules,
    ...securityGroups.flatMap((sg) => sg.rules || []),
  ]

  // Resolve a rule endpoint (source/dest) to a network name or null
  function resolveToNetwork(endpoint: string | undefined): string | null {
    if (!endpoint) return null

    // Direct network name match
    if (labels.includes(endpoint)) return endpoint

    // Alias match
    const aliasLower = endpoint.toLowerCase()
    const cidr = aliasToCidr.get(aliasLower)

    if (cidr) {
      const netName = cidrToNetwork.get(cidr)

      if (netName) return netName
    }

    // CIDR match
    const netByCidr = cidrToNetwork.get(endpoint)

    if (netByCidr) return netByCidr

    return null
  }

  // Build the matrix
  const matrix: FlowMatrixCell[][] = labels.map((fromLabel, fromIdx) => {
    return labels.map((toLabel, toIdx) => {
      // Diagonal = self
      if (fromIdx === toIdx) {
        return { from: fromLabel, to: toLabel, status: 'self' as FlowStatus, rules: [], summary: '' }
      }

      // Find matching rules for this pair
      const matchingRules: FirewallRule[] = []

      for (const rule of allRules) {
        if (rule.enable === 0) continue

        const srcNet = resolveToNetwork(rule.source)
        const dstNet = resolveToNetwork(rule.dest)

        // Match if rule references both networks or is a wildcard
        const srcMatch = !rule.source || srcNet === fromLabel
        const dstMatch = !rule.dest || dstNet === toLabel

        if (srcMatch && dstMatch) {
          matchingRules.push(rule)
        }
      }

      // Determine status
      let status: FlowStatus = 'blocked'

      if (matchingRules.length > 0) {
        const hasAccept = matchingRules.some((r) => r.action === 'ACCEPT')
        const hasDrop = matchingRules.some((r) => r.action === 'DROP' || r.action === 'REJECT')

        if (hasAccept && hasDrop) status = 'partial'
        else if (hasAccept) status = 'allowed'
        else status = 'blocked'
      }

      // Build protocol summary
      const summary = buildProtocolSummary(matchingRules)

      return { from: fromLabel, to: toLabel, status, rules: matchingRules, summary }
    })
  })

  return { labels, matrix }
}

function buildProtocolSummary(rules: FirewallRule[]): string {
  if (rules.length === 0) return 'None'

  const acceptRules = rules.filter((r) => r.action === 'ACCEPT')

  if (acceptRules.length === 0) return 'None'

  // Check for any rule without protocol restriction
  if (acceptRules.some((r) => !r.proto && !r.macro)) return 'All'

  const parts: string[] = []
  const ports = new Set<string>()

  for (const rule of acceptRules) {
    if (rule.macro) {
      parts.push(rule.macro)
      continue
    }

    const proto = (rule.proto || '').toUpperCase()

    if (rule.dport) {
      ports.add(`${proto} ${rule.dport}`)
    } else {
      parts.push(proto)
    }
  }

  return [...parts, ...ports].join(' / ') || 'All'
}
