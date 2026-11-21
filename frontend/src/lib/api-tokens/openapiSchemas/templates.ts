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

export const TEMPLATE_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {}

export const TEMPLATE_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  TemplateCatalogResponse: { type: "object", properties: { data: { type: "array", items: IMAGE } } },
  TemplateBlueprintListResponse: { type: "object", properties: { data: { type: "array", items: BLUEPRINT } } },
  TemplateBlueprintResponse: { type: "object", properties: { data: BLUEPRINT } },
}
