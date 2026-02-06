'use client'

import { createContext, useContext, useState, useCallback, ReactNode } from 'react'
import { Snackbar, Alert, AlertColor, Slide, SlideProps } from '@mui/material'

interface Toast {
  id: string
  message: string
  severity: AlertColor
  duration?: number
}

interface ToastContextType {
  showToast: (message: string, severity?: AlertColor, duration?: number) => void
  success: (message: string, duration?: number) => void
  error: (message: string, duration?: number) => void
  warning: (message: string, duration?: number) => void
  info: (message: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

function SlideTransition(props: SlideProps) {
  return <Slide {...props} direction="up" />
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const showToast = useCallback((message: string, severity: AlertColor = 'info', duration = 4000) => {
    const id = Date.now().toString() + Math.random().toString(36).substr(2, 9)
    setToasts(prev => [...prev, { id, message, severity, duration }])
  }, [])

  const handleClose = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const success = useCallback((message: string, duration?: number) => {
    showToast(message, 'success', duration)
  }, [showToast])

  const error = useCallback((message: string, duration?: number) => {
    showToast(message, 'error', duration)
  }, [showToast])

  const warning = useCallback((message: string, duration?: number) => {
    showToast(message, 'warning', duration)
  }, [showToast])

  const info = useCallback((message: string, duration?: number) => {
    showToast(message, 'info', duration)
  }, [showToast])

  return (
    <ToastContext.Provider value={{ showToast, success, error, warning, info }}>
      {children}
      {toasts.map((toast, index) => (
        <Snackbar
          key={toast.id}
          open={true}
          autoHideDuration={toast.duration}
          onClose={() => handleClose(toast.id)}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          TransitionComponent={SlideTransition}
          sx={{ bottom: { xs: 16 + index * 60, sm: 24 + index * 60 } }}
        >
          <Alert
            severity={toast.severity}
            variant="filled"
            onClose={() => handleClose(toast.id)}
            sx={{
              width: '100%',
              boxShadow: 3,
              '& .MuiAlert-icon': { fontSize: 22 }
            }}
          >
            {toast.message}
          </Alert>
        </Snackbar>
      ))}
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
