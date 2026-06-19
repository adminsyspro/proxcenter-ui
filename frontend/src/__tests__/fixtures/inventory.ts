// Frozen static fixture for /api/v1/inventory
// Hand-written minimal slice -- do NOT import mock-data.json or demoResponse.
// Shape matches what buildScopeOptions() reads from inventory.clusters.
// Provides: one tag ("web"), one pool ("infra"), one node ("pve1"),
// one connection ("conn-1"), and one VM -- enough for all scope types.
export const inventoryFixture = {
  data: {
    clusters: [
      {
        id: 'conn-1',
        name: 'Test Cluster',
        status: 'online',
        nodes: [
          {
            node: 'pve1',
            status: 'online',
            guests: [
              {
                vmid: 100,
                type: 'qemu',
                name: 'web-vm',
                tags: 'web',
                pool: 'infra',
                status: 'running',
              },
            ],
          },
        ],
      },
    ],
  },
}
