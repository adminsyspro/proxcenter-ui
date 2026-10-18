// Response schemas maintained NEXT TO the allowlist entries: the allowlist is
// not reducible to a pattern plus scopes (spec D8), the generator builds the
// spec skeleton from these metadata. One module per domain.
import { BACKUP_REQUEST_SCHEMAS, BACKUP_RESPONSE_SCHEMAS } from "./backups"
import { FIREWALL_REQUEST_SCHEMAS, FIREWALL_RESPONSE_SCHEMAS } from "./firewall"
import { HA_REQUEST_SCHEMAS, HA_RESPONSE_SCHEMAS } from "./ha"
import { MONITORING_RESPONSE_SCHEMAS } from "./monitoring"
import { NETWORK_REQUEST_SCHEMAS, NETWORK_RESPONSE_SCHEMAS } from "./network"
import { POOLS_REQUEST_SCHEMAS, POOLS_RESPONSE_SCHEMAS } from "./pools"
import { STORAGE_REQUEST_SCHEMAS, STORAGE_RESPONSE_SCHEMAS } from "./storage"
import { VM_REQUEST_SCHEMAS, VM_RESPONSE_SCHEMAS } from "./vms"

// Request body schemas, keyed by AllowlistEntry.requestSchemaRef. Naming
// convention: <PascalEntryId>Request. Each lists the fields its handler reads.
export const REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  ...VM_REQUEST_SCHEMAS,
  ...BACKUP_REQUEST_SCHEMAS,
  ...STORAGE_REQUEST_SCHEMAS,
  ...HA_REQUEST_SCHEMAS,
  ...POOLS_REQUEST_SCHEMAS,
  ...NETWORK_REQUEST_SCHEMAS,
  ...FIREWALL_REQUEST_SCHEMAS,
}

export const RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  ...MONITORING_RESPONSE_SCHEMAS,
  ...VM_RESPONSE_SCHEMAS,
  ...BACKUP_RESPONSE_SCHEMAS,
  ...STORAGE_RESPONSE_SCHEMAS,
  ...HA_RESPONSE_SCHEMAS,
  ...POOLS_RESPONSE_SCHEMAS,
  ...NETWORK_RESPONSE_SCHEMAS,
  ...FIREWALL_RESPONSE_SCHEMAS,
}
