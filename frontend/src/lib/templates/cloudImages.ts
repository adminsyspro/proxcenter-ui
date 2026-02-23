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
] as const

export const CLOUD_IMAGES: CloudImage[] = [
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
    tags: ['stable', 'cloud-init', 'popular'],
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
    tags: ['oldstable', 'cloud-init'],
    logoIcon: 'ri-debian-fill',
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
    slug: 'fedora-41',
    name: 'Fedora 41 Cloud',
    vendor: 'fedora',
    version: '41',
    arch: 'x86_64',
    format: 'qcow2',
    downloadUrl: 'https://download.fedoraproject.org/pub/fedora/linux/releases/41/Cloud/x86_64/images/Fedora-Cloud-Base-Generic-41-1.4.x86_64.qcow2',
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
]

export function getImageBySlug(slug: string): CloudImage | undefined {
  return CLOUD_IMAGES.find(img => img.slug === slug)
}

export function getImagesByVendor(vendor: string): CloudImage[] {
  return CLOUD_IMAGES.filter(img => img.vendor === vendor)
}
