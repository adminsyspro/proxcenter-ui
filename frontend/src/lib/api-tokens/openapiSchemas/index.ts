// Response schemas maintained NEXT TO the allowlist entries: the allowlist is
// not reducible to a pattern plus scopes (spec D8), the generator builds the
// spec skeleton from these metadata. One module per domain.
import { BACKUP_REQUEST_SCHEMAS, BACKUP_RESPONSE_SCHEMAS } from "./backups"
import { MONITORING_RESPONSE_SCHEMAS } from "./monitoring"
import { STORAGE_REQUEST_SCHEMAS, STORAGE_RESPONSE_SCHEMAS } from "./storage"
import { VM_REQUEST_SCHEMAS, VM_RESPONSE_SCHEMAS } from "./vms"

// Request body schemas, keyed by AllowlistEntry.requestSchemaRef. Naming
// convention: <PascalEntryId>Request. Each lists the fields its handler reads.
export const REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  ...VM_REQUEST_SCHEMAS,
  ...BACKUP_REQUEST_SCHEMAS,
  ...STORAGE_REQUEST_SCHEMAS,
}

export const RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  ...MONITORING_RESPONSE_SCHEMAS,
  ...VM_RESPONSE_SCHEMAS,
  ...BACKUP_RESPONSE_SCHEMAS,
  ...STORAGE_RESPONSE_SCHEMAS,
}
