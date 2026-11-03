/**
 * French wording of /automation/network (recette D4): "pare-feu" and "groupe de sécurité" throughout, never the
 * English "firewall" or "Security Group", and a space before every colon of the Dashboard strings.
 */

import { describe, expect, it } from 'vitest'

import fr from './fr.json'

const flatten = (node: unknown, prefix = ''): [string, string][] => {
  if (typeof node === 'string') return [[prefix, node]]
  if (!node || typeof node !== 'object') return []
  return Object.entries(node).flatMap(([key, value]) => flatten(value, prefix ? `${prefix}.${key}` : key))
}

describe('French wording of the network page', () => {
  const strings = flatten({ networkPage: fr.networkPage, network: fr.network, firewall: fr.firewall })

  it('says pare-feu and groupe de sécurité, not firewall or Security Group', () => {
    const english = strings.filter(([, value]) => /firewall|security group/i.test(value)).map(([key]) => key)
    expect(english).toEqual([])
  })

  it('names the tabs in French', () => {
    expect(fr.firewall.dashboard).toBe('Tableau de bord')
    expect(fr.networkPage.tabFirewalling).toBe('Pare-feu')
    expect(fr.networkPage.tabSecurityGroups).toBe('Groupes de sécurité')
  })

  it('puts a space before every colon of the Dashboard strings', () => {
    const glued = flatten(fr.networkPage.dashboard).filter(([, value]) => /[^\s  ]:/.test(value)).map(([key]) => key)
    expect(glued).toEqual([])
  })
})
