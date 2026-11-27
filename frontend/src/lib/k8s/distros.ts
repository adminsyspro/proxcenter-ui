// Distribution → logo asset. kubeadm, generic, imported clusters and any
// unknown/unset distro fall back to the vanilla Kubernetes mark. Paths mirror
// the deploy wizard's DistroCard logos so the cluster list and the wizard stay
// visually consistent.
export function distroLogo(distro?: string | null): string {
  switch (distro) {
    case 'talos':
      return '/images/talos-logo.webp'
    case 'k3s':
      return '/images/k3s-logo.png'
    case 'rke2':
      return '/images/rke2-logo.svg'
    default:
      return '/images/kubernetes-logo.svg'
  }
}
