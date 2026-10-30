import crypto from "crypto"

// argon2id, OWASP Password Storage Cheat Sheet baseline (19 MiB, 2 passes,
// 1 lane). crypto.argon2 runs on the libuv threadpool, so concurrent logins
// hold at most UV_THREADPOOL_SIZE (4) x 19 MiB at once.
const ARGON2 = { memory: 19456, passes: 2, parallelism: 1, tagLength: 32, saltLength: 16 } as const
const ARGON2_VERSION = 19

// Upper bounds accepted when parsing a stored hash, so a tampered row cannot
// make a login allocate gigabytes.
const ARGON2_MAX = { memory: 262144, passes: 10, parallelism: 8, tagLength: 64 } as const

// Legacy format, still verified so existing accounts keep logging in; a
// successful login rewrites it as argon2id (see needsRehash).
const LEGACY_ITERATIONS = 100000
const LEGACY_KEY_LENGTH = 64
const LEGACY_DIGEST = "sha512"

type Argon2Hash = { memory: number; passes: number; parallelism: number; salt: Buffer; tag: Buffer }

const PHC_RE = /^\$argon2id\$v=(\d+)\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/

function b64(buf: Buffer): string {
  return buf.toString("base64").replace(/=+$/, "")
}

function argon2id(password: string, salt: Buffer, p: Omit<Argon2Hash, "salt" | "tag">, tagLength: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.argon2(
      "argon2id",
      { message: password, nonce: salt, memory: p.memory, passes: p.passes, parallelism: p.parallelism, tagLength },
      (err, key) => (err ? reject(err) : resolve(key)),
    )
  })
}

function parseArgon2(hash: string): Argon2Hash | null {
  const m = PHC_RE.exec(hash)

  if (!m || Number(m[1]) !== ARGON2_VERSION) return null

  const parsed = {
    memory: Number(m[2]),
    passes: Number(m[3]),
    parallelism: Number(m[4]),
    salt: Buffer.from(m[5], "base64"),
    tag: Buffer.from(m[6], "base64"),
  }

  if (
    parsed.memory > ARGON2_MAX.memory ||
    parsed.passes < 1 || parsed.passes > ARGON2_MAX.passes ||
    parsed.parallelism < 1 || parsed.parallelism > ARGON2_MAX.parallelism ||
    parsed.memory < 8 * parsed.parallelism ||
    parsed.salt.length < 8 ||
    parsed.tag.length < 4 || parsed.tag.length > ARGON2_MAX.tagLength
  ) {
    return null
  }

  return parsed
}

function verifyLegacy(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, storedHash] = hash.split(":")

    if (!salt || !storedHash) {
      resolve(false)

      return
    }

    crypto.pbkdf2(password, salt, LEGACY_ITERATIONS, LEGACY_KEY_LENGTH, LEGACY_DIGEST, (err, derivedKey) => {
      if (err) {
        reject(err)

        return
      }
      const a = Buffer.from(derivedKey.toString("hex"), "utf-8")
      const b = Buffer.from(storedHash, "utf-8")
      resolve(a.length === b.length && crypto.timingSafeEqual(a, b))
    })
  })
}

/**
 * Hash un mot de passe avec argon2id (format PHC)
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(ARGON2.saltLength)
  const tag = await argon2id(password, salt, ARGON2, ARGON2.tagLength)

  return `$argon2id$v=${ARGON2_VERSION}$m=${ARGON2.memory},t=${ARGON2.passes},p=${ARGON2.parallelism}$${b64(salt)}$${b64(tag)}`
}

/**
 * Vérifie un mot de passe contre un hash argon2id ou PBKDF2 (ancien format)
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  if (!hash.startsWith("$argon2id$")) return verifyLegacy(password, hash)

  const parsed = parseArgon2(hash)

  if (!parsed) return false

  const derived = await argon2id(password, parsed.salt, parsed, parsed.tag.length)

  return crypto.timingSafeEqual(derived, parsed.tag)
}

/**
 * Vrai quand le hash stocké n'utilise pas l'algorithme ou les paramètres
 * courants : à recalculer après une connexion réussie.
 */
export function needsRehash(hash: string): boolean {
  const parsed = parseArgon2(hash)

  return (
    !parsed ||
    parsed.memory !== ARGON2.memory ||
    parsed.passes !== ARGON2.passes ||
    parsed.parallelism !== ARGON2.parallelism ||
    parsed.tag.length !== ARGON2.tagLength
  )
}

let dummyHash: Promise<string> | null = null

/**
 * Fait le même travail qu'une vérification réelle quand il n'y a pas de hash
 * à comparer (compte inconnu, compte sans mot de passe local), pour que le
 * temps de réponse ne révèle pas si le compte existe.
 */
export async function burnPasswordCheck(password: string): Promise<void> {
  if (dummyHash === null) dummyHash = hashPassword(crypto.randomBytes(16).toString("hex"))
  await verifyPassword(password, await dummyHash)
}

/**
 * Génère un mot de passe aléatoire
 */
export function generateRandomPassword(length: number = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
  let password = ""
  // Use rejection sampling to avoid modulo bias
  const maxValid = 256 - (256 % chars.length)

  while (password.length < length) {
    const randomBytes = crypto.randomBytes(length - password.length + 16)

    for (let i = 0; i < randomBytes.length && password.length < length; i++) {
      if (randomBytes[i] < maxValid) {
        password += chars[randomBytes[i] % chars.length]
      }
    }
  }

  return password
}
