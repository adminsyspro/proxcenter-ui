'use client'

import { useEffect, useMemo } from 'react'

const translations = {
  en: { title: 'Critical error', description: 'A critical error occurred. The application encountered an unexpected problem.', retry: 'Retry', home: 'Home' },
  fr: { title: 'Erreur critique', description: "Une erreur critique s'est produite. L'application a rencontré un problème inattendu.", retry: 'Réessayer', home: 'Accueil' },
}

function getLocale() {
  if (typeof document === 'undefined') return 'fr'
  const match = document.cookie.match(/NEXT_LOCALE=(\w+)/)
  return match?.[1] === 'en' ? 'en' : 'fr'
}

// Logo SVG ProxCenter (inline car on ne peut pas utiliser les composants normaux ici)
const LogoIcon = ({ size = 60 }) => {
  const height = (size * 170) / 220

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 220 170"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M 174.30 158.91 C160.99,140.34 155.81,133.18 151.52,127.42 C149.04,124.08 147.00,120.78 147.00,120.10 C147.00,119.42 148.91,116.47 151.25,113.55 C153.59,110.63 157.44,105.71 159.81,102.62 C162.18,99.53 164.71,97.00 165.44,97.00 C166.58,97.00 182.93,119.09 200.79,144.77 C203.71,148.95 208.32,155.38 211.04,159.06 C213.77,162.74 216.00,166.03 216.00,166.37 C216.00,166.72 207.92,167.00 198.05,167.00 L 180.10 167.00 Z M 164.11 69.62 C161.87,67.24 159.22,63.61 151.44,52.29 L 147.85 47.07 L 153.79 39.29 C157.05,35.00 161.25,29.62 163.11,27.32 C164.98,25.02 169.65,19.08 173.50,14.11 L 180.50 5.08 L 199.25 5.04 C209.56,5.02 218.00,5.23 218.00,5.51 C218.00,5.79 214.51,10.42 210.25,15.81 C205.99,21.19 199.80,29.11 196.50,33.41 C193.20,37.71 189.15,42.92 187.50,44.98 C183.18,50.39 169.32,68.18 167.76,70.30 C166.52,72.01 166.33,71.98 164.11,69.62 Z"
        fill="#F29221"
      />
      <path
        d="M 0.03 164.75 C0.05,162.18 2.00,159.04 9.28,149.83 C19.92,136.37 45.56,103.43 54.84,91.32 L 61.17 83.05 L 58.87 79.77 C49.32,66.18 11.10,12.77 8.83,9.86 C7.28,7.85 6.00,5.94 6.00,5.61 C6.00,5.27 14.21,5.01 24.25,5.03 L 42.50 5.06 L 53.50 20.63 C59.55,29.20 65.44,37.40 66.58,38.85 C72.16,45.97 97.33,81.69 97.70,83.02 C98.13,84.59 95.40,88.27 63.50,129.06 C53.05,142.42 42.77,155.64 40.66,158.43 C32.84,168.76 34.77,168.00 16.33,168.00 L 0.00 168.00 L 0.03 164.75 Z M 55.56 167.09 C55.25,166.59 56.95,163.78 59.33,160.84 C61.71,157.90 66.10,152.33 69.08,148.46 C72.06,144.59 81.47,132.50 90.00,121.60 C98.53,110.69 106.38,100.58 107.46,99.13 C108.54,97.69 111.81,93.49 114.72,89.80 L 120.00 83.10 L 115.25 76.47 C112.64,72.82 109.82,68.83 109.00,67.61 C108.18,66.38 105.73,62.93 103.57,59.94 C101.41,56.95 96.88,50.67 93.51,46.00 C77.15,23.36 65.00,6.12 65.00,5.57 C65.00,5.23 73.21,5.08 83.24,5.23 L 101.49 5.50 L 124.77 38.00 C137.58,55.88 150.09,73.37 152.58,76.88 C155.08,80.39 156.91,83.79 156.66,84.44 C156.41,85.09 153.55,88.97 150.30,93.06 C147.06,97.15 137.93,108.82 130.02,119.00 C122.12,129.18 110.29,144.36 103.75,152.75 L 91.85 168.00 L 73.98 168.00 C64.16,168.00 55.87,167.59 55.56,167.09 Z"
        fill="#FCFCFC"
      />
    </svg>
  )
}

export default function GlobalError({ error, reset }) {
  const locale = useMemo(() => getLocale(), [])
  const t = translations[locale]

  useEffect(() => {
    console.error('Global error:', error)
  }, [error])

  return (
    <html lang={locale}>
      <body>
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#1a1a2e',
            padding: '24px',
            textAlign: 'center',
            fontFamily: 'system-ui, -apple-system, sans-serif',
          }}
        >
          {/* Logo */}
          <div style={{ marginBottom: '32px' }}>
            <LogoIcon size={80} />
          </div>

          {/* Code d'erreur */}
          <h1
            style={{
              fontSize: '8rem',
              fontWeight: 800,
              lineHeight: 1,
              color: '#F29221',
              margin: '0 0 16px 0',
            }}
          >
            500
          </h1>

          {/* Icône */}
          <div
            style={{
              width: '80px',
              height: '80px',
              borderRadius: '50%',
              backgroundColor: 'rgba(242, 146, 33, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: '24px',
            }}
          >
            <span style={{ fontSize: '40px' }}>⚠️</span>
          </div>

          {/* Titre */}
          <h2
            style={{
              fontSize: '1.5rem',
              fontWeight: 700,
              marginBottom: '12px',
              color: '#ffffff',
            }}
          >
            {t.title}
          </h2>

          {/* Description */}
          <p
            style={{
              color: 'rgba(255, 255, 255, 0.7)',
              maxWidth: '480px',
              marginBottom: '32px',
              lineHeight: 1.6,
            }}
          >
            {t.description}
          </p>

          {/* Boutons */}
          <div style={{ display: 'flex', gap: '16px' }}>
            <button
              onClick={() => reset()}
              style={{
                padding: '12px 32px',
                fontSize: '1rem',
                fontWeight: 600,
                color: '#ffffff',
                backgroundColor: '#F29221',
                border: 'none',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              {t.retry}
            </button>
            <button
              onClick={() => (window.location.href = '/home')}
              style={{
                padding: '12px 32px',
                fontSize: '1rem',
                fontWeight: 600,
                color: '#F29221',
                backgroundColor: 'transparent',
                border: '2px solid #F29221',
                borderRadius: '8px',
                cursor: 'pointer',
              }}
            >
              {t.home}
            </button>
          </div>

          {/* Footer */}
          <p
            style={{
              position: 'absolute',
              bottom: '24px',
              color: 'rgba(255, 255, 255, 0.4)',
              fontSize: '0.75rem',
            }}
          >
            ProxCenter — Proxmox Management Platform
          </p>
        </div>
      </body>
    </html>
  )
}
