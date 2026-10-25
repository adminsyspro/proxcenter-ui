// Secrets inside a configuration backup.
//
// Every credential ProxCenter stores (PVE/PBS tokens, SSH keys, LDAP bind
// password, OIDC client secret, TOTP seeds, AI keys, notification channel
// passwords written by the orchestrator) is sealed with the same AES-256-GCM
// primitive under a key derived from APP_SECRET, as `iv.tag.data`. Sometimes
// as the whole column, sometimes behind a prefix (`enc:`) or inside a JSON
// document stored as text. A backup restored on a fresh install with another
// APP_SECRET could not open any of them, so the export opens every sealed
// value it finds and the import seals it again with the local key.
//
// Detection is by shape, then proven by decryption: GCM authenticates the
// payload, so a string that merely looks like a ciphertext never decrypts by
// accident and is left untouched. The whole file is itself encrypted with the
// operator's passphrase, which is what protects the opened secrets in transit.

// iv = 12 bytes (16 base64 chars), tag = 16 bytes (24 chars with padding).
const SEALED_PATTERN = /[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]{22}==\.[A-Za-z0-9+/]*={0,2}/g

// Placeholder standing for an opened secret in the backup payload. The value
// is base64 so it never needs escaping, whatever the secret holds.
const OPENED_PATTERN = /\{\{pcx-secret:([A-Za-z0-9+/]*={0,2})\}\}/g

export type Decrypt = (sealed: string) => string
export type Encrypt = (plain: string) => string

function openString(value: string, decrypt: Decrypt): { value: string; count: number } {
  let count = 0
  const opened = value.replace(SEALED_PATTERN, match => {
    try {
      const plain = decrypt(match)
      count++
      return `{{pcx-secret:${Buffer.from(plain, 'utf8').toString('base64')}}}`
    } catch {
      return match
    }
  })

  return { value: opened, count }
}

function sealString(value: string, encrypt: Encrypt): { value: string; count: number } {
  let count = 0
  const sealed = value.replace(OPENED_PATTERN, (_, b64: string) => {
    count++
    return encrypt(Buffer.from(b64, 'base64').toString('utf8'))
  })

  return { value: sealed, count }
}

function walk(value: unknown, transform: (s: string) => { value: string; count: number }): { value: unknown; count: number } {
  if (typeof value === 'string') return transform(value)

  if (Array.isArray(value)) {
    let count = 0
    const items = value.map(item => {
      const r = walk(item, transform)
      count += r.count
      return r.value
    })
    return { value: items, count }
  }

  if (value && typeof value === 'object') {
    let count = 0
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      const r = walk(item, transform)
      count += r.count
      out[key] = r.value
    }
    return { value: out, count }
  }

  return { value, count: 0 }
}

/** Replaces every value sealed with the local key by a portable placeholder. */
export function openSecrets<T>(value: T, decrypt: Decrypt): { value: T; count: number } {
  const r = walk(value, s => openString(s, decrypt))
  return { value: r.value as T, count: r.count }
}

/** Seals every placeholder left by openSecrets with the local key. */
export function sealSecrets<T>(value: T, encrypt: Encrypt): { value: T; count: number } {
  const r = walk(value, s => sealString(s, encrypt))
  return { value: r.value as T, count: r.count }
}
