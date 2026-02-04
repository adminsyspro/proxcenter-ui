'use client'

// Hook Imports
import useVerticalNav from '../../hooks/useVerticalNav'

// Icon Imports
import CloseIcon from '../../svg/Close'
import RadioCircleIcon from '../../svg/RadioCircle'
import RadioCircleMarkedIcon from '../../svg/RadioCircleMarked'

const NavCollapseIcons = props => {
  // Props
  const { closeIcon, lockedIcon, unlockedIcon, onClick, onClose, ...rest } = props

  // Hooks
  const { isCollapsed, collapseVerticalNav, isBreakpointReached, toggleVerticalNav } = useVerticalNav()

  // Handle Lock / Unlock Icon Buttons click
  const handleClick = action => {
    // Setup the verticalNav to be locked or unlocked
    const collapse = action === 'lock' ? false : true

    // Tell the verticalNav to lock or unlock
    collapseVerticalNav(collapse)

    // Call onClick function if passed
    onClick && onClick()
  }

  // Handle Close button click
  const handleClose = () => {
    // Close verticalNav using toggle verticalNav function
    toggleVerticalNav(false)

    // Call onClose function if passed
    onClose && onClose()
  }

  return (
    <>
      {isBreakpointReached ? (
        <span role='button' tabIndex={0} style={{ display: 'flex', cursor: 'pointer' }} onClick={handleClose} {...rest}>
          {closeIcon ?? <CloseIcon />}
        </span>
      ) : isCollapsed ? (
        <span
          role='button'
          tabIndex={0}
          style={{ display: 'flex', cursor: 'pointer' }}
          onClick={() => handleClick('lock')}
          {...rest}
        >
          {unlockedIcon ?? <RadioCircleIcon />}
        </span>
      ) : (
        <span
          role='button'
          tabIndex={0}
          style={{ display: 'flex', cursor: 'pointer' }}
          onClick={() => handleClick('unlock')}
          {...rest}
        >
          {lockedIcon ?? <RadioCircleMarkedIcon />}
        </span>
      )}
    </>
  )
}

export default NavCollapseIcons
