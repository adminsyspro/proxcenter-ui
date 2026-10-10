/**
 * The channel vocabulary shared by the settings card (roadmap#47): the edit
 * form never carries a stored secret, and the row health follows the last
 * delivery.
 */
import { describe, expect, it } from 'vitest'

import { channelHealth, channelSecretKind, channelToInput, newChannelInput, type NotificationChannel } from './channels'

function channel(over: Partial<NotificationChannel> = {}): NotificationChannel {
  return {
    id: 'c1',
    name: 'Ops',
    type: 'webhook',
    enabled: true,
    url_masked: 'https://relay.lan/***',
    has_secret: true,
    has_header_value: true,
    header_name: 'X-Api-Key',
    types: ['alert'],
    min_severity: 'critical',
    allow_private_network: true,
    last_status: '',
    last_error: '',
    sent_count: 0,
    failed_count: 0,
    ...over,
  }
}

describe('newChannelInput', () => {
  it('starts as an enabled Slack channel for every type from warnings up', () => {
    expect(newChannelInput()).toMatchObject({ type: 'slack', enabled: true, url: '', types: [], min_severity: 'warning', allow_private_network: false })
  })
})

describe('channelToInput', () => {
  it('keeps the settings and blanks every secret', () => {
    expect(channelToInput(channel())).toEqual({
      name: 'Ops',
      type: 'webhook',
      enabled: true,
      url: '',
      secret: '',
      header_name: 'X-Api-Key',
      header_value: '',
      types: ['alert'],
      min_severity: 'critical',
      allow_private_network: true,
    })
  })

  it('fills the defaults of a sparse channel', () => {
    const sparse = channel({
      header_name: undefined as any,
      types: undefined as any,
      min_severity: '' as any,
      allow_private_network: undefined as any,
    })

    expect(channelToInput(sparse)).toMatchObject({ header_name: '', types: [], min_severity: 'warning', allow_private_network: false })
  })
})

describe('channelSecretKind', () => {
  it('is a token for ntfy, an HMAC key for a webhook and nothing otherwise', () => {
    expect(channelSecretKind('ntfy')).toBe('token')
    expect(channelSecretKind('webhook')).toBe('hmac')
    expect(channelSecretKind('slack')).toBeNull()
    expect(channelSecretKind('teams')).toBeNull()
    expect(channelSecretKind('discord')).toBeNull()
  })
})

describe('channelHealth', () => {
  it('follows the enabled flag and the last delivery', () => {
    expect(channelHealth(channel({ enabled: false, last_status: 'failed' }))).toBe('disabled')
    expect(channelHealth(channel({ last_status: 'failed' }))).toBe('error')
    expect(channelHealth(channel({ last_status: 'sent' }))).toBe('ok')
    expect(channelHealth(channel({ last_status: '' }))).toBe('idle')
  })
})
