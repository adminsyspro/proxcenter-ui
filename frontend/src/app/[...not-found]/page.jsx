// Component Imports
import Providers from '@components/Providers'
import BlankLayout from '@layouts/BlankLayout'
import NotFound from '@views/NotFound'

// Util Imports
import { getSystemMode, getServerMode } from '@core/utils/serverHelpers'

const NotFoundPage = async () => {
  // Type guard to ensure lang is a valid Locale
  // Vars
  const direction = 'ltr'
  const systemMode = await getSystemMode()
  const mode = await getServerMode()

  return (
    <Providers direction={direction}>
      <BlankLayout systemMode={systemMode}>
        <NotFound mode={mode} />
      </BlankLayout>
    </Providers>
  )
}

export default NotFoundPage
