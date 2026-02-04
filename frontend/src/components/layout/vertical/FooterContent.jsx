'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import classnames from 'classnames'

// Hook Imports
import useVerticalNav from '@menu/hooks/useVerticalNav'

// Util Imports
import { verticalLayoutClasses } from '@layouts/utils/layoutClasses'

const FooterContent = () => {
  // Hooks
  const { isBreakpointReached } = useVerticalNav()

  return (
    <div
      className={classnames(verticalLayoutClasses.footerContent, 'flex items-center justify-between flex-wrap gap-4')}
    >
      <p>
        <span>{`© ${new Date().getFullYear()} ProxCenter - v0.3`}</span>
      </p>
      {!isBreakpointReached && (
        <div className='flex items-center gap-4'>
          <Link
            href='https://demos.themeselection.com/materio-mui-nextjs-admin-template/documentation'
            target='_blank'
            className='text-primary'
          >
            Documentation
          </Link>
          <Link href='https://themeselection.com/support' target='_blank' className='text-primary'>
            Support
          </Link>
        </div>
      )}
    </div>
  )
}

export default FooterContent
