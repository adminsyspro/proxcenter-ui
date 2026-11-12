// Component Imports
import Login from '@views/Login'

// Server Action Imports
import { getServerMode } from '@core/utils/serverHelpers'

// A tenant's own login URL (issue #1289): its IdP when it has one, the regular
// login page otherwise. The tenant name is never shown here, so the page tells
// a visitor nothing about which tenants exist.
export const metadata = {
  title: 'Login',
  description: 'Login to your account'
}

const TenantLoginPage = async ({ params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params
  const mode = await getServerMode()

  return <Login mode={mode} tenantSlug={slug} />
}

export default TenantLoginPage
