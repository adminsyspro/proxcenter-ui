// src/lib/orchestrator/client.ts
// Client pour communiquer avec le backend Go d'orchestration

import { getOrchestratorApiKey } from './api-key'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

export interface OrchestratorRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: any
  timeout?: number
}

/**
 * Fait une requête vers le backend Go d'orchestration
 */
export async function orchestratorFetch<T>(
  path: string,
  options: OrchestratorRequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, timeout = 30000 } = options

  const url = `${ORCHESTRATOR_URL}/api/v1${path}`

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  const apiKey = getOrchestratorApiKey()
  if (apiKey) {
    headers['X-API-Key'] = apiKey
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  try {
    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })

    clearTimeout(timeoutId)

    if (!res.ok) {
      const text = await res.text().catch(() => '')

      throw new Error(`Orchestrator ${res.status}: ${text}`)
    }

    return (await res.json()) as T
  } catch (error: any) {
    clearTimeout(timeoutId)

    if (error.name === 'AbortError') {
      throw new Error('Orchestrator request timeout')
    }

    throw error
  }
}

// ============================================
// Types DRS
// ============================================

export interface DRSStatus {
  enabled: boolean
  mode: 'manual' | 'partial' | 'automatic'
  recommendations: number
  active_migrations: number
  pending_count: number
  approved_count: number
}

export interface DRSRecommendation {
  id: string
  connection_id: string
  vmid: number
  vm_name: string
  source_node: string
  target_node: string
  reason: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  score: number
  created_at: string
  status: 'pending' | 'approved' | 'rejected' | 'executed'
}

export interface DRSMigration {
  id: string
  recommendation_id?: string
  connection_id: string
  vmid: number
  vm_name: string
  source_node: string
  target_node: string
  task_id: string
  started_at: string
  completed_at?: string
  status: 'running' | 'completed' | 'failed'
  error?: string
}

export interface AffinityRule {
  id: string
  name: string
  type: 'affinity' | 'anti-affinity' | 'node-affinity'
  connection_id: string
  enabled: boolean
  required: boolean
  vmids?: number[]
  nodes?: string[]
}

export interface ClusterMetrics {
  connection_id: string
  collected_at: string
  nodes: NodeMetrics[]
  vms: VMMetrics[]
  summary: ClusterSummary
}

export interface NodeMetrics {
  node: string
  status: string
  cpu_usage: number
  cpu_cores: number
  memory_used: number
  memory_total: number
  memory_usage: number
  disk_used: number
  disk_total: number
  disk_usage: number
  uptime: number
  vm_count: number
  running_vms: number
}

export interface VMMetrics {
  vmid: number
  name: string
  node: string
  status: string
  cpu_usage: number
  cpus: number
  memory_used: number
  memory_total: number
  memory_usage: number
  uptime: number
}

export interface ClusterSummary {
  total_nodes: number
  online_nodes: number
  total_vms: number
  running_vms: number
  total_cpu_cores: number
  used_cpu_cores: number
  avg_cpu_usage: number
  total_memory: number
  used_memory: number
  avg_memory_usage: number
  total_storage: number
  used_storage: number
  avg_storage_usage: number
  imbalance: number
}

export interface DRSSettings {
  enabled: boolean
  mode: 'manual' | 'partial' | 'automatic'
  evaluation_interval: number
  cpu_threshold: number
  memory_threshold: number
  imbalance_threshold: number
  min_improvement: number
  max_concurrent_migrations: number
  excluded_nodes: string[]
  excluded_vms: number[]
}

// ============================================
// Response wrapper (style Axios)
// ============================================

export interface OrchestratorResponse<T> {
  data: T
  status: number
}

// ============================================
// Client class avec API style Axios
// ============================================

class OrchestratorClient {
  /**
   * GET request - retourne { data: T }
   */
  async get<T = any>(path: string): Promise<OrchestratorResponse<T>> {
    const data = await orchestratorFetch<T>(path, { method: 'GET' })

    
return { data, status: 200 }
  }

  /**
   * POST request - retourne { data: T }
   */
  async post<T = any>(path: string, body?: any): Promise<OrchestratorResponse<T>> {
    const data = await orchestratorFetch<T>(path, { method: 'POST', body })

    
return { data, status: 200 }
  }

  /**
   * PUT request - retourne { data: T }
   */
  async put<T = any>(path: string, body?: any): Promise<OrchestratorResponse<T>> {
    const data = await orchestratorFetch<T>(path, { method: 'PUT', body })

    
return { data, status: 200 }
  }

  /**
   * DELETE request - retourne { data: T }
   */
  async delete<T = any>(path: string): Promise<OrchestratorResponse<T>> {
    const data = await orchestratorFetch<T>(path, { method: 'DELETE' })

    
return { data, status: 200 }
  }

  // ============================================
  // Méthodes typées (raccourcis)
  // ============================================

  // DRS Status
  getDRSStatus() {
    return this.get<DRSStatus>('/drs/status')
  }

  // DRS Settings
  getDRSSettings() {
    return this.get<DRSSettings>('/drs/settings')
  }

  updateDRSSettings(settings: Partial<DRSSettings>) {
    return this.put<DRSSettings>('/drs/settings', settings)
  }

  // Recommendations
  getRecommendations(validate = false) {
    const query = validate ? '?validate=true' : ''

    
return this.get<DRSRecommendation[]>(`/drs/recommendations${query}`)
  }

  approveRecommendation(id: string) {
    return this.post<{ status: string }>(`/drs/recommendations/${id}/approve`)
  }

  rejectRecommendation(id: string) {
    return this.post<{ status: string }>(`/drs/recommendations/${id}/reject`)
  }

  executeRecommendation(id: string) {
    return this.post<{ status: string }>(`/drs/recommendations/${id}/execute`)
  }

  // Migrations
  getMigrations() {
    return this.get<DRSMigration[]>('/drs/migrations')
  }

  getActiveMigrations() {
    return this.get<DRSMigration[]>('/drs/migrations/active')
  }

  // Manual evaluation trigger
  triggerEvaluation() {
    return this.post<{ status: string }>('/drs/evaluate')
  }

  // Affinity Rules
  getRules() {
    return this.get<AffinityRule[]>('/rules')
  }

  createRule(rule: Omit<AffinityRule, 'id'>) {
    return this.post<AffinityRule>('/rules', rule)
  }

  updateRule(id: string, rule: Partial<AffinityRule>) {
    return this.put<AffinityRule>(`/rules/${id}`, rule)
  }

  deleteRule(id: string) {
    return this.delete<{ status: string }>(`/rules/${id}`)
  }

  // Metrics
  getAllMetrics() {
    return this.get<Record<string, ClusterMetrics>>('/metrics')
  }

  getMetrics(connectionId: string) {
    return this.get<ClusterMetrics>(`/metrics/${connectionId}`)
  }

  getMetricsHistory(connectionId: string, from?: string, to?: string) {
    const params = new URLSearchParams()

    if (from) params.set('from', from)
    if (to) params.set('to', to)
    const query = params.toString()

    
return this.get<ClusterMetrics[]>(`/metrics/${connectionId}/history${query ? `?${query}` : ''}`)
  }

  // Clusters
  getClusters() {
    return this.get<Array<{ id: string; url: string; status: string }>>('/clusters')
  }

  getClusterNodes(connectionId: string) {
    return this.get<any[]>(`/clusters/${connectionId}/nodes`)
  }

  getClusterVMs(connectionId: string) {
    return this.get<any[]>(`/clusters/${connectionId}/vms`)
  }

  // Health check
  health() {
    return this.get<PulseHealth>('/health')
  }

  // SSH Connection Test
  testSSHConnection(connectionId: string) {
    return this.post<{
      success: boolean
      nodes?: Array<{
        node: string
        ip: string
        status: 'ok' | 'error'
        error?: string
      }>
      error?: string
    }>(`/connections/${connectionId}/test-ssh`)
  }
}

// ============================================
// Types Pulse (Orchestrator Health)
// ============================================

export interface PulseHealth {
  status: 'healthy' | 'degraded' | 'error'
  time: string
  version: string
  components: {
    drs: {
      enabled: boolean
      mode: string
      active_migrations: number
    }
    connections: {
      total: number
      connected: number
      details: Array<{ id: string; status: string }>
    }
    alerts?: {
      active: number
      critical: number
      warning: number
    }
    database?: {
      status: string
    }
  }
}

// ============================================
// Singleton instance
// ============================================

const orchestratorClient = new OrchestratorClient()

/**
 * Factory function pour obtenir le client orchestrator
 * Usage: const client = getOrchestratorClient()
 *        const response = await client.get('/drs/settings')
 *        console.log(response.data)
 */
export function getOrchestratorClient(): OrchestratorClient {
  return orchestratorClient
}

// Export pour compatibilité
export const orchestrator = orchestratorClient
export default orchestratorClient

// ============================================
// Types Alerts
// ============================================

export interface Alert {
  id: string
  connection_id: string
  type: 'cpu' | 'memory' | 'storage' | 'node_down' | 'vm_down' | 'custom'
  severity: 'info' | 'warning' | 'critical'
  status: 'active' | 'acknowledged' | 'resolved'
  resource: string
  resource_type: string
  resource_id: number
  message: string
  current_value: number
  threshold: number
  unit: string
  occurrences: number
  first_seen_at: string
  last_seen_at: string
  acknowledged_at?: string
  acknowledged_by?: string
  resolved_at?: string
  notified_at?: string
  created_at: string
  updated_at: string
}

export interface AlertSummary {
  total_active: number
  critical: number
  warning: number
  info: number
  acknowledged: number
  resolved_today: number
}

export interface AlertThresholds {
  cpu_warning: number
  cpu_critical: number
  memory_warning: number
  memory_critical: number
  storage_warning: number
  storage_critical: number
}

export interface AlertsResponse {
  data: Alert[]
  total: number
  limit: number
  offset: number
}

// ============================================
// Alerts API Methods
// ============================================

export const alertsApi = {
  // Get all alerts with filters
  async getAlerts(params?: {
    connection_id?: string
    status?: 'active' | 'acknowledged' | 'resolved'
    limit?: number
    offset?: number
  }): Promise<OrchestratorResponse<AlertsResponse>> {
    const searchParams = new URLSearchParams()

    if (params?.connection_id) searchParams.set('connection_id', params.connection_id)
    if (params?.status) searchParams.set('status', params.status)
    if (params?.limit) searchParams.set('limit', params.limit.toString())
    if (params?.offset) searchParams.set('offset', params.offset.toString())
    const query = searchParams.toString()

    
return orchestratorClient.get<AlertsResponse>(`/alerts${query ? `?${query}` : ''}`)
  },

  // Get active alerts only
  async getActiveAlerts(connectionId?: string): Promise<OrchestratorResponse<Alert[]>> {
    const query = connectionId ? `?connection_id=${connectionId}` : ''

    
return orchestratorClient.get<Alert[]>(`/alerts/active${query}`)
  },

  // Get alert summary
  async getSummary(connectionId?: string): Promise<OrchestratorResponse<AlertSummary>> {
    const query = connectionId ? `?connection_id=${connectionId}` : ''

    
return orchestratorClient.get<AlertSummary>(`/alerts/summary${query}`)
  },

  // Get single alert
  async getAlert(id: string): Promise<OrchestratorResponse<Alert>> {
    return orchestratorClient.get<Alert>(`/alerts/${id}`)
  },

  // Acknowledge an alert
  async acknowledge(id: string, acknowledgedBy?: string): Promise<OrchestratorResponse<{ status: string }>> {
    return orchestratorClient.post<{ status: string }>(`/alerts/${id}/acknowledge`, { acknowledged_by: acknowledgedBy })
  },

  // Resolve an alert manually
  async resolve(id: string): Promise<OrchestratorResponse<{ status: string }>> {
    return orchestratorClient.post<{ status: string }>(`/alerts/${id}/resolve`)
  },

  // Clear all active alerts
  async clearAll(connectionId?: string): Promise<OrchestratorResponse<{ status: string }>> {
    const query = connectionId ? `?connection_id=${connectionId}` : ''

    
return orchestratorClient.delete<{ status: string }>(`/alerts${query}`)
  },

  // Get thresholds
  async getThresholds(): Promise<OrchestratorResponse<AlertThresholds>> {
    return orchestratorClient.get<AlertThresholds>('/alerts/thresholds')
  },

  // Update thresholds
  async updateThresholds(thresholds: Partial<AlertThresholds>): Promise<OrchestratorResponse<AlertThresholds>> {
    return orchestratorClient.put<AlertThresholds>('/alerts/thresholds', thresholds)
  }
}

// ============================================
// Types Event Rules
// ============================================

export interface EventRule {
  id: string
  name: string
  description: string
  enabled: boolean
  category: 'task' | 'log' | 'all'
  level: 'error' | 'warning' | 'info' | 'all'
  task_types: string  // comma-separated
  pattern: string
  connection_id: string
  node_pattern: string
  severity: 'info' | 'warning' | 'critical'
  notify_email: boolean
  created_at: string
  updated_at: string
}

// ============================================
// Types LDAP (pour délégation vers orchestrator)
// ============================================

export interface LdapAuthRequest {
  username: string
  password: string
}

export interface LdapAuthResponse {
  success: boolean
  user?: {
    dn: string
    email: string
    name: string
    avatar?: string
  }
  error?: string
}

export interface LdapTestRequest {
  url: string
  bind_dn?: string
  bind_password?: string
  base_dn: string
  user_filter?: string
  tls_insecure?: boolean
}

export interface LdapTestResponse {
  success: boolean
  message: string
}

// ============================================
// LDAP API Methods (délégation vers orchestrator)
// ============================================

export const ldapApi = {
  /**
   * Authentifie un utilisateur via LDAP
   * L'orchestrator gère la connexion LDAP et retourne les infos utilisateur
   */
  async authenticate(request: LdapAuthRequest): Promise<OrchestratorResponse<LdapAuthResponse>> {
    return orchestratorClient.post<LdapAuthResponse>('/auth/ldap/authenticate', request)
  },

  /**
   * Teste la connexion LDAP avec les paramètres fournis
   */
  async testConnection(request: LdapTestRequest): Promise<OrchestratorResponse<LdapTestResponse>> {
    return orchestratorClient.post<LdapTestResponse>('/auth/ldap/test', request)
  },
}

export interface ProxmoxEvent {
  id: string
  ts: string
  level: string
  category: string
  type: string
  typeLabel: string
  entity: string
  node: string
  user: string
  status: string
  message: string
  connectionId: string
  connectionName: string
}

// ============================================
// Event Rules API Methods
// ============================================

export const eventRulesApi = {
  // Get all event rules
  async getRules(): Promise<OrchestratorResponse<EventRule[]>> {
    return orchestratorClient.get<EventRule[]>('/alerts/rules')
  },

  // Get single rule
  async getRule(id: string): Promise<OrchestratorResponse<EventRule>> {
    return orchestratorClient.get<EventRule>(`/alerts/rules/${id}`)
  },

  // Create a new rule
  async createRule(rule: Partial<EventRule>): Promise<OrchestratorResponse<EventRule>> {
    return orchestratorClient.post<EventRule>('/alerts/rules', rule)
  },

  // Update a rule
  async updateRule(id: string, rule: Partial<EventRule>): Promise<OrchestratorResponse<{ status: string }>> {
    return orchestratorClient.put<{ status: string }>(`/alerts/rules/${id}`, rule)
  },

  // Delete a rule
  async deleteRule(id: string): Promise<OrchestratorResponse<{ status: string }>> {
    return orchestratorClient.delete<{ status: string }>(`/alerts/rules/${id}`)
  },

  // Toggle a rule (enable/disable)
  async toggleRule(id: string): Promise<OrchestratorResponse<{ status: string }>> {
    return orchestratorClient.post<{ status: string }>(`/alerts/rules/${id}/toggle`)
  },

  // Process events (send events to orchestrator for analysis)
  async processEvents(events: ProxmoxEvent[]): Promise<OrchestratorResponse<{ status: string; processed: number }>> {
    return orchestratorClient.post<{ status: string; processed: number }>('/alerts/events', events)
  }
}