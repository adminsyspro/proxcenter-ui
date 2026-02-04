// Third-party Imports
import classnames from 'classnames'

// Util Imports
import { horizontalLayoutClasses } from '@layouts/utils/layoutClasses'

const Navbar = ({ children }) => {
  return (
    <div className={classnames(horizontalLayoutClasses.navbar, 'flex items-center justify-between is-full')}>
      {children}
    </div>
  )
}

export default Navbar
