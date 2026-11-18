import type { Dispatch, KeyboardEvent, SetStateAction } from 'react'

import type { BrandingConfig } from '@/contexts/BrandingContext'

type Setter<T> = Dispatch<SetStateAction<T>>

export interface LoginCredentialsFormProps {
  authMethod: string
  email: string
  setEmail: Setter<string>
  username: string
  setUsername: Setter<string>
  password: string
  setPassword: Setter<string>
  isPasswordShown: boolean
  setIsPasswordShown: Setter<boolean>
  rememberMe: boolean
  setRememberMe: Setter<boolean>
  capsLock: boolean
  onPasswordKey: (event: KeyboardEvent) => void
  loading: boolean
  onSubmit: () => void
}

export interface LoginFormPanelProps extends LoginCredentialsFormProps {
  branding: BrandingConfig
  ldapEnabled: boolean
  oidcEnabled: boolean
  oidcProviderName: string
  showLocalForm?: boolean
  setAuthMethod: Setter<string>
  error: string
  onSso: () => void
  mounted: boolean
}

export interface LoginShellProps extends LoginFormPanelProps {
  brandingLoading: boolean
}
