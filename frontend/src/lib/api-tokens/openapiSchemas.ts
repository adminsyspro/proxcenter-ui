// Response schemas maintained NEXT TO the allowlist entries: the allowlist is
// not reducible to a pattern plus scopes (spec D8), the generator builds the
// spec skeleton from these metadata.
export const RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  VmsResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          vms: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                connId: { type: "string" },
                connectionName: { type: "string" },
                node: { type: "string" },
                vmid: { type: "string" },
                name: { type: "string" },
                type: { type: "string", enum: ["qemu", "lxc"] },
                status: { type: "string" },
                cpu: { type: "number" },
                ram: { type: "number" },
                cpuType: { type: ["string", "null"] },
                scsihw: { type: ["string", "null"] },
                agentEnabled: { type: "boolean" },
                bios: { type: ["string", "null"] },
                ostype: { type: ["string", "null"] },
                onboot: { type: "boolean" },
                agentResponding: { type: "boolean" },
                agentOsName: { type: ["string", "null"] },
              },
            },
          },
          stats: { type: "object", additionalProperties: { type: "number" } },
        },
      },
    },
  },
  InventoryResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          clusters: { type: "array", items: { type: "object" } },
          pbsServers: { type: "array", items: { type: "object" } },
          externalHypervisors: { type: "array", items: { type: "object" } },
          cached: { type: "boolean" },
          stats: { type: "object", additionalProperties: { type: "number" } },
        },
      },
    },
  },
  StorageResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: { type: "object" } },
      connections: { type: "array", items: { type: "object" } },
    },
  },
  PbsBackupsResponse: {
    type: "object",
    properties: {
      data: { type: "array", items: { type: "object" } },
      warnings: { type: "array", items: { type: "string" } },
    },
  },
  PublicBackupsResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          guests: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connId: { type: "string" },
                connectionName: { type: "string" },
                vmid: { type: "string" },
                backupType: { type: "string", enum: ["vm", "ct", "host"] },
                latestBackupTime: { type: ["integer", "null"] },
                latestBackupIso: { type: ["string", "null"] },
                ageSeconds: { type: ["integer", "null"] },
                datastore: { type: ["string", "null"] },
                namespace: { type: ["string", "null"] },
                pbsConnectionId: { type: ["string", "null"] },
                pbsConnectionName: { type: ["string", "null"] },
                sizeBytes: { type: ["integer", "null"] },
                verified: { type: ["boolean", "null"] },
              },
            },
          },
          warnings: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
  HealthResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          status: { type: "string", enum: ["ok", "degraded"] },
          tenantId: { type: "string" },
          cached: { type: "boolean" },
          connections: {
            type: "array",
            items: {
              type: "object",
              properties: {
                connId: { type: "string" },
                name: { type: "string" },
                reachable: { type: "boolean" },
                nodesOnline: { type: "integer" },
                nodesTotal: { type: "integer" },
              },
            },
          },
        },
      },
    },
  },
  PrometheusExposition: {
    type: "string",
    description: "Prometheus text exposition format (version 0.0.4).",
  },
}
