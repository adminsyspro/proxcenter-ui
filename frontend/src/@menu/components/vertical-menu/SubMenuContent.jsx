// React Imports
import { forwardRef, useEffect, useState } from 'react'

// Third-party Imports
import PerfectScrollbar from 'react-perfect-scrollbar'

// Styled Component Imports
import StyledSubMenuContent from '../../styles/StyledSubMenuContent'

// Style Imports
import styles from '../../styles/styles.module.css'

const SubMenuContent = (props, ref) => {
  // Props
  const {
    children,
    open,
    level,
    isCollapsed,
    isHovered,
    transitionDuration,
    isPopoutWhenCollapsed,
    openWhenCollapsed,
    browserScroll,
    ...rest
  } = props

  // States
  const [mounted, setMounted] = useState(false)

  // Refs
  const SubMenuContentRef = ref

  useEffect(() => {
    if (mounted) {
      if (open || (open && isHovered)) {
        const target = SubMenuContentRef?.current

        if (target) {
          target.style.display = 'block'
          target.style.overflow = 'hidden'
          target.style.blockSize = 'auto'
          const height = target.offsetHeight

          target.style.blockSize = '0px'
          target.offsetHeight
          target.style.blockSize = `${height}px`
          setTimeout(() => {
            target.style.overflow = 'auto'
            target.style.blockSize = 'auto'
          }, transitionDuration)
        }
      } else {
        const target = SubMenuContentRef?.current

        if (target) {
          target.style.overflow = 'hidden'
          target.style.blockSize = `${target.offsetHeight}px`
          target.offsetHeight
          target.style.blockSize = '0px'
          setTimeout(() => {
            target.style.overflow = 'auto'
            target.style.display = 'none'
          }, transitionDuration)
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted, SubMenuContentRef])
  useEffect(() => {
    setMounted(true)
  }, [isHovered])

  return (
    <StyledSubMenuContent
      ref={ref}
      level={level}
      isCollapsed={isCollapsed}
      isHovered={isHovered}
      open={open}
      openWhenCollapsed={openWhenCollapsed}
      isPopoutWhenCollapsed={isPopoutWhenCollapsed}
      transitionDuration={transitionDuration}
      browserScroll={browserScroll}
      {...rest}
    >
      {/* If browserScroll is false render PerfectScrollbar */}
      {!browserScroll && level === 0 && isPopoutWhenCollapsed && isCollapsed ? (
        <PerfectScrollbar
          options={{ wheelPropagation: false, suppressScrollX: true }}
          style={{ maxBlockSize: `calc((var(--vh, 1vh) * 100))` }}
        >
          <ul className={styles.ul}>{children}</ul>
        </PerfectScrollbar>
      ) : (
        <ul className={styles.ul}>{children}</ul>
      )}
    </StyledSubMenuContent>
  )
}

export default forwardRef(SubMenuContent)
