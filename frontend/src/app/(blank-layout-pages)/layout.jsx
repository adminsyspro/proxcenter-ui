// Component Imports
import Providers from '@components/Providers'
import BlankLayout from '@layouts/BlankLayout'

// Util Imports
import { getSystemMode } from '@core/utils/serverHelpers'

const Layout = async props => {
  const { children } = props

  // Type guard to ensure lang is a valid Locale
  // Vars
  const direction = 'ltr'
  const systemMode = await getSystemMode()

  return (
    <Providers direction={direction}>
      <BlankLayout systemMode={systemMode}>{children}</BlankLayout>
    </Providers>
  )
}

export default Layout
