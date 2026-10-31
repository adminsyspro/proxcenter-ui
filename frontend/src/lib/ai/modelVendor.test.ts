import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { MODEL_VENDOR_ICONS, modelVendor } from './modelVendor'

describe('modelVendor', () => {
  it.each([
    ['qwen3.5:9b', 'qwen'],
    ['qwen3.6:35b-a3b-coding', 'qwen'],
    ['qwq:32b', 'qwen'],
    ['llama3.1:8b', 'meta'],
    ['codellama:13b', 'meta'],
    ['mistral-small3.2:24b', 'mistral'],
    ['mixtral:8x7b', 'mistral'],
    ['aratan/Ministral-3-14B-Reasoning-2512', 'mistral'],
    ['gemma4:12b', 'google'],
    ['gemini-2.5-pro', 'google-gemini'],
    ['gpt-oss:20b', 'openai'],
    ['gpt-4.1-mini', 'openai'],
    ['o3-mini', 'openai'],
    ['claude-haiku-4-5-20251001', 'anthropic'],
    ['deepseek-r1:14b', 'deepseek'],
    ['phi4:14b', 'microsoft'],
    ['granite3.3:8b', 'ibm'],
    ['command-r:35b', 'cohere'],
    ['nemotron-mini', 'nvidia'],
    ['hf.co/bartowski/Llama-3.2-3B-Instruct-GGUF', 'meta'],
  ])('%s is a %s model', (model, vendor) => {
    expect(modelVendor(model).vendor).toBe(vendor)
  })

  it('gives an unknown or empty name a neutral icon, never a wrong logo', () => {
    expect(modelVendor('my-finetune:7b')).toEqual({ vendor: 'generic', icon: 'ri-cpu-line' })
    expect(modelVendor('')).toEqual({ vendor: 'generic', icon: 'ri-cpu-line' })
    expect(modelVendor(undefined).vendor).toBe('generic')
  })

  it('only returns icons the Iconify bundle generates', () => {
    const bundle = readFileSync(join(__dirname, '../../assets/iconify-icons/bundle-icons-css.mjs'), 'utf8')

    for (const icon of MODEL_VENDOR_ICONS) {
      const [prefix, ...rest] = icon.startsWith('simple-icons-')
        ? ['simple-icons', icon.slice('simple-icons-'.length)]
        : [icon.split('-')[0], icon.slice(icon.indexOf('-') + 1)]

      expect(bundle).toContain(`'${prefix}:${rest.join('-')}'`)
    }
  })
})
