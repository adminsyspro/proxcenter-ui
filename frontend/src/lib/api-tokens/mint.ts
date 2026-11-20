// Token creation shared by Settings > API (a user's token) and the service
// account routes (issue #1404): request parsing, perimeter checks, the row
// and its audit entry written in one transaction, the secret returned once.
import { nanoid } from "nanoid"
import { Prisma } from "@prisma/client"

import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"

import { generateApiToken } from "./tokenCrypto"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { ALL_SCOPE_IDS, FLEET_SCOPE_IDS, PROVIDER_ONLY_SCOPE_IDS } from "./scopes"

export const DEFAULT_RATE_LIMIT_PER_MIN = 600
export const DEFAULT_WRITE_RATE_LIMIT_PER_MIN = 60

/** What a token request asks for, validated. */
export type TokenRequest = {
  name: string
  description: string | null
  scopes: string[]
  connectionIds: string[] | null
  expiresAt: Date | null
  rateLimitPerMin: number
  writeRateLimitPerMin: number
}

/** A refusal to answer as is. */
export type Refusal = { status: number; body: Record<string, unknown> }

/** Flat on purpose (tsconfig strict:false): exactly one of the two is set. */
export type ParsedTokenRequest = { request: TokenRequest | null; refusal: Refusal | null }

const refuse = (error: string, extra: Record<string, unknown> = {}, status = 400): ParsedTokenRequest => ({
  request: null,
  refusal: { status, body: { error, ...extra } },
})

function positiveInt(value: unknown, fallback: number): number {
  const n = Number(value)
  return value !== undefined && Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

/** Validate the body of a token creation: name, scopes, perimeter, expiry, rate limits. */
export function parseTokenRequest(body: any): ParsedTokenRequest {
  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) return refuse("name is required")

  const scopes: unknown = body?.scopes
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.some((s: unknown) => typeof s !== "string" || !ALL_SCOPE_IDS.includes(s))
  ) {
    return refuse("scopes must be a non-empty array of known scope ids")
  }

  let connectionIds: string[] | null = null
  if (body?.connectionIds !== undefined && body?.connectionIds !== null) {
    if (!Array.isArray(body.connectionIds) || body.connectionIds.some((c: unknown) => typeof c !== "string" || !c)) {
      return refuse("connectionIds must be null or an array of connection ids")
    }
    connectionIds = body.connectionIds
  }
  const fleetScope = connectionIds === null ? undefined : (scopes as string[]).find(s => FLEET_SCOPE_IDS.includes(s))
  if (fleetScope) {
    return refuse(`${fleetScope} reaches every connection: it needs a token not restricted to connections`, { scope: fleetScope })
  }

  let expiresAt: Date | null = null
  if (body?.expiresInDays !== undefined && body?.expiresInDays !== null) {
    const days = Number(body.expiresInDays)
    if (!Number.isFinite(days) || days <= 0) return refuse("expiresInDays must be a positive number")
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }

  return {
    refusal: null,
    request: {
      name,
      description: typeof body?.description === "string" && body.description ? body.description : null,
      scopes: scopes as string[],
      connectionIds,
      expiresAt,
      rateLimitPerMin: positiveInt(body?.rateLimitPerMin, DEFAULT_RATE_LIMIT_PER_MIN),
      writeRateLimitPerMin: positiveInt(body?.writeRateLimitPerMin, DEFAULT_WRITE_RATE_LIMIT_PER_MIN),
    },
  }
}

/**
 * The refusal of a perimeter naming a connection the tenant does not own, or
 * null. Without it the row would be persisted and the read-time intersection
 * would silently leave the token blind.
 */
export async function foreignConnectionsRefusal(connectionIds: string[] | null, tenantId: string): Promise<Refusal | null> {
  if (!connectionIds || connectionIds.length === 0) return null
  const owned = await prisma.connection.findMany({
    where: { id: { in: connectionIds }, tenantId },
    select: { id: true },
  })
  const ownedIds = new Set(owned.map(c => c.id))
  if (connectionIds.some(id => !ownedIds.has(id))) {
    return { status: 400, body: { error: "connectionIds must belong to the target tenant" } }
  }
  return null
}

/** The refusal of a provider-only scope on a customer tenant's token, or null. */
export function providerOnlyScopeRefusal(scopes: string[], tenantId: string): Refusal | null {
  if (tenantId === DEFAULT_TENANT_ID) return null
  const scope = scopes.find(s => PROVIDER_ONLY_SCOPE_IDS.includes(s))
  return scope ? { status: 400, body: { error: `${scope} only works on a provider token`, scope } } : null
}

export type CreateTokenInput = {
  tenantId: string
  request: TokenRequest
  /** The user who minted it; its email is frozen on the row (#632). */
  createdByUserId: string | null
  /** The service account the token acts as (issue #1404). */
  serviceAccountId?: string | null
  /** Projection of the returned row: never the hash. */
  select: Record<string, unknown>
}

/**
 * Write the token and its audit row atomically: an audit failure rolls the
 * token back, so no unlogged credential survives an error answer. The clear
 * secret is returned here only, never stored.
 */
export async function createApiToken(input: CreateTokenInput): Promise<{ token: any; secret: string }> {
  const { tenantId, request } = input
  const generated = generateApiToken()
  const creator = input.createdByUserId
    ? await prisma.user.findUnique({ where: { id: input.createdByUserId }, select: { email: true } })
    : null

  const token = await prisma.$transaction(async tx => {
    const created = await tx.apiToken.create({
      data: {
        id: nanoid(),
        tenantId,
        name: request.name,
        description: request.description,
        tokenPrefix: generated.prefix,
        tokenHash: generated.hash,
        scopes: request.scopes,
        // SQL NULL = no perimeter: every connection of the tenant.
        connectionIds: request.connectionIds ?? Prisma.DbNull,
        expiresAt: request.expiresAt,
        rateLimitPerMin: request.rateLimitPerMin,
        writeRateLimitPerMin: request.writeRateLimitPerMin,
        createdByUserId: input.createdByUserId,
        createdByEmail: creator?.email ?? null,
        serviceAccountId: input.serviceAccountId ?? null,
      },
      select: input.select,
    })

    await audit(
      {
        action: "apitoken.create",
        category: "api_tokens",
        resourceType: "api_token",
        resourceId: (created as any).id,
        resourceName: request.name,
        details: {
          tenantId,
          scopes: request.scopes,
          connectionIds: request.connectionIds,
          expiresAt: request.expiresAt?.toISOString() ?? null,
          writeRateLimitPerMin: request.writeRateLimitPerMin,
          ...(input.serviceAccountId ? { serviceAccountId: input.serviceAccountId } : {}),
        },
      },
      tx,
    )

    return created
  })

  return { token, secret: generated.secret }
}

/**
 * Delete a token with its audit row, atomically: a credential vanishing with
 * no journal entry would leave nothing to say it ever existed. The prefix is
 * the one identifier that survives the row.
 */
export async function deleteApiToken(token: { id: string; name: string; tokenPrefix: string }): Promise<void> {
  await prisma.$transaction(async tx => {
    await tx.apiToken.delete({ where: { id: token.id } })
    await audit(
      {
        action: "apitoken.delete",
        category: "api_tokens",
        resourceType: "api_token",
        resourceId: token.id,
        resourceName: token.name,
        details: { tokenPrefix: token.tokenPrefix },
      },
      tx,
    )
  })
}

export type RotateTokenInput = {
  id: string
  name: string
  /** The prefix that stops authenticating: the audit names it, never a secret. */
  previousPrefix: string
  /** Whoever receives the new secret answers for it, as if they had created the token. */
  rotatedByUserId: string | null
  select: Record<string, unknown>
}

/**
 * Give a token a new secret, atomically with its audit row: id, name, scopes,
 * tenant, connections, expiry, rate limits and service account stay; the old
 * secret stops authenticating at once (the lookup by prefix has no cache).
 * The clear secret is returned here only.
 */
export async function rotateApiToken(input: RotateTokenInput): Promise<{ token: any; secret: string }> {
  const generated = generateApiToken()
  const rotator = input.rotatedByUserId
    ? await prisma.user.findUnique({ where: { id: input.rotatedByUserId }, select: { email: true } })
    : null

  const token = await prisma.$transaction(async tx => {
    const updated = await tx.apiToken.update({
      where: { id: input.id },
      data: {
        tokenPrefix: generated.prefix,
        tokenHash: generated.hash,
        createdByUserId: input.rotatedByUserId,
        createdByEmail: rotator?.email ?? null,
      },
      select: input.select,
    })
    await audit(
      {
        action: "apitoken.rotate",
        category: "api_tokens",
        resourceType: "api_token",
        resourceId: input.id,
        resourceName: input.name,
        details: { previousPrefix: input.previousPrefix, tokenPrefix: generated.prefix },
      },
      tx,
    )
    return updated
  })

  return { token, secret: generated.secret }
}
