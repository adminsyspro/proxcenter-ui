'use client'

// Component Imports
import Navigation from './Navigation'
import NavbarContent from './NavbarContent'
import Navbar from '@layouts/components/horizontal/Navbar'
import LayoutHeader from '@layouts/components/horizontal/Header'
import VCenterHeader from '@components/layout/vcenter/VCenterHeader'

// Hook Imports
import useHorizontalNav from '@menu/hooks/useHorizontalNav'
import { useSettings } from '@core/hooks/useSettings'

const Header = () => {
  // Hooks
  const { isBreakpointReached } = useHorizontalNav()
  const { settings } = useSettings()

  // vCenter theme: render dedicated header instead of standard horizontal layout
  if (settings.globalTheme === 'vcenter') {
    return <VCenterHeader />
  }

  return (
    <>
      <LayoutHeader>
        <Navbar>
          <NavbarContent />
        </Navbar>
        {!isBreakpointReached && <Navigation />}
      </LayoutHeader>
      {isBreakpointReached && <Navigation />}
    </>
  )
}

export default Header
