import { describe, expect, it } from 'vitest'
import { sensitiveNicPermissions } from './nicPermissions'

const mac = 'AA:BB:CC:DD:EE:01'
const current = { net0: `virtio=${mac},bridge=vmbr0,tag=12,trunks=20;30` }
const MAC = 'vm.config.nic.mac'
const VLAN = 'vm.config.nic.vlan'

describe('sensitive NIC changes', () => {
  it('preserves link-only changes and equivalent MAC aliases and VLAN ordering', () => {
    expect(sensitiveNicPermissions({ net0: `virtio,macaddr=${mac.toLowerCase()},bridge=vmbr0,tag=012,trunks=30;20,link_down=1` }, current)).toEqual([])
  })
  it('requires independent rights including omissions that reset values', () => {
    expect(sensitiveNicPermissions({ net0: 'virtio,bridge=vmbr0' }, current)).toEqual([MAC, VLAN])
    expect(sensitiveNicPermissions({ net0: current.net0.replace(mac, 'AA:BB:CC:DD:EE:02') }, current)).toEqual([MAC])
    expect(sensitiveNicPermissions({ net0: current.net0.replace('20;30', '20;40') }, current)).toEqual([VLAN])
  })
  it('allows automatic MAC and ordinary deletion, but gates explicit creation', () => {
    expect(sensitiveNicPermissions({ net1: 'virtio,bridge=vmbr0' }, current)).toEqual([])
    expect(sensitiveNicPermissions({ net1: `virtio=${mac},bridge=vmbr0,tag=12` }, current)).toEqual([MAC, VLAN])
    expect(sensitiveNicPermissions({ delete: 'net0' }, current)).toEqual([])
  })
  it('checks reverted running values instead of trusting the effective values', () => {
    expect(sensitiveNicPermissions({ revert: 'net0' }, current, { net0: 'virtio=AA:BB:CC:DD:EE:02,bridge=vmbr0,tag=13' })).toEqual([MAC, VLAN])
    expect(sensitiveNicPermissions({ revert: 'net0' }, current, current)).toEqual([])
    expect(() => sensitiveNicPermissions({ revert: 'net0' }, current)).toThrow()
  })
  it('handles LXC hwaddr and rejects ambiguous duplicate protected aliases', () => {
    expect(sensitiveNicPermissions({ net0: 'name=eth0,hwaddr=AA:BB:CC:DD:EE:02,bridge=vmbr0' }, { net0: `name=eth0,hwaddr=${mac},bridge=vmbr0` })).toEqual([MAC])
    expect(() => sensitiveNicPermissions({ net0: `virtio=${mac},macaddr=AA:BB:CC:DD:EE:02` })).toThrow()
    expect(() => sensitiveNicPermissions({ net0: 'virtio,tag=12,tag=13' })).toThrow()
  })
  it('reads PVE trunk ranges and treats an equivalent spelling as unchanged', () => {
    const ranged = { net0: `virtio=${mac},bridge=vmbr0,trunks=100-120;305` }
    expect(sensitiveNicPermissions({ net0: `virtio=${mac},bridge=vmbr0,trunks=305;100-110;111-120,link_down=1` }, ranged)).toEqual([])
    expect(sensitiveNicPermissions({ net0: `virtio=${mac},bridge=vmbr0,trunks=100-121;305` }, ranged)).toEqual([VLAN])
    expect(() => sensitiveNicPermissions({ net0: 'virtio,bridge=vmbr0,trunks=120-100' })).toThrow()
    expect(() => sensitiveNicPermissions({ net0: 'virtio,bridge=vmbr0,trunks=1-4095' })).toThrow()
  })
})
