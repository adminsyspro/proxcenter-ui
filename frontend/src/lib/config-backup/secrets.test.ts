import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { openSecrets, sealSecrets } from './secrets'

// Same primitive as src/lib/crypto/secret.ts, keyed explicitly so a test can
// play two installs with different APP_SECRETs.
function keyed(secret: string) {
  const key = createHash('sha256').update(secret).digest()

  return {
    encrypt(plain: string) {
      const iv = randomBytes(12)
      const cipher = createCipheriv('aes-256-gcm', key, iv)
      const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
      return `${iv.toString('base64')}.${cipher.getAuthTag().toString('base64')}.${enc.toString('base64')}`
    },
    decrypt(payload: string) {
      const [iv, tag, data] = payload.split('.')
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8')
    },
  }
}

const source = keyed('source-install')
const target = keyed('target-install')

describe('openSecrets / sealSecrets', () => {
  it('moves a sealed column, a prefixed value and a secret inside JSON text to another key', () => {
    const rows = {
      Connection: [{ id: 'c1', apiTokenEnc: source.encrypt('root@pam!tok=abc'), name: 'PVE' }],
      settings: [{ key: 'ai', value: { provider: 'openai', openaiKey: `enc:${source.encrypt('sk-123')}` } }],
      notification_channels: [{ id: 1, config: JSON.stringify({ host: 'smtp', password: source.encrypt('p"w\\d') }) }],
    }

    const opened = openSecrets(rows, source.decrypt)
    expect(opened.count).toBe(3)
    expect(JSON.stringify(opened.value)).not.toMatch(/[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\./)
    expect(opened.value.Connection[0].name).toBe('PVE')

    const sealed = sealSecrets(opened.value, target.encrypt)
    expect(sealed.count).toBe(3)
    expect(target.decrypt(sealed.value.Connection[0].apiTokenEnc)).toBe('root@pam!tok=abc')
    expect(target.decrypt((sealed.value.settings[0].value.openaiKey as string).slice(4))).toBe('sk-123')
    expect(target.decrypt(JSON.parse(sealed.value.notification_channels[0].config).password)).toBe('p"w\\d')
  })

  it('leaves alone a value that only looks sealed, or is sealed with another key', () => {
    const foreign = keyed('someone-else').encrypt('x')
    const lookalike = 'AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA==.AAAA'
    const rows = { t: [{ a: foreign, b: lookalike, c: 42, d: null, e: ['plain'] }] }

    const opened = openSecrets(rows, source.decrypt)
    expect(opened.count).toBe(0)
    expect(opened.value).toEqual(rows)
  })
})
