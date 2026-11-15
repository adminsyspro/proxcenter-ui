/**
 * Policy sub-tab: the zone and flow dialogs and the deletions.
 */

import { describe, expect, it } from 'vitest'
import { within } from '@testing-library/react'

import { screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import type { MicrosegFlow } from '@/lib/microseg/types'

import { calls, flow, mock, reply } from './microsegTestKit'
import { body, db, setup, installFreshMocks, web } from './policyTestKit'

installFreshMocks()


describe('zone dialog', () => {
  const open = async () => {
    setup({ zones: [db()] })
    fireEvent.click((await screen.findAllByRole('button', { name: 'New zone' }))[0])
    return screen.findByRole('dialog')
  }
  const typeName = (dialog: HTMLElement, value: string) => fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value } })

  it('refuses an invalid name on the spot and sends nothing', async () => {
    const dialog = await open()
    typeName(dialog, 'Web_1')
    expect(await within(dialog).findByText(/lowercase letter/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls('POST /zones')).toHaveLength(0)
  })

  it('creates a zone with the draft version and the guest enforcement, then reloads the policy', async () => {
    mock.routes['POST /zones'] = () => reply(200, { version: 4, zone: web() })
    const dialog = await open()
    const before = calls('GET /policy').length
    typeName(dialog, 'web')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Front tier' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(calls('POST /zones')).toHaveLength(1))
    expect(body(calls('POST /zones')[0][1] as RequestInit)).toMatchObject({
      version: 3, name: 'web', label: 'Front tier', enforcement: 'guest', isolate_members: false,
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(calls('GET /policy').length).toBeGreaterThan(before)
  })

  it('keeps the dialog input after a 409 and reloads the policy', async () => {
    mock.routes['POST /zones'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const dialog = await open()
    typeName(dialog, 'web')
    const before = calls('GET /policy').length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    expect(await within(dialog).findByText(/changed elsewhere and was reloaded/)).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('web')
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('shows the name-taken message in the dialog', async () => {
    mock.routes['POST /zones'] = () => reply(409, { code: 'ZONE_NAME_TAKEN', error: 'dup' })
    const dialog = await open()
    typeName(dialog, 'db')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText('A zone with this name already exists.')).toBeTruthy()
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('db')
  })

  it('limits the name input to 14 characters', async () => {
    const dialog = await open()
    expect(within(dialog).getByLabelText('Name').getAttribute('maxlength')).toBe('14')
  })

  it('keeps an empty color empty when a zone is edited', async () => {
    mock.routes['PUT /zones/zd'] = () => reply(200, { version: 4, zone: db() })
    setup({ zones: [db({ color: '', label: 'Data' })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit zone' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Databases' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /zones/zd')).toHaveLength(1))
    expect(body(calls('PUT /zones/zd')[0][1] as RequestInit).color).toBe('')
  })

  it('edits a zone through PUT and does not offer to rename the state', async () => {
    mock.routes['PUT /zones/zd'] = () => reply(200, { version: 4, zone: db() })
    setup({ zones: [db({ state: 'observe', label: 'Data' })] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit zone' }))
    const dialog = await screen.findByRole('dialog')
    expect((within(dialog).getByLabelText('Label') as HTMLInputElement).value).toBe('Data')
    fireEvent.change(within(dialog).getByLabelText('Label'), { target: { value: 'Databases' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /zones/zd')).toHaveLength(1))
    const sent = body(calls('PUT /zones/zd')[0][1] as RequestInit)
    expect(sent).toMatchObject({ version: 3, name: 'db', label: 'Databases', enforcement: 'guest' })
    expect(sent).not.toHaveProperty('state')
  })
})

describe('zone deletion', () => {
  it('asks for a confirmation and sends the draft version', async () => {
    mock.routes['DELETE /zones/zd'] = () => reply(200, { version: 4 })
    setup({ zones: [db()] })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete zone' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete zone db?')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE /zones/zd')).toHaveLength(1))
    expect(body(calls('DELETE /zones/zd')[0][1] as RequestInit)).toEqual({ version: 3 })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows the in-use message in the dialog when a flow still uses the zone', async () => {
    mock.routes['DELETE /zones/zd'] = () => reply(409, { code: 'IN_USE', error: 'flows' })
    setup({ zones: [db()] })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete zone' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await within(dialog).findByText('This zone is still used by a flow. Remove the flow first.')).toBeTruthy()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })
})

describe('flow dialog', () => {
  const open = async () => {
    setup({ zones: [web(), db()] })
    fireEvent.click(await screen.findByRole('button', { name: 'New flow' }))
    return screen.findByRole('dialog')
  }
  const pickZone = async (dialog: HTMLElement, label: string, name: string) => {
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: label }))
    fireEvent.click(await screen.findByRole('option', { name }))
  }
  const useCidr = (dialog: HTMLElement, group: string, value: string, field: string) => {
    fireEvent.click(within(within(dialog).getByRole('group', { name: group })).getByRole('button', { name: 'CIDR' }))
    fireEvent.change(within(dialog).getByLabelText(field), { target: { value } })
  }

  it('refuses a flow with two CIDR sides', async () => {
    const dialog = await open()
    useCidr(dialog, 'Source type', '10.0.0.0/8', 'Source CIDR')
    useCidr(dialog, 'Destination type', '192.168.0.0/16', 'Destination CIDR')
    expect(await within(dialog).findByText('A flow cannot have a CIDR on both sides.')).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)
    expect(calls('POST /flows')).toHaveLength(0)
  })

  it('refuses a CIDR with host bits set and proposes the masked form', async () => {
    const dialog = await open()
    await pickZone(dialog, 'Source zone', 'web')
    useCidr(dialog, 'Destination type', '10.0.0.5/24', 'Destination CIDR')
    expect(await within(dialog).findByText(/host bits are set, use 10\.0\.0\.0\/24/)).toBeTruthy()
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.click(within(dialog).getByRole('button', { name: 'Use 10.0.0.0/24' }))
    expect((within(dialog).getByLabelText('Destination CIDR') as HTMLInputElement).value).toBe('10.0.0.0/24')
    expect((within(dialog).getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('refuses a port with icmp', async () => {
    const dialog = await open()
    await pickZone(dialog, 'Source zone', 'web')
    await pickZone(dialog, 'Destination zone', 'db')
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Protocol' }))
    fireEvent.click(await screen.findByRole('option', { name: 'icmp' }))
    fireEvent.change(within(dialog).getByLabelText('Port(s)'), { target: { value: '80' } })
    expect(await within(dialog).findByText(/not allowed with this protocol/)).toBeTruthy()
  })

  it('creates a flow between two zones with the draft version', async () => {
    mock.routes['POST /flows'] = () => reply(200, { version: 4, flow: flow('new') })
    const dialog = await open()
    await pickZone(dialog, 'Source zone', 'web')
    await pickZone(dialog, 'Destination zone', 'db')
    fireEvent.change(within(dialog).getByLabelText('Port(s)'), { target: { value: '5432' } })
    fireEvent.change(within(dialog).getByLabelText('Comment'), { target: { value: 'app to database' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))

    await waitFor(() => expect(calls('POST /flows')).toHaveLength(1))
    expect(body(calls('POST /flows')[0][1] as RequestInit)).toEqual({
      version: 3, src_zone_id: 'zw', src_cidr: '', dst_zone_id: 'zd', dst_cidr: '', proto: 'tcp', dport: '5432', comment: 'app to database', origin: 'manual',
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('keeps the input after a 409 on a flow and reloads the policy', async () => {
    mock.routes['POST /flows'] = () => reply(409, { code: 'VERSION_CONFLICT', error: 'stale' })
    const dialog = await open()
    await pickZone(dialog, 'Source zone', 'web')
    await pickZone(dialog, 'Destination zone', 'db')
    fireEvent.change(within(dialog).getByLabelText('Port(s)'), { target: { value: '5432' } })
    const before = calls('GET /policy').length
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    expect(await within(dialog).findByText(/changed elsewhere and was reloaded/)).toBeTruthy()
    expect((within(dialog).getByLabelText('Port(s)') as HTMLInputElement).value).toBe('5432')
    await waitFor(() => expect(calls('GET /policy').length).toBeGreaterThan(before))
  })

  it('edits a flow through PUT, keeping its origin', async () => {
    const learned: MicrosegFlow = { ...flow('fl'), src_zone_id: 'zw', dst_zone_id: 'zd', origin: 'learned', dport: '443' }
    mock.routes['PUT /flows/fl'] = () => reply(200, { version: 4, flow: learned })
    setup({ zones: [web(), db()], flows: [learned] })
    fireEvent.click(await screen.findByRole('button', { name: 'Edit flow' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Port(s)'), { target: { value: '8443' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PUT /flows/fl')).toHaveLength(1))
    expect(body(calls('PUT /flows/fl')[0][1] as RequestInit)).toMatchObject({ version: 3, dport: '8443', origin: 'learned' })
  })

  it('deletes a flow after a confirmation', async () => {
    mock.routes['DELETE /flows/fl'] = () => reply(200, { version: 4 })
    setup({ zones: [web(), db()], flows: [{ ...flow('fl'), src_zone_id: 'zw', dst_zone_id: 'zd' }] })
    fireEvent.click(await screen.findByRole('button', { name: 'Delete flow' }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE /flows/fl')).toHaveLength(1))
    expect(body(calls('DELETE /flows/fl')[0][1] as RequestInit)).toEqual({ version: 3 })
  })
})

