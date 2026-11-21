// PURE data module: imported by BOTH the proxy (D7) and
// principal.ts (D8). NO DB access, ever.
// ── Template catalogue domain (roadmap#265) ─────────────────────────────────
// What a vDC tenant deploys from: the catalogue granted to it, and the
// blueprints it owns or was granted. The handlers apply the same grants as
// the deployment wizard.
import type { AllowlistEntry } from "./types"
import { VM_READ_SCOPES } from "./vms"

const TEMPLATES_FILE = "src/app/api/v1/templates"

type TemplateEntry = Omit<AllowlistEntry, "tag" | "routeFile" | "pattern"> & { file: string }

function templateEntry({ file, ...entry }: TemplateEntry): AllowlistEntry {
  return {
    ...entry,
    tag: "Templates",
    pattern: `/api/v1/templates/${file.replaceAll(/\[(\w+)\]/g, "{$1}")}`,
    routeFile: `${TEMPLATES_FILE}/${file}/route.ts`,
  }
}

export const TEMPLATE_ENTRIES: AllowlistEntry[] = [
  templateEntry({
    id: "templates-catalog",
    method: "GET",
    file: "catalog",
    requiredScopes: VM_READ_SCOPES,
    summary: "Images a deployment can start from",
    description:
      "The built-in cloud images (unless the provider turned them off for the tenant) and the custom images the caller owns, sees as shared, or was granted. A deployment names one by its `slug`.",
    queryParams: [{ name: "vendor", description: "Only the images of this vendor" }],
    responseSchemaRef: "TemplateCatalogResponse",
  }),
  templateEntry({
    id: "templates-blueprints",
    method: "GET",
    file: "blueprints",
    requiredScopes: VM_READ_SCOPES,
    summary: "Blueprints the caller can deploy",
    description:
      "Deployment recipes (image, hardware, cloud-init defaults) the caller owns, sees as shared, or was granted. A cloud-init password is never returned.",
    responseSchemaRef: "TemplateBlueprintListResponse",
  }),
  templateEntry({
    id: "templates-blueprint-get",
    method: "GET",
    file: "blueprints/[id]",
    requiredScopes: VM_READ_SCOPES,
    summary: "One blueprint",
    description: "A blueprint the caller owns, sees as shared, or was granted; 404 otherwise. A cloud-init password is never returned.",
    responseSchemaRef: "TemplateBlueprintResponse",
  }),
]
