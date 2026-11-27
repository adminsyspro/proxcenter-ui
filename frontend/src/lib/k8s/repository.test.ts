import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import { prisma } from '@/lib/db/prisma'
import { createCluster, listClusters, getClusterWithCredential, replaceCredential, persistHealth, toPublic, recordNodeMapping, getNodeMapping, deleteClusterNodes } from './repository'

const cred = {
  apiServerUrl: 'https://10.0.0.1:6443', caDataPem: 'CA', insecureSkipTlsVerify: false,
  credentialType: 'token' as const, credential: 'secret-token', contextName: 'ctx',
}

const originalSecret = process.env.APP_SECRET

beforeAll(() => {
  process.env.APP_SECRET = 'k8s-repository-test-secret'
})

afterAll(() => {
  if (originalSecret === undefined) delete process.env.APP_SECRET
  else process.env.APP_SECRET = originalSecret
})

beforeEach(async () => {
  await prisma.kubernetesClusterNode.deleteMany({})
  await prisma.kubernetesCluster.deleteMany({})
})

describe('repository', () => {
  it('createCluster encrypts the credential (not stored in clear)', async () => {
    const id = await createCluster('t1', { name: 'dev', distro: 'k3s', source: 'imported', cred, createdBy: 'u1' })
    const raw = await prisma.kubernetesCluster.findUnique({ where: { id } })
    expect(raw?.credentialEnc).toBeTruthy()
    expect(raw?.credentialEnc).not.toContain('secret-token')
  })
  it('getClusterWithCredential round-trips the decrypted credential', async () => {
    const id = await createCluster('t1', { name: 'dev', distro: 'k3s', source: 'imported', cred, createdBy: 'u1' })
    const r = await getClusterWithCredential('t1', id)
    expect(r?.credential.credential).toBe('secret-token')
  })
  it('listClusters is tenant-scoped', async () => {
    await createCluster('t1', { name: 'a', distro: 'generic', source: 'imported', cred, createdBy: 'u1' })
    await createCluster('t2', { name: 'b', distro: 'generic', source: 'imported', cred, createdBy: 'u1' })
    const rows = await listClusters('t1')
    expect(rows.map(r => r.name)).toEqual(['a'])
  })
  it('replaceCredential bumps version', async () => {
    const id = await createCluster('t1', { name: 'dev', distro: 'k3s', source: 'imported', cred, createdBy: 'u1' })
    await replaceCredential('t1', id, { ...cred, credential: 'new-token' })
    const raw = await prisma.kubernetesCluster.findUnique({ where: { id } })
    expect(raw?.credentialVersion).toBe(2)
  })
  it('persistHealth returns the post-persist public row (fresh health, no credentialEnc)', async () => {
    const id = await createCluster('t1', { name: 'dev', distro: 'k3s', source: 'imported', cred, createdBy: 'u1' })
    const row = await persistHealth('t1', id, { state: 'healthy', version: 'v1.30.0', nodesReady: 3, nodesTotal: 3 })
    expect(row.healthState).toBe('healthy')
    expect(row.version).toBe('v1.30.0')
    expect(row.lastHealthAt).toBeTruthy()
    expect(row.healthDetail).toEqual({ nodesReady: 3, nodesTotal: 3 })
    expect(row.credentialEnc).toBeUndefined()
  })
  it('toPublic strips credentialEnc', async () => {
    const id = await createCluster('t1', { name: 'dev', distro: 'k3s', source: 'imported', cred, createdBy: 'u1' })
    const raw = await prisma.kubernetesCluster.findUnique({ where: { id } })
    expect((toPublic(raw!) as any).credentialEnc).toBeUndefined()
  })
  it('createCluster accepts the talos distro', async () => {
    const id = await createCluster('t1', { name: 'dev', distro: 'talos', source: 'deployed', cred, createdBy: 'u1' })
    const raw = await prisma.kubernetesCluster.findUnique({ where: { id } })
    expect(raw?.distro).toBe('talos')
  })
  it('createCluster accepts the rke2 distro (enum forward-compat for the RKE2 increment)', async () => {
    const id = await createCluster('t1', { name: 'dev-rke2', distro: 'rke2', source: 'imported', cred, createdBy: 'u1' })
    const raw = await prisma.kubernetesCluster.findUnique({ where: { id } })
    expect(raw?.distro).toBe('rke2')
  })

  it('createCluster persists a deployed k3s cluster', async () => {
    const id = await createCluster('t1', { name: 'dev-k3s', distro: 'k3s', source: 'deployed', cred, createdBy: 'u1' })
    const raw = await prisma.kubernetesCluster.findUnique({ where: { id } })
    expect(raw?.distro).toBe('k3s')
    expect(raw?.source).toBe('deployed')
  })
  it('recordNodeMapping writes one row per node, readable back by cluster', async () => {
    const clusterId = await createCluster('t1', { name: 'dev', distro: 'talos', source: 'deployed', cred, createdBy: 'u1' })
    await recordNodeMapping(clusterId, [
      { name: 'node-1', vmid: 101, connectionId: 'conn-1' },
      { name: 'node-2', vmid: 102, connectionId: 'conn-1' },
    ])
    const rows = await prisma.kubernetesClusterNode.findMany({ where: { clusterId }, orderBy: { nodeName: 'asc' } })
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ nodeName: 'node-1', vmid: 101, connectionId: 'conn-1' })
    expect(rows[1]).toMatchObject({ nodeName: 'node-2', vmid: 102, connectionId: 'conn-1' })
  })

  describe('getNodeMapping', () => {
    it('reads back the persisted mapping for a cluster owned by the tenant', async () => {
      const clusterId = await createCluster('t1', { name: 'dev', distro: 'talos', source: 'deployed', cred, createdBy: 'u1' })
      await recordNodeMapping(clusterId, [
        { name: 'node-1', vmid: 101, connectionId: 'conn-1' },
        { name: 'node-2', vmid: 102, connectionId: 'conn-1' },
      ])
      const rows = await getNodeMapping('t1', clusterId)
      expect(rows.sort((a, b) => a.nodeName.localeCompare(b.nodeName))).toEqual([
        { nodeName: 'node-1', vmid: 101, connectionId: 'conn-1' },
        { nodeName: 'node-2', vmid: 102, connectionId: 'conn-1' },
      ])
    })

    it('tenant-mismatch (cluster belongs to a different tenant) returns []', async () => {
      const clusterId = await createCluster('t1', { name: 'dev', distro: 'talos', source: 'deployed', cred, createdBy: 'u1' })
      await recordNodeMapping(clusterId, [{ name: 'node-1', vmid: 101, connectionId: 'conn-1' }])
      const rows = await getNodeMapping('t2', clusterId)
      expect(rows).toEqual([])
    })

    it('unknown clusterId returns []', async () => {
      const rows = await getNodeMapping('t1', 'does-not-exist')
      expect(rows).toEqual([])
    })

    it('cluster with no recorded nodes returns []', async () => {
      const clusterId = await createCluster('t1', { name: 'dev', distro: 'talos', source: 'deployed', cred, createdBy: 'u1' })
      const rows = await getNodeMapping('t1', clusterId)
      expect(rows).toEqual([])
    })
  })

  it('deleteClusterNodes removes all node rows for a cluster', async () => {
    const clusterId = await createCluster('t1', { name: 'dev', distro: 'talos', source: 'deployed', cred, createdBy: 'u1' })
    await recordNodeMapping(clusterId, [
      { name: 'node-1', vmid: 101, connectionId: 'conn-1' },
      { name: 'node-2', vmid: 102, connectionId: 'conn-1' },
    ])
    const n = await deleteClusterNodes(clusterId)
    expect(n).toBe(2)
    expect(await getNodeMapping('t1', clusterId)).toEqual([])
  })
})
