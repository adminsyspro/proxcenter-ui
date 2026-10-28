import { describe, expect, it } from 'vitest'

import nextConfig from '../../../next.config.mjs'

import { MAX_REQUEST_BODY_BYTES, declaresBodyOver } from './requestBodyLimit'

const headers = (length?: string) => new Headers(length === undefined ? {} : { 'content-length': length })

describe('declaresBodyOver', () => {
  it('flags a declared length past the limit only', () => {
    expect(declaresBodyOver(headers(String(MAX_REQUEST_BODY_BYTES + 1)))).toBe(true)
    expect(declaresBodyOver(headers(String(MAX_REQUEST_BODY_BYTES)))).toBe(false)
    expect(declaresBodyOver(headers('1024'))).toBe(false)
  })

  it('lets a body with no usable length through', () => {
    expect(declaresBodyOver(headers())).toBe(false)
    expect(declaresBodyOver(headers('abc'))).toBe(false)
    expect(declaresBodyOver(new Map<string, string>())).toBe(false)
  })
})

describe('MAX_REQUEST_BODY_BYTES', () => {
  it('is the size next.config buffers before the proxy', () => {
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(MAX_REQUEST_BODY_BYTES)
  })
})
