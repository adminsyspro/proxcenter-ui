'use client'

import React, { useEffect } from 'react'

import { useSearchParams, useRouter } from 'next/navigation'

export default function FullscreenConsolePage({ params }) {
  const router = useRouter()
  const resolvedParams = React.use(params)
  const { type, node, vmid } = resolvedParams || {}
  const searchParams = useSearchParams()
  const connId = searchParams.get('connId') || '1'

  useEffect(() => {
    // Rediriger vers la page noVNC statique avec les paramètres
    if (type && node && vmid && connId) {
      const novncUrl = `/novnc/console.html?connId=${encodeURIComponent(connId)}&type=${encodeURIComponent(type)}&node=${encodeURIComponent(node)}&vmid=${encodeURIComponent(vmid)}`
      window.location.href = novncUrl
    }
  }, [type, node, vmid, connId])

  // Afficher un écran de chargement pendant la redirection
  return (
    <div style={{ 
      width: '100vw', 
      height: '100vh', 
      margin: 0, 
      padding: 0, 
      overflow: 'hidden',
      background: '#000',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: '#666'
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⏳</div>
        <div>Chargement de la console...</div>
      </div>
    </div>
  )
}
