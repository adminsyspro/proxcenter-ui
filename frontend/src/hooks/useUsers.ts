import { useSWRFetch } from './useSWRFetch'

export function useUsers() {
  return useSWRFetch('/api/v1/users', { revalidateOnFocus: true })
}

export function useRbacRoles(enabled: boolean) {
  return useSWRFetch(enabled ? '/api/v1/rbac/roles' : null, { revalidateOnFocus: true })
}

export function useRbacAssignments() {
  return useSWRFetch('/api/v1/rbac/assignments', { revalidateOnFocus: true })
}
