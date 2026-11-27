// Authorization coverage of the API routes, enforced by routeAuthzCoverage.test.ts.
//
// A route file is covered when a permission check is within reach: it calls
// one of AUTHZ_GUARDS itself, or it takes a value from a module that does (a
// shared handler or a domain guard such as lib/incidents/guard). Every other
// route must be listed in ROUTES_WITHOUT_PERMISSION_CHECK with the reason it
// needs none. A new route with neither fails the test.
//
// The test proves reach, not correctness: it cannot tell that the right
// permission is checked on the right resource. Reviews and scans judge that.
// Keys are route directories relative to src/app/api.

/** Functions that decide whether the caller may act. Add a new guard here in the change that introduces it. */
export const AUTHZ_GUARDS: readonly string[] = [
  'checkPermission',
  'hasPermission',
  'requireAdmin',
  'requireProviderAdmin',
  'isUserSuperAdmin',
  'requireSuperAdminCaller',
  'requireBackupOperator',
  'authorizeAdminRead',
  'canReadRoleAssignments',
  'getRBACContext',
  'getCurrentRbacInfraScope',
  'loadGuestVisibilityCheck',
  'filterVmsByPermission',
  'drillTargetDenied',
  'requireK8sPermission',
]

const PUBLIC_SIGN_IN = 'Public: read by the sign-in page before any session exists'
const OWN_ACCOUNT = "Self-service: reads or changes only the caller's own account, keyed by the session user"
const OWN_PREFERENCES = "Self-service: the caller's own preferences, keyed by the session user"
const EVERY_USER = 'Every signed-in user:'

export const ROUTES_WITHOUT_PERMISSION_CHECK: Readonly<Record<string, string>> = {
  'acme/challenge/[token]': 'Public: the certificate authority fetches the HTTP-01 challenge without credentials',
  'auth/[...nextauth]': 'Public: the NextAuth sign-in handler',
  health: 'Public: readiness probe',
  'health/live': 'Public: liveness probe',
  'internal/alert-config': 'Internal: authenticated by the orchestrator API key, compared in constant time',
  'v1/app/status': PUBLIC_SIGN_IN,
  'v1/auth/providers': PUBLIC_SIGN_IN,
  'v1/auth/setup': 'Public by design: first-run setup, gated by the setup token and refused once a user exists',
  'v1/settings/branding/public': PUBLIC_SIGN_IN,
  'v1/settings/branding/uploads/[filename]': PUBLIC_SIGN_IN,
  'v1/settings/login-background/serve/[filename]': PUBLIC_SIGN_IN,
  'v1/auth/2fa/status': OWN_ACCOUNT,
  'v1/auth/me/tenants': OWN_ACCOUNT,
  'v1/auth/oidc/logout-url': OWN_ACCOUNT,
  'v1/auth/sessions': OWN_ACCOUNT,
  'v1/auth/sessions/[sid]': OWN_ACCOUNT,
  'v1/upload-progress/[uploadId]': 'Self-service: the counters of an upload, scoped to the user who opened it',
  'v1/dashboard/layout': OWN_PREFERENCES,
  'v1/favorites': OWN_PREFERENCES,
  'v1/settings/appearance': OWN_PREFERENCES,
  'v1/broadcasts/active': `${EVERY_USER} the announcements addressed to the caller's tenant and roles`,
  'v1/license/features': `${EVERY_USER} the interface needs the licensed feature list to render`,
  'v1/license/partner-logo': `${EVERY_USER} the partner logo of the License tab`,
  'v1/orchestrator/health': `${EVERY_USER} the orchestrator state shown by the interface`,
  'v1/version/check': `${EVERY_USER} compares the running version with the latest release`,
}
