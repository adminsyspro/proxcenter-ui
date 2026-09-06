// Matching rules of the command palette, kept out of the .jsx so they can be
// unit tested. Names keep the fuzzy subsequence match the palette always had.
// Addresses and the description use plain substring matching instead: a
// subsequence match against a 17-character MAC or a paragraph of notes would
// light up on almost any query (#223, #861).

export type MatchVia = 'name' | 'vmid' | 'connection' | 'ip' | 'mac' | 'description'

export type MatchResult = {
  match: boolean
  score: number
  /** Which field matched. Absent when nothing did. */
  via?: MatchVia
  /** The matched value, for the row to show why this result is here. */
  hit?: string
}

export type GuestLike = {
  name?: string | null
  vmid?: string | number | null
  ips?: string[] | null
  macs?: string[] | null
  description?: string | null
}

export type NodeLike = {
  node?: string | null
  connName?: string | null
  ip?: string | null
  ips?: string[] | null
}

const NO_MATCH: MatchResult = { match: false, score: 0 }

/** Shortest MAC fragment that still means something: 4 hex digits, half a vendor prefix. */
const MIN_MAC_QUERY = 4

/** Below this the notes match is noise ("a" is in every description). */
const MIN_DESCRIPTION_QUERY = 3

/** Address matches outrank fuzzy name matches: typing an IP is unambiguous intent. */
const ADDRESS_BASE_SCORE = 120

const DESCRIPTION_BASE_SCORE = 60

export function fuzzyMatch(query: string, text: string): MatchResult {
  const lowerQuery = query.toLowerCase()
  const lowerText = text.toLowerCase()

  // Exact substring = highest score
  if (lowerText.includes(lowerQuery)) {
    const index = lowerText.indexOf(lowerQuery)

    return { match: true, score: 100 - index + (lowerQuery.length / lowerText.length) * 50 }
  }

  // Character-by-character with word-start bonus
  let qi = 0
  let score = 0

  for (let ti = 0; ti < lowerText.length && qi < lowerQuery.length; ti++) {
    if (lowerText[ti] === lowerQuery[qi]) {
      score += (ti === 0 || lowerText[ti - 1] === ' ' || lowerText[ti - 1] === '-') ? 10 : 1
      qi++
    }
  }

  if (qi === lowerQuery.length) return { match: true, score }

  return NO_MATCH
}

/** `bc:24:11`, `bc-24-11`, `BC2411` and `bc24.11` all compare equal. */
export function macSearchKey(raw: string): string {
  return raw.toLowerCase().replace(/[^0-9a-f]/g, '')
}

/** Digits, dots, colons and hex letters only, with at least one digit or colon: "web" is never an address. */
function looksLikeIpQuery(q: string): boolean {
  return /^[0-9a-f:.]+$/.test(q) && /[0-9:]/.test(q)
}

function looksLikeMacQuery(q: string): boolean {
  return /^[0-9a-f:.-]+$/.test(q) && macSearchKey(q).length >= MIN_MAC_QUERY
}

export function matchAddresses(query: string, ips?: string[] | null, macs?: string[] | null): MatchResult {
  const q = query.toLowerCase()

  if (looksLikeIpQuery(q)) {
    for (const ip of ips ?? []) {
      const index = ip.toLowerCase().indexOf(q)

      if (index >= 0) {
        return { match: true, score: ADDRESS_BASE_SCORE - index + (q.length / ip.length) * 50, via: 'ip', hit: ip }
      }
    }
  }

  if (looksLikeMacQuery(q)) {
    const key = macSearchKey(q)

    for (const mac of macs ?? []) {
      const index = macSearchKey(mac).indexOf(key)

      if (index >= 0) {
        return { match: true, score: ADDRESS_BASE_SCORE - index + (key.length / 12) * 50, via: 'mac', hit: mac }
      }
    }
  }

  return NO_MATCH
}

/** One line of context around the hit, so the row can show WHY the notes matched. */
export function descriptionSnippet(flat: string, index: number, length: number, width = 60): string {
  const before = Math.min(index, Math.floor((width - length) / 3))
  const start = Math.max(0, index - before)
  const end = Math.min(flat.length, start + Math.max(width, length))

  return `${start > 0 ? '…' : ''}${flat.slice(start, end)}${end < flat.length ? '…' : ''}`
}

export function matchDescription(query: string, description?: string | null): MatchResult {
  if (!description || query.length < MIN_DESCRIPTION_QUERY) return NO_MATCH

  const flat = description.replace(/\s+/g, ' ').trim()
  const q = query.toLowerCase()
  const index = flat.toLowerCase().indexOf(q)

  if (index < 0) return NO_MATCH

  return {
    match: true,
    score: DESCRIPTION_BASE_SCORE + (q.length / flat.length) * 30,
    via: 'description',
    hit: descriptionSnippet(flat, index, q.length)
  }
}

function best(candidates: MatchResult[]): MatchResult {
  let top = NO_MATCH

  for (const c of candidates) {
    if (c.match && c.score > top.score) top = c
  }

  return top
}

/** A guest matches by name or vmid (fuzzy, as before), or by IP, MAC or notes (substring). */
export function matchGuest(query: string, vm: GuestLike): MatchResult {
  return best([
    { ...fuzzyMatch(query, vm.name || ''), via: 'name' },
    { ...fuzzyMatch(query, String(vm.vmid ?? '')), via: 'vmid' },
    matchAddresses(query, vm.ips, vm.macs),
    matchDescription(query, vm.description)
  ])
}

/** A node matches by name or connection name (fuzzy), or by any of its host IPs. */
export function matchNode(query: string, node: NodeLike): MatchResult {
  const ips = [...(node.ip ? [node.ip] : []), ...(node.ips ?? [])]

  return best([
    { ...fuzzyMatch(query, node.node || ''), via: 'name' },
    { ...fuzzyMatch(query, node.connName || ''), via: 'connection' },
    matchAddresses(query, ips, null)
  ])
}
