import { describe, expect, it } from 'vitest'

import en from '@/messages/en.json'
import fr from '@/messages/fr.json'

import { migrationProgressMessage } from './migrationProgress'

const translator = (messages: Record<string, any>) => (key: string, values: Record<string, string> = {}) => {
  const template = key.split('.').reduce((node, part) => node?.[part], messages) as unknown as string

  return template.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? '')
}

describe('migrationProgressMessage', () => {
  it('translates the step the orchestrator names', () => {
    const progress = { message: 'Live memory migration...', step: 'liveMemory' }

    expect(migrationProgressMessage(progress, translator(fr))).toBe('Migration live de la mémoire...')
    expect(migrationProgressMessage(progress, translator(en))).toBe('Live memory migration...')
  })

  it('carries the step detail into the copy step', () => {
    const progress = { message: 'Copying data: 1.0 GiB / 4.0 GiB', step: 'copying', step_detail: '1.0 GiB / 4.0 GiB' }

    expect(migrationProgressMessage(progress, translator(en))).toBe('Copying data: 1.0 GiB / 4.0 GiB')
  })

  it('shows the failure reason when the orchestrator has one', () => {
    const t = translator(en)

    expect(migrationProgressMessage({ message: 'x', step: 'failed', step_detail: 'no space left' }, t))
      .toBe('Migration failed: no space left')
    expect(migrationProgressMessage({ message: 'Migration failed', step: 'failed' }, t)).toBe('Migration failed')
  })

  it('falls back to the message for a raw log line or an unknown step', () => {
    const t = translator(en)

    expect(migrationProgressMessage({ message: 'TASK ERROR: boom' }, t)).toBe('TASK ERROR: boom')
    expect(migrationProgressMessage({ message: 'Something new', step: 'futureStep' }, t)).toBe('Something new')
  })

  it('has every step translated in every locale', async () => {
    const byName = (a: string, b: string) => a.localeCompare(b)
    const steps = Object.keys(en.drsPage.migrationSteps).sort(byName)

    for (const locale of ['fr', 'de', 'es', 'ko', 'zh-CN']) {
      const messages = (await import(`@/messages/${locale}.json`)).default

      expect(Object.keys(messages.drsPage.migrationSteps).sort(byName)).toEqual(steps)
    }
  })
})
