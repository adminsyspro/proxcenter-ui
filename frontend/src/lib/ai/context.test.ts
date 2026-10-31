/**
 * Guards the system prompt the assistant reads.
 *
 * `renderAiSystemPrompt` is deliberately pure so these assertions do not need
 * Proxmox, Prisma or RBAC mocked. Two things are load-bearing here: the answer
 * language block (#686), and the fact that the tool-aware prompt still forbids
 * writes while telling the model it may read more (#459). The stopped-guest cap
 * is also asserted, because the unbounded list it replaces used to crowd the
 * question out of a small model's context window.
 */

import { describe, it, expect } from 'vitest'

import {
  renderAiSystemPrompt,
  STOPPED_GUEST_PROMPT_CAP,
  RUNNING_GUEST_PROMPT_CAP,
  type AiAlert,
} from './context'
import type { SnapshotGuest, InventorySnapshot } from '@/lib/tools/snapshot'

function guest(overrides: Partial<SnapshotGuest> & { name: string; vmid: string }): SnapshotGuest {
  return {
    connId: 'conn-1',
    cluster: 'prod',
    type: 'VM',
    kind: 'qemu',
    status: 'running',
    node: 'pve1',
    cpuPct: 5,
    memPct: 40,
    memUsedGb: 2,
    memTotalGb: 4,
    template: false,
    ...overrides,
  }
}

function snapshot(overrides: Partial<InventorySnapshot> = {}): InventorySnapshot {
  const guests = overrides.guests ?? [
    guest({ name: 'db-01', vmid: '101', cpuPct: 80, memPct: 90 }),
    guest({ name: 'web-01', vmid: '102', cpuPct: 10, memPct: 20 }),
  ]

  const running = guests.filter(g => g.status === 'running').length

  return {
    clusters: [{ id: 'conn-1', name: 'prod', nodeCount: 1, guestCount: guests.length }],
    nodes: [{
      connId: 'conn-1',
      cluster: 'prod',
      name: 'pve1',
      status: 'online',
      cpuPct: 12.5,
      cores: 32,
      memPct: 50,
      memUsedGb: 64,
      memTotalGb: 128,
    }],
    summary: {
      totalGuests: guests.length,
      runningGuests: running,
      stoppedGuests: guests.length - running,
      totalNodes: 1,
      onlineNodes: 1,
    },
    cached: false,
    ...overrides,
    guests,
  }
}

function render(opts: Parameters<typeof renderAiSystemPrompt>[4] = {}, locale = 'en', lang = 'en', alerts: AiAlert[] = []) {
  return renderAiSystemPrompt(snapshot(), alerts, lang, locale, opts)
}

describe('answer language (#686)', () => {
  it.each([
    ['de', 'German'],
    ['es', 'Spanish'],
    ['ko', 'Korean'],
    ['zh-CN', 'Simplified Chinese'],
  ])('asks for the answer in the caller language (%s) on the English body', (locale, language) => {
    const prompt = render({}, locale)

    expect(prompt).toContain(`Respond in ${language} concisely`)
    expect(prompt).toContain(`written in ${language}`)
    expect(prompt).not.toContain('Respond in English concisely')
  })

  it('keeps the French body coherent for a French caller', () => {
    const prompt = render({}, 'fr', 'fr')

    expect(prompt).toContain('Réponds en français de manière concise')
    expect(prompt).toContain('written in French')
    expect(prompt).not.toContain('Respond in')
  })

  it('closes with the language instruction, where models weigh it most', () => {
    const prompt = render({}, 'de')

    expect(prompt.trimEnd().endsWith('This overrides any other language mentioned in this prompt.')).toBe(true)
  })
})

describe('tool awareness (#459)', () => {
  it('tells the model it cannot act at all when no tool is attached', () => {
    const prompt = render({ toolsEnabled: false })

    expect(prompt).toContain('You CANNOT execute actions')
    expect(prompt).toContain('Use ONLY the data above')
    expect(prompt).not.toContain('read-only tools')
  })

  it('offers the read-only tools while still forbidding any change', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('read-only tools')
    // The four data families the issue asked for must be advertised by name,
    // or a small model never thinks to reach for them.
    expect(prompt).toContain('VM hardware sizing')
    expect(prompt).toContain('physical disks')
    expect(prompt).toContain('storage capacity')
    expect(prompt).toContain('Ceph health, OSDs and latency')

    // The write ban survives the switch to tools. This is the line that keeps
    // an agentic assistant from being sold as one that can act.
    expect(prompt).toContain('cannot create, modify, migrate, start, stop or delete')
    expect(prompt).toContain('Use ONLY the data above or data returned by a tool call')
  })

  it('forbids inventing a figure the model was not given', () => {
    expect(render({ toolsEnabled: true })).toContain('Never guess a number you have not been given')
  })

  // Observed on qwen2.5:7b against the lab cluster: the model prefixed its
  // answer with "we could run the following:" and an open JSON fence, then
  // transcribed the entire get_ceph_status payload rather than answering "what
  // can be improved in Ceph?".
  it('forbids displaying a tool call, or naming a data field', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('never SHOW the call')
    expect(prompt).toContain('we could run')
    // The second attempt answered "according to the observations", leaking the
    // field name it had been handed.
    expect(prompt).toContain('data field name')
    expect(prompt).toContain('State what a value IS, never where it came from')
  })

  // The correction to the transcription above overshot: the model collapsed to
  // "there are improvements to make in the Ceph cluster" and named none, which
  // is worse than the dump. The instruction therefore demands substance rather
  // than banning length, and that balance is what these two tests hold.
  it('demands each finding by name with its measured value', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('ANSWER WITH THE SPECIFIC FINDINGS, never in generalities')
    expect(prompt).toContain('list EVERY one that bears on the question')
    expect(prompt).toContain('with its figure')
  })

  it('names the empty answer as a failure, not merely as undesirable', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('FORBIDDEN to write that improvements exist')
    expect(prompt).toContain('A summary that names nothing is a failed answer')
    // The retreat wording that caused the collapse must not come back.
    expect(prompt).not.toContain('Do not restate the whole tool result')
    expect(prompt).not.toContain('ignore the rest')
  })

  it('repeats the substance rule in the closing list, where the tail is weighed most', () => {
    const prompt = render({ toolsEnabled: true })
    const tail = prompt.slice(prompt.indexOf('=== INSTRUCTIONS ==='))

    expect(tail).toContain('Name every finding with its figure')
    expect(tail).toContain('never answer that improvements or problems merely exist')
  })

  it('warns that the top lists rank usage, not assigned sizing, once tools are attached', () => {
    // The RAM top 10 prints "(28.3/32 GB)" totals, which qwen2.5:7b and
    // qwen3:8b read as the assigned-memory ranking and answered from, missing
    // the idle guest with the most RAM assigned.
    const withTools = render({ toolsEnabled: true })
    const without = render()

    expect(withTools).toContain('current USAGE only')
    expect(withTools).toContain('call the hardware ranking tool')
    expect(without).not.toContain('current USAGE only')
  })

  it('keeps the tool rules out of the toolless prompt, which has no tool to hide', () => {
    const prompt = render({ toolsEnabled: false })

    expect(prompt).not.toContain('ANSWER WITH THE SPECIFIC FINDINGS')
    expect(prompt).not.toContain('Name every finding with its figure')
  })

  /*
   * The third and worst recette failure. Told never to mention a tool call, and
   * separately that it could not execute actions and should explain the
   * procedure instead, qwen2.5:7b stopped CALLING tools altogether: it answered
   * from the snapshot, wrote that "the data provided does not contain specific
   * information", and handed back a four-step procedure telling the user to run
   * `ceph health detail` themselves.
   *
   * That failure is invisible from the outside: nothing errors, the assistant
   * just quietly goes back to being non-agentic. These tests pin the framing
   * that fixes it, because a future prompt edit that reintroduces a blanket
   * "you cannot" would silently switch the whole feature off again.
   */
  it('presents calling a tool as normal and expected, not as an exception', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('CALLING A TOOL IS NORMAL AND EXPECTED')
    expect(prompt).toContain('call several if needed')
  })

  it('forbids deferring a lookup to the user', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('NEVER tell the user to run a command')
    expect(prompt).toContain('call the tool that returns it')
    expect(prompt).toContain('without having called a tool is a failure')
  })

  it('frames the silence rule as hiding the call, never as avoiding it', () => {
    const prompt = render({ toolsEnabled: true })

    // "Call tools freely, but never SHOW the call" cannot be read as "do not
    // call"; the earlier "NEVER mention a tool call" could, and was.
    expect(prompt).toContain('Call tools freely, but never SHOW the call')
    expect(prompt).not.toContain('NEVER mention, announce, describe or display a tool call')
  })

  it('narrows the write ban to changing things, never to reading them', () => {
    const prompt = render({ toolsEnabled: true })

    expect(prompt).toContain('You can read anything and CHANGE nothing')
    expect(prompt).toContain('applies ONLY to changing the infrastructure, never to reading it')
    // The blanket wording of the toolless prompt must not reach the tool one.
    expect(prompt).not.toContain('You CANNOT execute actions')
  })

  it('scopes the closing action rule to changes once tools are attached', () => {
    const withTools = render({ toolsEnabled: true })
    const withoutTools = render({ toolsEnabled: false })

    expect(withTools).toContain('For a request to CHANGE something')
    expect(withTools).toContain('call the tool instead of explaining how to look it up')
    // This generic line is what produced the manual procedure.
    expect(withTools).not.toContain('For actions, explain the procedure but specify you cannot execute it')
    expect(withoutTools).toContain('For actions, explain the procedure but specify you cannot execute it')
  })

  it('leads with what the model may do and closes with the limit', () => {
    const prompt = render({ toolsEnabled: true })

    // A limitation that leads reads as a general inability to act.
    expect(prompt.indexOf('CALLING A TOOL IS NORMAL AND EXPECTED'))
      .toBeLessThan(prompt.indexOf('You can read anything and CHANGE nothing'))
  })

  it('keeps the French tool wording for a French caller', () => {
    const prompt = renderAiSystemPrompt(snapshot(), [], 'fr', 'fr', { toolsEnabled: true })

    expect(prompt).toContain('outils en lecture seule')
    expect(prompt).toContain('RÉPONDS PAR LES CONSTATS PRÉCIS')
    expect(prompt).toContain('Un résumé qui ne nomme rien est une réponse ratée')
    expect(prompt).toContain('nous pourrions exécuter')
    expect(prompt).toContain('APPELER UN OUTIL EST NORMAL ET ATTENDU')
    expect(prompt).toContain('C\'est toi qui récupères les données')
    expect(prompt).toContain('Tu peux tout lire et ne rien MODIFIER')
    expect(prompt).not.toContain('read-only tools')
    expect(prompt).not.toContain('ANSWER WITH THE SPECIFIC FINDINGS')
  })
})

describe('infrastructure sections', () => {
  it('reports the summary, the hosts and the top consumers', () => {
    const prompt = render()

    expect(prompt).toContain('2 VMs/CTs total (2 running, 0 stopped)')
    expect(prompt).toContain('1 host(s) (1 online)')
    expect(prompt).toContain('pve1 (prod)')
    expect(prompt).toContain('CPU: 12.5%')
    // Ranked by usage, so the busy guest leads.
    expect(prompt.indexOf('1. db-01')).toBeLessThan(prompt.indexOf('2. web-01'))
  })

  it('states there is no alert rather than staying silent about alerts', () => {
    expect(render()).toContain('No active alerts.')
  })

  it('lists an active alert with its severity', () => {
    const prompt = render({}, 'en', 'en', [
      { severity: 'critical', message: 'OSD latency above threshold', entityName: 'osd.3', entityType: 'ceph' },
    ])

    expect(prompt).toContain('Active alerts (1)')
    expect(prompt).toContain('[CRITICAL] OSD latency above threshold (osd.3)')
  })

  it('surfaces Ceph health when the cluster reports it', () => {
    const snap = snapshot()

    snap.clusters[0].cephHealth = 'HEALTH_WARN'

    expect(renderAiSystemPrompt(snap, [], 'en', 'en')).toContain('prod: HEALTH_WARN')
  })

  it('omits the Ceph section entirely on a cluster without Ceph', () => {
    expect(render()).not.toContain('🪣')
  })

  it('emits a terser host line for the streaming route', () => {
    const prompt = render({ terse: true })

    expect(prompt).toContain('- pve1: online | CPU: 12.5% | RAM: 50%')
    expect(prompt).not.toContain('pve1 (prod)')
  })
})

describe('list caps', () => {
  it('caps the stopped list and points the model at the listing tool', () => {
    const stopped = Array.from({ length: STOPPED_GUEST_PROMPT_CAP + 15 }, (_, i) =>
      guest({ name: `old-${i}`, vmid: String(500 + i), status: 'stopped' })
    )

    const prompt = renderAiSystemPrompt(snapshot({ guests: stopped }), [], 'en', 'en', { toolsEnabled: true })

    expect(prompt).toContain(`STOPPED VMs/CTs (${STOPPED_GUEST_PROMPT_CAP + 15} total)`)
    expect(prompt).toContain('and 15 more stopped VMs/CTs')
    expect(prompt).toContain('guest listing tool')

    // The 41st stopped guest must not be inlined: the unbounded list this
    // replaces is what pushed the question out of the context window.
    expect(prompt).toContain('old-0 ')
    expect(prompt).not.toContain(`old-${STOPPED_GUEST_PROMPT_CAP} `)
  })

  it('caps the running list the same way', () => {
    const running = Array.from({ length: RUNNING_GUEST_PROMPT_CAP + 5 }, (_, i) =>
      guest({ name: `app-${i}`, vmid: String(600 + i) })
    )

    const prompt = renderAiSystemPrompt(snapshot({ guests: running }), [], 'en', 'en')

    expect(prompt).toContain('first 20 shown')
    expect(prompt).toContain('and 5 more running VMs/CTs')
  })

  it('leaves the caps unmentioned when everything fits', () => {
    const prompt = render()

    expect(prompt).not.toContain('and 0 more')
    expect(prompt).not.toContain('first 20 shown')
  })
})

describe('an empty estate', () => {
  it('still produces a usable prompt', () => {
    const empty: InventorySnapshot = {
      clusters: [],
      nodes: [],
      guests: [],
      summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 0, onlineNodes: 0 },
      cached: false,
    }

    const prompt = renderAiSystemPrompt(empty, [], 'en', 'en', { toolsEnabled: true })

    expect(prompt).toContain('0 cluster(s) configured: none')
    expect(prompt).toContain('No active alerts.')
    expect(prompt).toContain('written in English')
  })
})
