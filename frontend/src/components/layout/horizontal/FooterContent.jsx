'use client'

// Next Imports
import Link from 'next/link'

// Third-party Imports
import classnames from 'classnames'

// Hook Imports
import useHorizontalNav from '@menu/hooks/useHorizontalNav'

// Util Imports
import { horizontalLayoutClasses } from '@layouts/utils/layoutClasses'

const FooterContent = () => {
  // Hooks
  const { isBreakpointReached } = useHorizontalNav()

  return (
    <div
      className={classnames(horizontalLayoutClasses.footerContent, 'flex items-center justify-between flex-wrap gap-4')}
    >
      <p>
        <span>{`© ${new Date().getFullYear()}, Made with `}</span>
        <span>{`❤️`}</span>
        <span>{` by `}</span>
        <Link href='https://themeselection.com' target='_blank' className='text-primary'>
          ThemeSelection
        </Link>
      </p>
      {!isBreakpointReached && (
        <div className='flex items-center gap-4'>
          <Link href='https://themeselection.com/license' target='_blank' className='text-primary'>
            License
          </Link>
          <Link href='https://themeselection.com' target='_blank' className='text-primary'>
            More Themes
          </Link>
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
