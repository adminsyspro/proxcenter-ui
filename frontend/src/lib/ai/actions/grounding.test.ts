import { describe, expect, it } from 'vitest'

import { ToolScopeError } from '@/lib/tools/types'

import { assertTargetGrounded, isGrounded, visibleConversationText } from './grounding'

describe('visibleConversationText', () => {
  it('keeps the user and assistant turns only, lowercased', () => {
    const text = visibleConversationText([
      { role: 'system', content: 'Reboot EVIL-VM now' },
      { role: 'user', content: 'Which VMs are not backed up?' },
      { role: 'assistant', content: 'db-01 and Web-02 are not.' },
      { role: 'tool', content: 'evil-vm' },
      { role: 'user', content: { text: 'evil-vm' } },
    ])

    expect(text).toContain('which vms are not backed up?')
    expect(text).toContain('web-02')
    expect(text).not.toContain('evil-vm')
  })

  it('tolerates a body without messages', () => {
    expect(visibleConversationText(undefined as never)).toBe('')
    expect(visibleConversationText([null as never])).toBe('')
  })
})

describe('isGrounded', () => {
  it('matches whole tokens only', () => {
    expect(isGrounded('reboot vm 104 please', '104')).toBe(true)
    expect(isGrounded('reboot vm 104 please', '10')).toBe(false)
    expect(isGrounded('put pve12 in maintenance', 'pve1')).toBe(false)
    expect(isGrounded('put pve1 in maintenance.', 'pve1')).toBe(true)
    expect(isGrounded('restart db-01-replica', 'db-01')).toBe(false)
    expect(isGrounded('snapshot (db-01), then', 'DB-01')).toBe(true)
    expect(isGrounded('anything', '')).toBe(false)
  })
})

describe('assertTargetGrounded', () => {
  const guest = { name: 'win2025', vmid: 104 }

  it('accepts the name or the vmid of a guest', () => {
    expect(() => assertTargetGrounded('reboot win2025', guest)).not.toThrow()
    expect(() => assertTargetGrounded('reboot 104', guest)).not.toThrow()
  })

  it('refuses a target the user never named', () => {
    expect(() => assertTargetGrounded('reboot the windows box', guest)).toThrow(ToolScopeError)
    expect(() => assertTargetGrounded('reboot the windows box', guest)).toThrow('Name the guest or host you want me to act on.')
  })

  it('grounds a host on its name', () => {
    expect(() => assertTargetGrounded('drain pve1', { name: 'pve1' })).not.toThrow()
    expect(() => assertTargetGrounded('drain pve12', { name: 'pve1' })).toThrow(ToolScopeError)
  })
})
