import { describe, expect, it } from 'vitest'

import { ToolScopeError } from '@/lib/tools/types'

import { assertTargetGrounded, conversationGrounding, isGrounded, UNGROUNDED_TARGET_MESSAGE, visibleConversationText } from './grounding'

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
  const said = (text: string) => ({ visibleText: text, userText: text })

  it('accepts the name or the vmid of a guest', () => {
    expect(() => assertTargetGrounded(said('reboot win2025'), guest)).not.toThrow()
    expect(() => assertTargetGrounded(said('reboot 104'), guest)).not.toThrow()
  })

  it('takes a vmid from the user turns only', () => {
    const g = conversationGrounding([
      { role: 'user', content: 'how long has pve1 been up?' },
      { role: 'assistant', content: 'pve1 has been up 104 days.' },
      { role: 'user', content: 'reboot it' },
    ])

    expect(g.userText).not.toContain('104')
    expect(() => assertTargetGrounded(g, guest)).toThrow(ToolScopeError)
    expect(() => assertTargetGrounded(g, { name: 'pve1' })).not.toThrow()
  })

  it('refuses a target the user never named', () => {
    expect(() => assertTargetGrounded(said('reboot the windows box'), guest)).toThrow(ToolScopeError)
    expect(() => assertTargetGrounded(said('reboot the windows box'), guest)).toThrow(UNGROUNDED_TARGET_MESSAGE)
  })

  it('grounds a guest on the host it runs on, for a migration only, from the same text as its name', () => {
    const onPve1 = { name: 'win2025', vmid: 104, node: 'pve1' }
    const byHost = { byHost: true }
    const answered = conversationGrounding([
      { role: 'user', content: 'what is wrong?' },
      { role: 'assistant', content: 'pve1 is overloaded.' },
    ])

    expect(() => assertTargetGrounded(said('move everything off pve1'), onPve1, byHost)).not.toThrow()
    expect(() => assertTargetGrounded(said('move everything off pve12'), onPve1, byHost)).toThrow(ToolScopeError)
    expect(() => assertTargetGrounded(answered, onPve1, byHost)).not.toThrow()
    expect(() => assertTargetGrounded(answered, onPve1, { ...byHost, userOnly: true })).toThrow(ToolScopeError)
    // A shutdown or a reboot never: "is pve1 healthy?" names no guest of pve1.
    expect(() => assertTargetGrounded(said('is pve1 healthy?'), onPve1, { userOnly: true })).toThrow(ToolScopeError)
    // A host target has no vmid: its own name grounds it, not a node field.
    expect(() => assertTargetGrounded(said('move everything off pve1'), { name: 'pve2', node: 'pve1' }, byHost)).toThrow(ToolScopeError)
  })

  it('grounds a host on its name', () => {
    expect(() => assertTargetGrounded(said('drain pve1'), { name: 'pve1' })).not.toThrow()
    expect(() => assertTargetGrounded(said('drain pve12'), { name: 'pve1' })).toThrow(ToolScopeError)
  })
})
