// src/lib/templates/cloudImages.ts
// Static catalog of certified cloud images for Proxmox cloud-init deployment

export interface CloudImage {
  slug: string
  name: string
  vendor: string
  version: string
  arch: string
  format: string
  downloadUrl: string
  checksumUrl: string | null
  defaultDiskSize: string // e.g. "20G"
  minMemory: number // MB
  recommendedMemory: number // MB
  minCores: number
  recommendedCores: number
  ostype: string // PVE ostype: l26, win10, etc.
  tags: string[]
  logoIcon: string // RemixIcon class
}

export const VENDORS = [
  { id: 'ubuntu', name: 'Ubuntu', icon: 'ri-ubuntu-fill' },
  { id: 'debian', name: 'Debian', icon: 'ri-debian-fill' },
  { id: 'rocky', name: 'Rocky Linux', icon: 'ri-centos-fill' },
  { id: 'alma', name: 'AlmaLinux', icon: 'ri-centos-fill' },
  { id: 'fedora', name: 'Fedora', icon: 'ri-fedora-fill' },
  { id: 'opensuse', name: 'openSUSE', icon: 'ri-suse-fill' },
  // The icon strings here are RemixIcon class names used by the vendor
  // filter chips. Distros without a native RemixIcon glyph (Alpine, Arch)
  // get a generic cloud icon — VendorLogo (used elsewhere) loads the real
  // SVG from /images/vendors/ which is always preferred when available.
  { id: 'alpine', name: 'Alpine Linux', icon: 'ri-cloud-line' },
  { id: 'arch', name: 'Arch Linux', icon: 'ri-cloud-line' },
  { id: 'centos', name: 'CentOS Stream', icon: 'ri-centos-fill' },
  { id: 'freebsd', name: 'FreeBSD', icon: 'ri-server-line' },
] as const

export const CLOUD_IMAGES: CloudImage[] = [
  {
    slug: 'ubuntu-2604',
    name: 'Ubuntu 26.04 LTS (Resolute Reindeer)',
    vendor: 'ubuntu',
    version: '26.04',
    arch: 'amd64',
    format: 'qcow2',
    downloadUrl: 'https://cloud-images.ubuntu.com/resolute/current/resolute-server-cloudimg-amd64.img',
    checksumUrl: 'https://cloud-images.ubuntu.com/resolute/current/SHA256SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['lts', 'cloud-init', 'popular'],
    logoIcon: 'ri-ubuntu-fill',
  },
  {
    slug: 'ubuntu-2404',
    name: 'Ubuntu 24.04 LTS (Noble Numbat)',
    vendor: 'ubuntu',
    version: '24.04',
    arch: 'amd64',
    format: 'qcow2',
    downloadUrl: 'https://cloud-images.ubuntu.com/noble/current/noble-server-cloudimg-amd64.img',
    checksumUrl: 'https://cloud-images.ubuntu.com/noble/current/SHA256SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['lts', 'cloud-init', 'popular'],
    logoIcon: 'ri-ubuntu-fill',
  },
  {
    slug: 'ubuntu-2204',
    name: 'Ubuntu 22.04 LTS (Jammy Jellyfish)',
    vendor: 'ubuntu',
    version: '22.04',
    arch: 'amd64',
    format: 'qcow2',
    downloadUrl: 'https://cloud-images.ubuntu.com/jammy/current/jammy-server-cloudimg-amd64.img',
    checksumUrl: 'https://cloud-images.ubuntu.com/jammy/current/SHA256SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['lts', 'cloud-init'],
    logoIcon: 'ri-ubuntu-fill',
  },
  {
    slug: 'debian-13',
    name: 'Debian 13 (Trixie)',
    vendor: 'debian',
    version: '13',
    arch: 'amd64',
    format: 'qcow2',
    // `/latest/` redirects to the freshest point release (e.g. 13.0,
    // 13.1, …) so the URL stays valid across patch cycles without code
    // changes — same pattern as bookworm/bullseye below.
    downloadUrl: 'https://cloud.debian.org/images/cloud/trixie/latest/debian-13-generic-amd64.qcow2',
    checksumUrl: 'https://cloud.debian.org/images/cloud/trixie/latest/SHA512SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 1024,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['stable', 'cloud-init', 'popular'],
    logoIcon: 'ri-debian-fill',
  },
  {
    slug: 'debian-12',
    name: 'Debian 12 (Bookworm)',
    vendor: 'debian',
    version: '12',
    arch: 'amd64',
    format: 'qcow2',
    downloadUrl: 'https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-generic-amd64.qcow2',
    checksumUrl: 'https://cloud.debian.org/images/cloud/bookworm/latest/SHA512SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 1024,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['oldstable', 'cloud-init'],
    logoIcon: 'ri-debian-fill',
  },
  {
    slug: 'debian-11',
    name: 'Debian 11 (Bullseye)',
    vendor: 'debian',
    version: '11',
    arch: 'amd64',
    format: 'qcow2',
    downloadUrl: 'https://cloud.debian.org/images/cloud/bullseye/latest/debian-11-generic-amd64.qcow2',
    checksumUrl: 'https://cloud.debian.org/images/cloud/bullseye/latest/SHA512SUMS',
    defaultDiskSize: '20G',
    minMemory: 512,
    recommendedMemory: 1024,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    // Bullseye LTS officially ends in August 2026 — keep it for transition
    // workloads but flag it so users notice it's not the right default.
    tags: ['oldoldstable', 'cloud-init', 'eol-soon'],
    logoIcon: 'ri-debian-fill',
  },
  {
    slug: 'rocky-10',
    name: 'Rocky Linux 10',
    vendor: 'rocky',
    version: '10',
    arch: 'x86_64',
    format: 'qcow2',
    // `.latest.` is a server-side symlink that always points to the most
    // recent point release (10.0, 10.1…), same convention as Rocky 9.
    downloadUrl: 'https://dl.rockylinux.org/pub/rocky/10/images/x86_64/Rocky-10-GenericCloud.latest.x86_64.qcow2',
    checksumUrl: 'https://dl.rockylinux.org/pub/rocky/10/images/x86_64/CHECKSUM',
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['rhel', 'cloud-init', 'enterprise', 'popular'],
    logoIcon: 'ri-centos-fill',
  },
  {
    slug: 'rocky-9',
    name: 'Rocky Linux 9',
    vendor: 'rocky',
    version: '9',
    arch: 'x86_64',
    format: 'qcow2',
    downloadUrl: 'https://dl.rockylinux.org/pub/rocky/9/images/x86_64/Rocky-9-GenericCloud.latest.x86_64.qcow2',
    checksumUrl: 'https://dl.rockylinux.org/pub/rocky/9/images/x86_64/CHECKSUM',
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['rhel', 'cloud-init', 'enterprise'],
    logoIcon: 'ri-centos-fill',
  },
  {
    slug: 'alma-10',
    name: 'AlmaLinux 10',
    vendor: 'alma',
    version: '10',
    arch: 'x86_64',
    format: 'qcow2',
    downloadUrl: 'https://repo.almalinux.org/almalinux/10/cloud/x86_64/images/AlmaLinux-10-GenericCloud-latest.x86_64.qcow2',
    checksumUrl: 'https://repo.almalinux.org/almalinux/10/cloud/x86_64/images/CHECKSUM',
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['rhel', 'cloud-init', 'enterprise', 'popular'],
    logoIcon: 'ri-centos-fill',
  },
  {
    slug: 'alma-9',
    name: 'AlmaLinux 9',
    vendor: 'alma',
    version: '9',
    arch: 'x86_64',
    format: 'qcow2',
    downloadUrl: 'https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/AlmaLinux-9-GenericCloud-latest.x86_64.qcow2',
    checksumUrl: 'https://repo.almalinux.org/almalinux/9/cloud/x86_64/images/CHECKSUM',
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['rhel', 'cloud-init', 'enterprise'],
    logoIcon: 'ri-centos-fill',
  },
  {
    slug: 'centos-stream-10',
    name: 'CentOS Stream 10',
    vendor: 'centos',
    version: '10-stream',
    arch: 'x86_64',
    format: 'qcow2',
    // CentOS Stream is the upstream rolling preview of RHEL — Stream 10
    // tracks RHEL 10's development cycle. The `-latest.` segment is a
    // server-side symlink to the freshest build.
    downloadUrl: 'https://cloud.centos.org/centos/10-stream/x86_64/images/CentOS-Stream-GenericCloud-10-latest.x86_64.qcow2',
    checksumUrl: 'https://cloud.centos.org/centos/10-stream/x86_64/images/CHECKSUM',
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['rhel', 'cloud-init', 'upstream'],
    logoIcon: 'ri-centos-fill',
  },
  {
    slug: 'centos-stream-9',
    name: 'CentOS Stream 9',
    vendor: 'centos',
    version: '9-stream',
    arch: 'x86_64',
    format: 'qcow2',
    downloadUrl: 'https://cloud.centos.org/centos/9-stream/x86_64/images/CentOS-Stream-GenericCloud-9-latest.x86_64.qcow2',
    checksumUrl: 'https://cloud.centos.org/centos/9-stream/x86_64/images/CHECKSUM',
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['rhel', 'cloud-init', 'upstream'],
    logoIcon: 'ri-centos-fill',
  },
  {
    slug: 'fedora-43',
    name: 'Fedora 43 Cloud',
    vendor: 'fedora',
    version: '43',
    arch: 'x86_64',
    // The minor (build) suffix `-1.1` may need bumping after a respin —
    // Fedora doesn't expose a stable `latest` symlink, unlike Debian /
    // Rocky / Alma. Check the directory listing if download 404s:
    //   https://download.fedoraproject.org/pub/fedora/linux/releases/43/Cloud/x86_64/images/
    format: 'qcow2',
    downloadUrl: 'https://download.fedoraproject.org/pub/fedora/linux/releases/43/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-43-1.1.x86_64.qcow2',
    checksumUrl: null,
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['cloud-init', 'cutting-edge'],
    logoIcon: 'ri-fedora-fill',
  },
  {
    slug: 'opensuse-leap-156',
    name: 'openSUSE Leap 15.6',
    vendor: 'opensuse',
    version: '15.6',
    arch: 'x86_64',
    format: 'qcow2',
    downloadUrl: 'https://download.opensuse.org/distribution/leap/15.6/appliances/openSUSE-Leap-15.6-Minimal-VM.x86_64-Cloud.qcow2',
    checksumUrl: null,
    defaultDiskSize: '20G',
    minMemory: 1024,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['cloud-init', 'enterprise'],
    logoIcon: 'ri-suse-fill',
  },
  {
    slug: 'alpine-321',
    name: 'Alpine Linux 3.21',
    vendor: 'alpine',
    version: '3.21',
    arch: 'x86_64',
    format: 'qcow2',
    // Alpine cloud images live under `/releases/cloud/` — `nocloud_*` is
    // the variant that pulls cloud-init metadata from local NoCloud
    // datasource, which is what Proxmox provides via its CD-ROM drive.
    downloadUrl: 'https://dl-cdn.alpinelinux.org/alpine/v3.21/releases/cloud/nocloud_alpine-3.21.0-x86_64-bios-cloudinit-r0.qcow2',
    checksumUrl: null,
    // Alpine is famously minimal — 256 MB is enough for the OS to boot
    // and run a small workload. Disk default also smaller (5 GB).
    defaultDiskSize: '5G',
    minMemory: 256,
    recommendedMemory: 512,
    minCores: 1,
    recommendedCores: 1,
    ostype: 'l26',
    tags: ['cloud-init', 'minimal', 'edge'],
    logoIcon: 'ri-cloud-line',
  },
  {
    slug: 'arch-rolling',
    name: 'Arch Linux (rolling)',
    vendor: 'arch',
    version: 'rolling',
    arch: 'x86_64',
    format: 'qcow2',
    // Arch publishes monthly-rebuilt cloud images under `/images/latest/`
    // which is a server-side symlink to the most recent monthly snapshot
    // (e.g. `/images/v20250901/...`). The base URL stays valid forever.
    downloadUrl: 'https://geo.mirror.pkgbuild.com/images/latest/Arch-Linux-x86_64-cloudimg.qcow2',
    checksumUrl: 'https://geo.mirror.pkgbuild.com/images/latest/Arch-Linux-x86_64-cloudimg.qcow2.SHA256',
    defaultDiskSize: '10G',
    minMemory: 512,
    recommendedMemory: 2048,
    minCores: 1,
    recommendedCores: 2,
    ostype: 'l26',
    tags: ['cloud-init', 'rolling', 'cutting-edge'],
    logoIcon: 'ri-cloud-line',
  },
]

export function getImageBySlug(slug: string): CloudImage | undefined {
  return CLOUD_IMAGES.find(img => img.slug === slug)
}

export function getImagesByVendor(vendor: string): CloudImage[] {
  return CLOUD_IMAGES.filter(img => img.vendor === vendor)
}

/** Convert a CustomImage DB record into a CloudImage-compatible object */
export function customImageToCloudImage(ci: {
  slug: string
  name: string
  vendor: string
  version: string
  arch: string
  format: string
  sourceType: string
  downloadUrl: string | null
  checksumUrl: string | null
  volumeId: string | null
  defaultDiskSize: string
  minMemory: number
  recommendedMemory: number
  minCores: number
  recommendedCores: number
  ostype: string
  tags: string | null
  isShared?: boolean | null
}): CloudImage & { sourceType: string; volumeId: string | null; isCustom: true; isShared?: boolean } {
  return {
    slug: ci.slug,
    name: ci.name,
    vendor: ci.vendor,
    version: ci.version,
    arch: ci.arch,
    format: ci.format,
    downloadUrl: ci.downloadUrl || '',
    checksumUrl: ci.checksumUrl || null,
    defaultDiskSize: ci.defaultDiskSize,
    minMemory: ci.minMemory,
    recommendedMemory: ci.recommendedMemory,
    minCores: ci.minCores,
    recommendedCores: ci.recommendedCores,
    ostype: ci.ostype,
    tags: ci.tags ? ci.tags.split(';').filter(Boolean) : ['custom'],
    logoIcon: VENDORS.find(v => v.id === ci.vendor)?.icon || 'ri-image-line',
    sourceType: ci.sourceType,
    volumeId: ci.volumeId,
    isCustom: true,
    isShared: !!ci.isShared,
  }
}
