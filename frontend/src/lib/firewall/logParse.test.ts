import { describe, it, expect } from 'vitest'

import { inferGroupAction, logLevelName, parseFirewallLogLine, ruleCandidates } from './logParse'

import type { FirewallRule } from '@/lib/api/firewall'

// Real lines, captured on the lab (PVE 9.2.11, CT 101, group r1114) for ui#1114.
const IPT_GROUP_ICMP = '0 6 GROUP-r1114-IN 15/Oct/2026:22:59:40 +0200 IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 MAC=bc:24:11:98:b7:a3:bc:24:11:70:26:06:08:00 SRC=10.42.0.101 DST=10.42.0.249 LEN=84 TOS=0x00 PREC=0x00 TTL=64 ID=5773 DF PROTO=ICMP TYPE=8 CODE=0 ID=37546 SEQ=1 '
const IPT_GROUP_9999 = '0 6 GROUP-r1114-IN 15/Oct/2026:22:59:42 +0200 IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 MAC=bc:24:11:98:b7:a3:bc:24:11:70:26:06:08:00 SRC=10.42.0.101 DST=10.42.0.249 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=30698 DF PROTO=TCP SPT=44876 DPT=9999 SEQ=1571512425 ACK=0 WINDOW=64240 SYN '
const IPT_VM_22 = '101 6 veth101i0-IN 15/Oct/2026:22:59:45 +0200 ACCEPT: IN=fwbr101i0 OUT=fwbr101i0 PHYSIN=fwln101i0 PHYSOUT=veth101i0 MAC=bc:24:11:98:b7:a3:bc:24:11:70:26:06:08:00 SRC=10.42.0.101 DST=10.42.0.249 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=61039 DF PROTO=TCP SPT=56950 DPT=22 SEQ=1996169277 ACK=0 WINDOW=64240 SYN '
const NFT_GROUP_9999 = '0 6 group-r1114-in 15/Oct/2026:23:00:39 +0200 DROP: OUT=fwbr101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=11331 DF PROTO=TCP SPT=37844 DPT=9999 SEQ=3574862068 ACK=0 WINDOW=64240 SYN '
const NFT_GUEST_22 = '101 6 guest-101-in 15/Oct/2026:23:00:41 +0200 ACCEPT: OUT=fwbr101i0 PHYSOUT=veth101i0 SRC=10.42.0.101 DST=10.42.0.249 LEN=60 TOS=0x00 PREC=0x00 TTL=64 ID=43143 DF PROTO=TCP SPT=44648 DPT=22 SEQ=1047568462 ACK=0 WINDOW=64240 SYN '
const POLICY_DROP = '100 6 tap100i0-IN 15/Oct/2026:10:00:00 +0200 policy DROP: IN=fwbr100i0 OUT=fwbr100i0 PHYSIN=fwln100i0 PHYSOUT=tap100i0 SRC=10.0.0.5 DST=10.0.0.7 LEN=60 PROTO=TCP SPT=40000 DPT=3389 SYN '

const GROUP_RULES: FirewallRule[] = [
  { pos: 0, type: 'in', action: 'ACCEPT', proto: 'icmp', log: 'info', enable: 1 },
  { pos: 1, type: 'in', action: 'DROP', proto: 'tcp', dport: '9999', log: 'info', enable: 1 },
]
const BOOK = { aliases: [], ipsets: [] }

describe('parseFirewallLogLine', () => {
  it('reads an iptables group line: VMID 0, group, guest from the interface, no action', () => {
    const p = parseFirewallLogLine(IPT_GROUP_9999)!

    expect(p).toMatchObject({
      vmid: 0, level: 6, chain: 'GROUP-r1114-IN', group: 'r1114', direction: 'in',
      guestVmid: 101, guestNic: 0, action: undefined, policy: false,
      src: '10.42.0.101', dst: '10.42.0.249', proto: 'TCP', sport: 44876, dport: 9999,
    })
    expect(p.ts).toBe(Date.UTC(2026, 9, 15, 20, 59, 42))
  })

  it('reads an nftables group line with its action and lowercase chain', () => {
    expect(parseFirewallLogLine(NFT_GROUP_9999)).toMatchObject({
      vmid: 0, chain: 'group-r1114-in', group: 'r1114', direction: 'in', action: 'DROP', guestVmid: 101,
    })
  })

  it('reads a guest rule line on both backends', () => {
    expect(parseFirewallLogLine(IPT_VM_22)).toMatchObject({ vmid: 101, action: 'ACCEPT', group: undefined, direction: 'in', dport: 22 })
    expect(parseFirewallLogLine(NFT_GUEST_22)).toMatchObject({ vmid: 101, action: 'ACCEPT', group: undefined, direction: 'in', dport: 22 })
  })

  it('keeps the bare packet flags apart from the fields, and names the level', () => {
    const p = parseFirewallLogLine(IPT_VM_22)!

    expect(p.flags).toEqual(['DF', 'SYN'])
    expect(p.fields).toMatchObject({ PHYSIN: 'fwln101i0', WINDOW: '64240', SEQ: '1996169277' })
    expect(logLevelName(p.level)).toBe('info')
    expect(logLevelName(9)).toBeUndefined()
  })

  it('flags a policy line', () => {
    expect(parseFirewallLogLine(POLICY_DROP)).toMatchObject({ vmid: 100, action: 'DROP', policy: true, guestVmid: 100 })
  })

  it('keeps the IP header ID and reads the ICMP type', () => {
    const p = parseFirewallLogLine(IPT_GROUP_ICMP)!

    expect(p.fields.ID).toBe('5773')
    expect(p.icmpType).toBe(8)
    expect(p.dport).toBeUndefined()
  })

  it('drops the logger lines and the "no content" placeholder', () => {
    expect(parseFirewallLogLine('0 5 - 15/Oct/2026:22:59:28 +0200 starting pvefw logger')).toBeNull()
    expect(parseFirewallLogLine('no content')).toBeNull()
  })
})

describe('inferGroupAction', () => {
  it('tells the ICMP accept from the TCP 9999 drop the iptables backend logged alike', () => {
    expect(inferGroupAction(parseFirewallLogLine(IPT_GROUP_ICMP)!, GROUP_RULES, BOOK)).toBe('ACCEPT')
    expect(inferGroupAction(parseFirewallLogLine(IPT_GROUP_9999)!, GROUP_RULES, BOOK)).toBe('DROP')
  })

  it('ignores disabled rules, other directions, unlogged rules and other log levels', () => {
    const line = parseFirewallLogLine(IPT_GROUP_9999)!
    const rules: FirewallRule[] = [
      { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', log: 'info' },             // disabled (no enable)
      { pos: 1, type: 'out', action: 'ACCEPT', proto: 'tcp', log: 'info', enable: 1 },
      { pos: 2, type: 'in', action: 'ACCEPT', proto: 'tcp', log: 'nolog', enable: 1 },
      { pos: 3, type: 'in', action: 'ACCEPT', proto: 'tcp', log: 'debug', enable: 1 },
      { pos: 4, type: 'in', action: 'DROP', proto: 'tcp', log: 'info', enable: 1 },
    ]

    expect(inferGroupAction(line, rules, BOOK)).toBe('DROP')
  })

  it('gives up when an earlier rule that may match disagrees', () => {
    const line = parseFirewallLogLine(IPT_GROUP_9999)!
    const rules: FirewallRule[] = [
      { pos: 0, type: 'in', action: 'ACCEPT', macro: 'Web', log: 'info', enable: 1 },
      { pos: 1, type: 'in', action: 'DROP', proto: 'tcp', dport: '9999', log: 'info', enable: 1 },
    ]

    expect(inferGroupAction(line, rules, BOOK)).toBeUndefined()
  })

  it('resolves port ranges and lists, CIDRs, aliases and ipsets', () => {
    const line = parseFirewallLogLine(IPT_GROUP_9999)!
    const book = {
      aliases: [{ name: 'lab', cidr: '10.42.0.0/24' }],
      ipsets: [{ name: 'admins', members: [{ cidr: '10.9.9.9' }, { cidr: '10.42.0.100/30' }] }],
    }

    const rule = (extra: Partial<FirewallRule>): FirewallRule[] => [{ pos: 0, type: 'in', action: 'REJECT', log: 'info', enable: 1, ...extra }]

    expect(inferGroupAction(line, rule({ proto: 'tcp', dport: '22,9000:10000' }), book)).toBe('REJECT')
    expect(inferGroupAction(line, rule({ source: '10.42.0.0/16' }), book)).toBe('REJECT')
    expect(inferGroupAction(line, rule({ source: 'dc/lab' }), book)).toBe('REJECT')
    expect(inferGroupAction(line, rule({ source: '+admins' }), book)).toBe('REJECT')
    expect(inferGroupAction(line, rule({ source: '10.42.0.100-10.42.0.110' }), book)).toBe('REJECT')
    expect(inferGroupAction(line, rule({ iface: 'net0' }), book)).toBe('REJECT')

    expect(inferGroupAction(line, rule({ dport: '22' }), book)).toBeUndefined()
    expect(inferGroupAction(line, rule({ source: '192.168.0.0/16' }), book)).toBeUndefined()
    expect(inferGroupAction(line, rule({ iface: 'net1' }), book)).toBeUndefined()
    expect(inferGroupAction(line, rule({ proto: 'udp' }), book)).toBeUndefined()
  })

  it('does not trust an ipset with nomatch holes nor an unknown alias alone', () => {
    const line = parseFirewallLogLine(IPT_GROUP_9999)!
    const book = { aliases: [], ipsets: [{ name: 'holey', members: [{ cidr: '10.42.0.0/24' }, { cidr: '10.42.0.101', nomatch: true }] }] }
    const rules: FirewallRule[] = [
      { pos: 0, type: 'in', action: 'ACCEPT', source: '+holey', log: 'info', enable: 1 },
      { pos: 1, type: 'in', action: 'DROP', log: 'info', enable: 1 },
    ]

    expect(inferGroupAction(line, rules, book)).toBeUndefined()
  })
})

describe('ruleCandidates', () => {
  it('names the one rule a line can come from', () => {
    expect(ruleCandidates(parseFirewallLogLine(IPT_GROUP_9999)!, GROUP_RULES, BOOK)).toEqual([1])
    expect(ruleCandidates(parseFirewallLogLine(IPT_GROUP_ICMP)!, GROUP_RULES, BOOK)).toEqual([0])
  })

  it('keeps an earlier "maybe" next to the sure match, so the view can say it is unsure', () => {
    const rules: FirewallRule[] = [
      { pos: 0, type: 'in', action: 'DROP', macro: 'Web', log: 'info', enable: 1 },
      { pos: 1, type: 'in', action: 'DROP', proto: 'tcp', dport: '9999', log: 'info', enable: 1 },
      { pos: 2, type: 'in', action: 'DROP', proto: 'tcp', log: 'info', enable: 1 },
    ]

    expect(ruleCandidates(parseFirewallLogLine(IPT_GROUP_9999)!, rules, BOOK)).toEqual([0, 1])
  })

  it('uses the logged action and skips group references on a guest line', () => {
    const rules: FirewallRule[] = [
      { pos: 0, type: 'group', action: 'r1114', enable: 1 },
      { pos: 1, type: 'in', action: 'DROP', proto: 'tcp', log: 'info', enable: 1 },
      { pos: 2, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', log: 'info', enable: 1 },
    ]

    expect(ruleCandidates(parseFirewallLogLine(IPT_VM_22)!, rules, BOOK)).toEqual([2])
    expect(ruleCandidates(parseFirewallLogLine(NFT_GUEST_22)!, rules, BOOK)).toEqual([2])
  })
})
