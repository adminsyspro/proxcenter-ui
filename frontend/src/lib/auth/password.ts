import crypto from "crypto"

const ITERATIONS = 100000
const KEY_LENGTH = 64
const DIGEST = "sha512"

/**
 * Hash un mot de passe avec PBKDF2
 */
export async function hashPassword(password: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(32).toString("hex")

    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err)
      resolve(`${salt}:${derivedKey.toString("hex")}`)
    })
  })
}

/**
 * Vérifie un mot de passe contre un hash
 */
export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const [salt, storedHash] = hash.split(":")

    if (!salt || !storedHash) {
      resolve(false)
      
return
    }

    crypto.pbkdf2(password, salt, ITERATIONS, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) reject(err)
      const derivedHex = derivedKey.toString("hex")
      const a = Buffer.from(derivedHex, "utf-8")
      const b = Buffer.from(storedHash, "utf-8")
      resolve(a.length === b.length && crypto.timingSafeEqual(a, b))
    })
  })
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
