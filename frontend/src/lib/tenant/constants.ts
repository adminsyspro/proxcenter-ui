// Client-safe tenant constants. This module must have NO server-only imports
// (no next-auth, no prisma) so it can be imported from client components.

/** The provider (default) tenant id. A vDC tenant is any other id. */
export const DEFAULT_TENANT_ID = 'default'
