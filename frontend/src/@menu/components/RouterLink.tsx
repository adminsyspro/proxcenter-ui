'use client'

// React Imports
import { forwardRef } from 'react'
import type { ComponentProps } from 'react'

// Next Imports
import Link from 'next/link'

export const RouterLink = forwardRef<HTMLAnchorElement, ComponentProps<typeof Link>>((props, ref) => {
  // Props
  const { href, className, ...other } = props

  return (
    <Link ref={ref} href={href} className={className} {...other}>
      {props.children}
    </Link>
  )
})
