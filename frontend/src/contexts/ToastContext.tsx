'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { createPortal } from 'react-dom'

type Severity = 'success' | 'error' | 'warning' | 'info'

interface Toast {
  id: string
  message: string
  severity: Severity
  duration: number
}

interface ToastContextType {
  showToast: (message: string, severity?: Severity, duration?: number) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

const SEVERITY_CONFIG: Record<Severity, { bg: string; icon: string }> = {
  success: { bg: '#2e7d32', icon: 'ri-checkbox-circle-line' },
  error:   { bg: '#c62828', icon: 'ri-error-warning-line' },
  warning: { bg: '#e65100', icon: 'ri-alert-line' },
  info:    { bg: '#1565c0', icon: 'ri-information-line' },
}

function ToastItem({ toast, index, onClose }: { toast: Toast; index: number; onClose: (id: string) => void }) {
  const config = SEVERITY_CONFIG[toast.severity]

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24 + index * 64,
        right: 24,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 16px',
        borderRadius: 8,
        backgroundColor: config.bg,
        color: '#fff',
        fontSize: 14,
        fontFamily: 'Inter, sans-serif',
        fontWeight: 500,
        boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
        minWidth: 280,
        maxWidth: 480,
        animation: 'toast-slide-in 0.25s ease-out',
      }}
    >
      <i className={config.icon} style={{ fontSize: 20, flexShrink: 0 }} />
      <span style={{ flex: 1 }}>{toast.message}</span>
      <button
        onClick={() => onClose(toast.id)}
        style={{
          background: 'none',
          border: 'none',
          color: '#fff',
          cursor: 'pointer',
          padding: 4,
          display: 'flex',
          alignItems: 'center',
          opacity: 0.7,
          flexShrink: 0,
        }}
      >
        <i className="ri-close-line" style={{ fontSize: 18 }} />
      </button>
    </div>
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, severity: Severity = 'info', duration = 4000) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    setToasts(prev => [...prev, { id, message, severity, duration }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
  }, [])

  const handleClose = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const success = useCallback((message: string, duration?: number) => showToast(message, 'success', duration), [showToast])
  const error = useCallback((message: string, duration?: number) => showToast(message, 'error', duration), [showToast])
  const warning = useCallback((message: string, duration?: number) => showToast(message, 'warning', duration), [showToast])
  const info = useCallback((message: string, duration?: number) => showToast(message, 'info', duration), [showToast])

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      {typeof document !== 'undefined' && toasts.length > 0 && createPortal(
        <>
          <style>{`
            @keyframes toast-slide-in {
              from { transform: translateX(100%); opacity: 0; }
              to { transform: translateX(0); opacity: 1; }
            }
          `}</style>
          {toasts.map((toast, index) => (
            <ToastItem key={toast.id} toast={toast} index={index} onClose={handleClose} />
          ))}
        </>,
        document.body
      )}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider')
  }
  return context
}
