'use client'

import { useCallback, useEffect, useState } from 'react'

interface ToggleFavoriteVm {
  id: string
  connId: string
  node: string
  type: string
  vmid: string | number
  name?: string
}

interface UseFavoritesParams {
  propFavorites?: Set<string>
  propToggleFavorite?: (vm: { connId: string; node: string; type: string; vmid: string | number; name?: string }) => void
}

export function useFavorites({ propFavorites, propToggleFavorite }: UseFavoritesParams) {
  // Favoris : utiliser les props si fournies, sinon état local
  const [localFavorites, setLocalFavorites] = useState<Set<string>>(new Set())
  const favorites = propFavorites ?? localFavorites

  // Charger les favoris (mode local seulement)
  const loadFavorites = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/favorites', { cache: 'no-store' })

      if (res.ok) {
        const json = await res.json()
        const favSet = new Set<string>((json.data || []).map((f: any) => f.vm_key))

        setLocalFavorites(favSet)
      }
    } catch (e) {
      console.error('Error loading favorites:', e)
    }
  }, [])

  // Toggle favori - wrapper pour VmsTable (qui passe un objet vm)
  const toggleFavorite = useCallback((vm: ToggleFavoriteVm) => {
    const vmidStr = String(vm.vmid)


    // Si la prop onToggleFavorite est fournie, l'utiliser
    if (propToggleFavorite) {
      propToggleFavorite({ connId: vm.connId, node: vm.node, type: vm.type, vmid: vm.vmid, name: vm.name })

return
    }

    // Sinon, gérer localement (fallback)
    const vmKey = `${vm.connId}:${vm.node}:${vm.type}:${vmidStr}`
    const isFav = favorites.has(vmKey)

    const doToggle = async () => {
      try {
        if (isFav) {
          const res = await fetch(`/api/v1/favorites?vmKey=${encodeURIComponent(vmKey)}`, { method: 'DELETE' })

          if (res.ok) {
            setLocalFavorites(prev => {
              const next = new Set(prev)

              next.delete(vmKey)

return next
            })
          }
        } else {
          const res = await fetch('/api/v1/favorites', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId: vm.connId,
              node: vm.node,
              vmType: vm.type,
              vmid: vmidStr,
              vmName: vm.name
            })
          })

          if (res.ok) {
            setLocalFavorites(prev => new Set(prev).add(vmKey))
          }
        }
      } catch (e) {
        console.error('Error toggling favorite:', e)
      }
    }

    void doToggle()
  }, [favorites, propToggleFavorite])

  // Charger les favoris au mount (seulement si pas de prop favorites)
  useEffect(() => {
    if (!propFavorites) {
      void loadFavorites()
    }
  }, [propFavorites, loadFavorites])

  return { favorites, toggleFavorite }
}
