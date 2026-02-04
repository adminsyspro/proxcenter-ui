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
      resolve(derivedKey.toString("hex") === storedHash)
    })
  })
}

/**
 * Génère un mot de passe aléatoire
 */
export function generateRandomPassword(length: number = 16): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*"
  let password = ""
  const randomBytes = crypto.randomBytes(length)

  for (let i = 0; i < length; i++) {
    password += chars[randomBytes[i] % chars.length]
  }

  return password
}
