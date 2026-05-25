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
  const { payload } = await jwtVerify(token, keyFromSecret(secret))
  if (typeof payload.userId !== "string" || typeof payload.secretEnc !== "string") {
    throw new TypeError("Invalid enroll token payload")
  }
  return { userId: payload.userId, secretEnc: payload.secretEnc }
}
