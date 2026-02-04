import crypto from "crypto"

function getKey() {
  const secret = process.env.APP_SECRET

  if (!secret) throw new Error("APP_SECRET is missing in .env")

  // 32 bytes key (sha256)
  return crypto.createHash("sha256").update(secret).digest()
}

/**
 * AES-256-GCM
 * Format: iv.tag.data (base64)
 */
export function encryptSecret(plain: string) {
  const key = getKey()
  const iv = crypto.randomBytes(12) // recommended for GCM
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv)

  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()])
  const tag = cipher.getAuthTag()

  return `${iv.toString("base64")}.${tag.toString("base64")}.${enc.toString("base64")}`
}

export function decryptSecret(payload: string) {
  const key = getKey()
  const [ivB64, tagB64, dataB64] = payload.split(".")

  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Invalid secret payload")

  const iv = Buffer.from(ivB64, "base64")
  const tag = Buffer.from(tagB64, "base64")
  const data = Buffer.from(dataB64, "base64")

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv)

  decipher.setAuthTag(tag)

  const dec = Buffer.concat([decipher.update(data), decipher.final()])

  
return dec.toString("utf8")
}

