// Component Imports
import Login from '@views/Login'

// Server Action Imports
import { getServerMode } from '@core/utils/serverHelpers'

export const metadata = {
  title: 'Local access',
  description: 'Local account sign-in'
}

// Escape-hatch login route. Always renders the local form (forceLocal) and
// never auto-redirects to the IdP, so an admin can sign in locally even when
// SSO is hidden from /login or the IdP is down.
const AccessPage = async () => {
  // Vars
  const mode = await getServerMode()

  return <Login mode={mode} forceLocal />
}

export default AccessPage
