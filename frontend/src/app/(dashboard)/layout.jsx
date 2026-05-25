// Next Imports
import { redirect } from 'next/navigation'

// NextAuth Imports
import { getServerSession } from 'next-auth'

// MUI Imports
import Button from '@mui/material/Button'

// Layout Imports
import LayoutWrapper from '@layouts/LayoutWrapper'
import VerticalLayout from '@layouts/VerticalLayout'
import HorizontalLayout from '@layouts/HorizontalLayout'

// Component Imports
import Providers from '@components/Providers'
import Navigation from '@components/layout/vertical/Navigation'
import Header from '@components/layout/horizontal/Header'
import Navbar from '@components/layout/vertical/Navbar'
import ScrollToTop from '@core/components/scroll-to-top'
import TasksFooter from '@components/TasksFooter'
import OnboardingGuard from '@components/OnboardingGuard'
import DemoBanner from '@components/DemoBanner'
import DemoInterceptor from '@components/DemoInterceptor'
import { ProxCenterTasksProvider } from '@/contexts/ProxCenterTasksContext'
import { RollingUpdateProvider } from '@/contexts/RollingUpdateContext'
import { TagColorProvider } from '@/contexts/TagColorContext'

// Auth Imports
import { authOptions } from '@/lib/auth/config'
import { needsEnrollment } from '@/lib/auth/enforce-2fa'

// Util Imports
import { getMode, getSystemMode } from '@core/utils/serverHelpers'

const Layout = async props => {
  const { children } = props

  // Authoritative 2FA enrollment gate. The Edge middleware only consults the
  // JWT hint, so sessions minted before the policy was turned on slip past
  // it. This DB check catches them on every protected page navigation.
  const session = await getServerSession(authOptions)

  if (session?.user?.id && (await needsEnrollment(session.user.id))) {
    redirect('/profile/2fa/enrollment')
  }

  // Type guard to ensure lang is a valid Locale
  // Vars
  const direction = 'ltr'
  const mode = await getMode()
  const systemMode = await getSystemMode()

  return (
    <Providers direction={direction}>
      <DemoBanner />
      <DemoInterceptor />
      <TagColorProvider>
      <ProxCenterTasksProvider>
      <RollingUpdateProvider>
      <LayoutWrapper
        systemMode={systemMode}
        verticalLayout={
          <VerticalLayout navigation={<Navigation mode={mode} />} navbar={<Navbar />}>
            <OnboardingGuard>{children}</OnboardingGuard>
          </VerticalLayout>
        }
        horizontalLayout={
          <HorizontalLayout header={<Header />}>
            <OnboardingGuard>{children}</OnboardingGuard>
          </HorizontalLayout>
        }
      />
      <TasksFooter />
      </RollingUpdateProvider>
      </ProxCenterTasksProvider>
      </TagColorProvider>
      <ScrollToTop className='mui-fixed'>
        <Button variant='contained' className='is-10 bs-10 rounded-full p-0 min-is-0 flex items-center justify-center'>
          <i className='ri-arrow-up-line' />
        </Button>
      </ScrollToTop>
    </Providers>
  )
}

export default Layout