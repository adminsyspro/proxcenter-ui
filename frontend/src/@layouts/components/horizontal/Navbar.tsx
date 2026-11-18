// Third-party Imports
import classnames from 'classnames'

// Util Imports
import { horizontalLayoutClasses } from '@layouts/utils/layoutClasses'

// Type Imports
import type { ReactNode } from 'react'

const Navbar = ({ children }: { children: ReactNode }) => {
  return (
    <div className={classnames(horizontalLayoutClasses.navbar, 'flex items-center justify-between is-full')}>
      {children}
    </div>
  )
}

export default Navbar
