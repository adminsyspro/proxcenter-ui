'use client'

interface VendorLogoProps {
  vendor: string
  size?: number
}

const VENDOR_LOGOS: Record<string, string> = {
  ubuntu: '/images/vendors/ubuntu.svg',
  debian: '/images/vendors/debian.svg',
  rocky: '/images/vendors/rocky.svg',
  alma: '/images/vendors/alma.svg',
  fedora: '/images/vendors/fedora.svg',
  opensuse: '/images/vendors/opensuse.svg',
}

export default function VendorLogo({ vendor, size = 28 }: VendorLogoProps) {
  const src = VENDOR_LOGOS[vendor]

  if (!src) {
    return <i className="ri-cloud-line" style={{ fontSize: size * 0.7 }} />
  }

  return (
    <img
      src={src}
      alt={vendor}
      width={size}
      height={size}
      style={{ objectFit: 'contain' }}
    />
  )
}
