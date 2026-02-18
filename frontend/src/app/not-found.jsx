import Providers from '@components/Providers'
import BlankLayout from '@layouts/BlankLayout'
import ErrorPage from '@components/ErrorPage'
import { getSystemMode } from '@core/utils/serverHelpers'
import { getTranslations } from 'next-intl/server'

export async function generateMetadata() {
  const t = await getTranslations('errorPages')
  return {
    title: t('metaTitle'),
    description: t('metaDescription'),
  }
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
