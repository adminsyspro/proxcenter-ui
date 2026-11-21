// Template catalogue domain (roadmap#265).
const IMAGE = {
  type: "object",
  properties: {
    slug: { type: "string", description: "Value to send as `imageSlug` to POST /api/v1/templates/deploy" },
    name: { type: "string" },
    vendor: { type: "string" },
    version: { type: "string" },
    format: { type: "string", description: "qcow2, raw, img or iso" },
    isCustom: { type: "boolean" },
    isShared: { type: "boolean" },
    ownedByCaller: { type: "boolean" },
  },
  additionalProperties: true,
}

const BLUEPRINT = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    description: { type: ["string", "null"] },
    imageSlug: { type: "string" },
    hardware: { type: "object", additionalProperties: true },
    cloudInit: {
      type: ["object", "null"],
      description: "Cloud-init defaults, never with a password",
      properties: {
        ciuser: { type: "string" }, sshKeys: { type: "string" }, ipconfig0: { type: "string" },
        nameserver: { type: "string" }, searchdomain: { type: "string" },
      },
    },
    ownedByCaller: { type: "boolean" },
  },
  additionalProperties: true,
}

export const TEMPLATE_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  TemplateDeployRequest: {
    type: "object",
    required: ["connectionId", "node", "storage", "vmid", "imageSlug", "hardware"],
    properties: {
      connectionId: { type: "string" },
      node: { type: "string" },
      storage: { type: "string", description: "Storage of the VM disk" },
      isoStorage: { type: "string", description: "ISO images only: storage holding the boot ISO" },
      vmid: { type: "integer", minimum: 100, description: "From GET /api/v1/connections/{id}/cluster/nextid" },
      vmName: { type: "string", maxLength: 63 },
      imageSlug: { type: "string", description: "From GET /api/v1/templates/catalog" },
      blueprintId: { type: "string" },
      start: { type: "boolean", default: true, description: "false leaves the VM stopped" },
      ha: { type: "boolean", description: "Register the VM as an HA resource" },
      hardware: {
        type: "object",
        properties: {
          cores: { type: "integer", minimum: 1, maximum: 128 },
          sockets: { type: "integer", minimum: 1, maximum: 4 },
          memory: { type: "integer", minimum: 128, description: "MiB" },
          diskSize: { type: "string", pattern: "^\\d+G$" },
          scsihw: { type: "string" },
          networkModel: { type: "string" },
          networkBridge: { type: "string" },
          vlanTag: { type: ["integer", "null"], minimum: 1, maximum: 4094 },
          ostype: { type: "string" },
          agent: { type: "boolean" },
          cpu: { type: "string" },
        },
        additionalProperties: true,
      },
      cloudInit: {
        type: ["object", "null"],
        properties: {
          ciuser: { type: "string" }, cipassword: { type: "string" }, sshKeys: { type: "string" },
          ipconfig0: { type: "string", default: "ip=dhcp" }, nameserver: { type: "string" }, searchdomain: { type: "string" },
        },
      },
      targetVdcId: { type: "string", description: "Provider only: deploy into this tenant vDC" },
    },
  },
}

export const TEMPLATE_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  TemplateCatalogResponse: { type: "object", properties: { data: { type: "array", items: IMAGE } } },
  TemplateBlueprintListResponse: { type: "object", properties: { data: { type: "array", items: BLUEPRINT } } },
  TemplateBlueprintResponse: { type: "object", properties: { data: BLUEPRINT } },
  TemplateDeployResponse: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: { deploymentId: { type: "string" }, status: { type: "string", enum: ["pending"] }, vmid: { type: "integer" } },
      },
    },
  },
}
