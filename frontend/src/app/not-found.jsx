import Providers from '@components/Providers'
import BlankLayout from '@layouts/BlankLayout'
import ErrorPage from '@components/ErrorPage'
import { getSystemMode } from '@core/utils/serverHelpers'

export const metadata = {
  title: '404 - Page introuvable | ProxCenter',
  description: 'La page que vous recherchez n\'existe pas.',
}

export default async function NotFoundPage() {
  const systemMode = await getSystemMode()

  return (
    <Providers direction="ltr">
      <BlankLayout systemMode={systemMode}>
        <ErrorPage code={404} />
      </BlankLayout>
    </Providers>
  )
}
