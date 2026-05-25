import { SignJWT, jwtVerify } from "jose"

const DEFAULT_TTL_SECONDS = 600

interface EnrollPayload {
  userId: string
  secretEnc: string
}

function keyFromSecret(secret: string): Uint8Array {
  return new TextEncoder().encode(secret)
}

export async function signEnrollToken(
  payload: EnrollPayload,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${ttlSeconds}s`)
    .sign(keyFromSecret(secret))
}

export async function verifyEnrollToken(
  token: string,
  secret: string,
): Promise<EnrollPayload> {
  let payload
  try {
    ;({ payload } = await jwtVerify(token, keyFromSecret(secret)))
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes('"exp"')) throw new Error("Token expired")
    throw err
  }
  if (typeof payload.userId !== "string" || typeof payload.secretEnc !== "string") {
    throw new Error("Invalid enroll token payload")
  }
  return { userId: payload.userId, secretEnc: payload.secretEnc }
}
