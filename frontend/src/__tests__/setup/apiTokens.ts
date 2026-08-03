import type { ServerLicense } from '@/lib/auth/requireEnterprise'
import { generateApiToken } from '@/lib/api-tokens/tokenCrypto'
import { prismaTest } from './prisma-test'

process.env.APP_SECRET = process.env.APP_SECRET || 'test-app-secret'

export const ENTERPRISE_WITH_API_ACCESS: ServerLicense = {
  enterprise: true,
  edition: 'enterprise',
  licensed: true,
  expired: false,
  features: [],
  options: ['api_access'],
}

export async function seedDefaultTenant(): Promise<void> {
  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'default', slug: 'default', name: 'Provider', createdAt: now, updatedAt: now },
  })
}

let seq = 0

export async function seedApiToken(opts: {
  tenantId?: string
  scopes?: string[]
  connectionIds?: string[] | null
  revokedAt?: Date | null
  expiresAt?: Date | null
  rateLimitPerMin?: number
} = {}): Promise<{ id: string; secret: string; prefix: string }> {
  const generated = generateApiToken()
  const id = `tok_test_${++seq}_${Date.now()}`
  await prismaTest.apiToken.create({
    data: {
      id,
      tenantId: opts.tenantId ?? 'default',
      name: `test-${id}`,
      tokenPrefix: generated.prefix,
      tokenHash: generated.hash,
      scopes: opts.scopes ?? ['vms:read'],
      connectionIds: opts.connectionIds === undefined ? null : opts.connectionIds,
      revokedAt: opts.revokedAt ?? null,
      expiresAt: opts.expiresAt ?? null,
      rateLimitPerMin: opts.rateLimitPerMin ?? 600,
    },
  })
  return { id, secret: generated.secret, prefix: generated.prefix }
}

export function tokenHeaders(secret: string, entryId: string, path: string, method = 'GET'): Headers {
  return new Headers({
    authorization: `Bearer ${secret}`,
    'x-pxc-method': method,
    'x-pxc-path': path,
    'x-pxc-entry': entryId,
  })
}
