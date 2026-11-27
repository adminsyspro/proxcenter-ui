import { describe, it, expect } from 'vitest'
import { classifyK8sError } from './errors'

describe('classifyK8sError', () => {
  // 1.x ApiException uses .code (number)
  it('401 via .code -> auth_failed', () => { expect(classifyK8sError({ code: 401 })).toBe('auth_failed') })
  it('403 via .code -> forbidden', () => { expect(classifyK8sError({ code: 403 })).toBe('forbidden') })
  it('404 via .code -> not_found', () => { expect(classifyK8sError({ code: 404 })).toBe('not_found') })

  // 0.x fallback: .statusCode
  it('403 via .statusCode -> forbidden', () => { expect(classifyK8sError({ statusCode: 403 })).toBe('forbidden') })
  it('404 via .statusCode -> not_found', () => { expect(classifyK8sError({ statusCode: 404 })).toBe('not_found') })
  it('401 via .statusCode -> auth_failed', () => { expect(classifyK8sError({ statusCode: 401 })).toBe('auth_failed') })

  // nested response status fallback
  it('nested response statusCode', () => { expect(classifyK8sError({ response: { statusCode: 403 } })).toBe('forbidden') })

  // .code takes precedence over .statusCode
  it('.code takes priority over .statusCode', () => { expect(classifyK8sError({ code: 401, statusCode: 403 })).toBe('auth_failed') })

  it('network error -> unreachable', () => { expect(classifyK8sError(new Error('ECONNREFUSED'))).toBe('unreachable') })
})
