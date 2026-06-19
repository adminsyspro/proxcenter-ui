// Frozen static fixture for /api/v1/connections/:connId/resources
// Hand-written minimal slice -- do NOT import mock-data.json or demoResponse.
// Only the fields TagManager.tsx reads: tags (and vmid for identity).
export const resourcesFixture = {
  data: [
    { vmid: 100, type: 'qemu', name: 'web-server', tags: 'prod;web' },
    { vmid: 101, type: 'qemu', name: 'db-primary', tags: 'prod,db' },
    { vmid: 102, type: 'lxc',  name: 'monitoring', tags: 'dev' },
    { vmid: 103, type: 'qemu', name: 'no-tags' },
  ],
}
