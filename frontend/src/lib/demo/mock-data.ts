/**
 * ProxCenter Demo Mode - Mock Data Module
 *
 * Provides mock API responses for demo mode so the app can run
 * without a real Proxmox backend.
 */

import fs from 'fs'
import path from 'path'

// ---------------------------------------------------------------------------
// Load the large mock-data.json at runtime (872 KB — not inlined)
// ---------------------------------------------------------------------------
const jsonPath = path.join(process.cwd(), 'src/lib/demo/mock-data.json')

let MOCK_DATA: Record<string, any> = {}

try {
  const raw = fs.readFileSync(jsonPath, 'utf-8')
  MOCK_DATA = JSON.parse(raw)
} catch {
  console.warn('[demo] Could not load mock-data.json from', jsonPath)
}

// ---------------------------------------------------------------------------
// Known connection / node identifiers used in the mock data
// ---------------------------------------------------------------------------
const DEMO_CONNECTION_ID = 'demo-pve-cluster-001'
const DEMO_NODE_NAMES = [
  'pve-node-01',
  'pve-node-02',
  'pve-node-03',
  'pve-node-04',
  'pve-node-05',
  'pve-node-06',
  'pve-node-07',
  'pve-node-08',
  'pve-node-09',
  'pve-node-10',
  'pve-node-11',
  'pve-node-12',
]

// ---------------------------------------------------------------------------
// Additional mock responses for endpoints not covered by mock-data.json
// ---------------------------------------------------------------------------
const EXTRA_MOCKS: Record<string, any> = {
  '/api/v1/auth/session': {
    user: {
      id: 'demo-user',
      name: 'Admin Demo',
      email: 'admin@demo.proxcenter.io',
      role: 'super_admin',
      image: null,
    },
  },

  '/api/v1/auth/providers': {
    credentials: {
      id: 'credentials',
      name: 'Credentials',
      type: 'credentials',
    },
  },

  '/api/v1/license/features': {
    data: {
      edition: 'enterprise',
      features: [
        'white_label',
        'sso',
        'ldap',
        'compliance',
        'api_access',
        'priority_support',
        'custom_roles',
        'advanced_monitoring',
        'migration',
        'drs',
        'cve_scanning',
        'change_tracking',
      ],
    },
  },

  '/api/v1/rbac/me': {
    data: {
      userId: 'demo-user',
      roles: ['super_admin'],
      permissions: ['*'],
    },
  },

  '/api/v1/users/me': {
    data: {
      id: 'demo-user',
      name: 'Admin Demo',
      email: 'admin@demo.proxcenter.io',
      role: 'super_admin',
    },
  },

  '/api/v1/settings/branding/public': {
    enabled: false,
    appName: 'ProxCenter',
    logoUrl: '',
    faviconUrl: '',
    loginLogoUrl: '',
    primaryColor: '',
    browserTitle: '',
    poweredByVisible: true,
  },

  '/api/v1/app/status': {
    data: {
      configured: true,
      hasAdmin: true,
      version: '1.0.0-demo',
    },
  },

  '/api/v1/dashboard/metrics': {
    data: {
      totalVMs: 171,
      runningVMs: 161,
      stoppedVMs: 10,
      totalNodes: 12,
      onlineNodes: 12,
      totalClusters: 1,
      totalCPUCores: 768,
      avgCPUUsage: 3.4,
      avgRAMUsage: 66.7,
      healthScore: 94,
      totalStorageGB: 51200,
      usedStorageGB: 28160,
      storageUsagePercent: 55.0,
      totalMemoryGB: 3072,
      usedMemoryGB: 2049,
      uptimePercent: 99.97,
      vmsByStatus: {
        running: 161,
        stopped: 8,
        paused: 2,
      },
      topNodesByCPU: [
        { node: 'pve-node-03', cpu: 8.2 },
        { node: 'pve-node-07', cpu: 6.1 },
        { node: 'pve-node-01', cpu: 5.4 },
        { node: 'pve-node-11', cpu: 4.8 },
        { node: 'pve-node-05', cpu: 3.9 },
      ],
      topNodesByRAM: [
        { node: 'pve-node-02', ram: 82.3 },
        { node: 'pve-node-09', ram: 78.1 },
        { node: 'pve-node-06', ram: 74.5 },
        { node: 'pve-node-12', ram: 71.2 },
        { node: 'pve-node-04', ram: 68.9 },
      ],
    },
  },

  '/api/v1/alerts': { data: [] },
  '/api/v1/alert-rules': { data: [] },
  '/api/v1/audit': { data: [], total: 0 },
  '/api/v1/events': { data: [] },
  '/api/v1/favorites': { data: [] },
  '/api/v1/tasks': { data: [] },
  '/api/v1/changes': { data: [], pagination: { total: 0, page: 1, limit: 50 } },
  '/api/v1/monitoring': { data: {} },
  '/api/v1/version': { data: { version: '1.0.0-demo', edition: 'Enterprise' } },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip query string from a URL path */
function stripQuery(urlPath: string): string {
  const idx = urlPath.indexOf('?')
  return idx === -1 ? urlPath : urlPath.substring(0, idx)
}

/**
 * UUID v4 pattern — used to detect dynamic connection IDs in URL paths.
 * Also matches shorter slug-style IDs like `abc-def-123`.
 */
const CONNECTION_ID_RE = /\/connections\/([^/]+)/

/**
 * Node name pattern — matches any segment after /nodes/ that isn't a known
 * sub-resource keyword.
 */
const NODE_NAME_RE = /\/nodes\/([^/]+)/

/**
 * Replace any connection ID in the path with the demo connection ID.
 */
function normaliseConnectionId(urlPath: string): string {
  return urlPath.replace(CONNECTION_ID_RE, `/connections/${DEMO_CONNECTION_ID}`)
}

/**
 * Replace any node name in the path with the first demo node name.
 */
function normaliseNodeName(urlPath: string): string {
  return urlPath.replace(NODE_NAME_RE, `/nodes/${DEMO_NODE_NAMES[0]}`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Look up a mock response for the given API path.
 *
 * Matching strategy (in order):
 *  1. Exact match against EXTRA_MOCKS
 *  2. Exact match against MOCK_DATA (from JSON)
 *  3. Replace connection ID → retry both maps
 *  4. Replace node name → retry both maps
 *  5. Fallback: any unmatched `/api/v1/*` route returns `{ data: [] }`
 *  6. Otherwise return `null`
 */
export function getDemoResponse(urlPath: string): any | null {
  const cleanPath = stripQuery(urlPath)

  // --- 1. Exact match ---
  if (EXTRA_MOCKS[cleanPath] !== undefined) return EXTRA_MOCKS[cleanPath]
  if (MOCK_DATA[cleanPath] !== undefined) return MOCK_DATA[cleanPath]

  // --- 2. Normalise connection ID and retry ---
  const withDemoConn = normaliseConnectionId(cleanPath)
  if (withDemoConn !== cleanPath) {
    if (EXTRA_MOCKS[withDemoConn] !== undefined) return EXTRA_MOCKS[withDemoConn]
    if (MOCK_DATA[withDemoConn] !== undefined) return MOCK_DATA[withDemoConn]
  }

  // --- 3. Normalise node name and retry ---
  const withDemoNode = normaliseNodeName(withDemoConn)
  if (withDemoNode !== withDemoConn) {
    if (EXTRA_MOCKS[withDemoNode] !== undefined) return EXTRA_MOCKS[withDemoNode]
    if (MOCK_DATA[withDemoNode] !== undefined) return MOCK_DATA[withDemoNode]
  }

  // --- 4. Safe fallback for any API route ---
  if (cleanPath.startsWith('/api/v1/')) {
    return { data: [] }
  }

  return null
}

export { MOCK_DATA, EXTRA_MOCKS }
