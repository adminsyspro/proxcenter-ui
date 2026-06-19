import { describe, it, expect, vi, beforeEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'
import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'
import userEvent from '@testing-library/user-event'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import { resourcesFixture } from '@/__tests__/fixtures/resources'
import TagManager from './TagManager'

// TagColorContext is not wrapped by the test harness. Mock it so the component
// can render without a live context provider.
vi.mock('@/contexts/TagColorContext', () => ({
  useTagColors: () => ({
    getColor: () => ({ bg: '#1976d2', fg: '#ffffff' }),
    getOverride: () => undefined,
    getShape: () => 'full',
    loadConnection: () => {},
  }),
}))

const CONN_ID = 'test-conn-1'
const NODE = 'pve1'
const TYPE = 'qemu'
const VMID = '100'
const CONFIG_URL = `*/api/v1/connections/${CONN_ID}/guests/${TYPE}/${NODE}/${VMID}/config`
const RESOURCES_URL = `*/api/v1/connections/${CONN_ID}/resources`

function makeProps(overrides: Partial<Parameters<typeof TagManager>[0]> = {}) {
  return {
    tags: ['prod', 'web'],
    connId: CONN_ID,
    node: NODE,
    type: TYPE,
    vmid: VMID,
    onTagsChange: vi.fn(),
    ...overrides,
  }
}

// Find the Add icon-button in the render container.
// MUI Tooltip uses cloneElement and the resulting button carries
// data-mui-internal-clone-element; querySelector returns the first match,
// which is always the real visible button.
function findAddBtn(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('button[aria-label="Add tag"]')
  if (!btn) throw new Error('Add-tag button not found')
  return btn
}

// After opening the popover, MUI renders it as a portal appended directly to
// document.body (outside the render container). Find it by the MUI Popover
// Paper class so we can scope further queries to just the popover content.
function findPopover(): HTMLElement {
  const paper = document.querySelector<HTMLElement>('.MuiPopover-paper')
  if (!paper) throw new Error('MuiPopover-paper not found in document')
  return paper
}

// ------------------------------------------------------------------ //
// 1. Renders existing tags as chips
// ------------------------------------------------------------------ //
describe('TagManager - renders existing tags', () => {
  it('shows each tag from the tags prop as a visible chip label', () => {
    const { container } = renderWithProviders(<TagManager {...makeProps()} />)
    expect(within(container).getByText('prod')).toBeInTheDocument()
    expect(within(container).getByText('web')).toBeInTheDocument()
  })

  it('renders a chip for every tag in the props array', () => {
    const { container } = renderWithProviders(
      <TagManager {...makeProps({ tags: ['alpha', 'beta', 'gamma'] })} />,
    )
    expect(within(container).getByText('alpha')).toBeInTheDocument()
    expect(within(container).getByText('beta')).toBeInTheDocument()
    expect(within(container).getByText('gamma')).toBeInTheDocument()
  })

  it('renders with an empty tags array without crashing', () => {
    const { container } = renderWithProviders(<TagManager {...makeProps({ tags: [] })} />)
    // The Add icon-button is still present (aria-label from the Tooltip title)
    expect(findAddBtn(container)).not.toBeNull()
  })
})

// ------------------------------------------------------------------ //
// 2. Opens popover and loads suggestions from the resources endpoint
// ------------------------------------------------------------------ //
describe('TagManager - popover opens and loads suggestions', () => {
  beforeEach(() => {
    // Ensure a clean DOM between tests in this describe block.
    cleanup()
    server.use(
      http.get(RESOURCES_URL, () => HttpResponse.json(resourcesFixture)),
    )
  })

  it('shows suggestion chips from the fixture after clicking Add', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<TagManager {...makeProps({ tags: [] })} />)

    await user.click(findAddBtn(container))

    // Wait for the popover to open and the fetch to resolve.
    // The fixture tags (sorted): db, dev, prod, web -- all suggestions since tags=[].
    const popover = await waitFor(() => findPopover())
    await within(popover).findByText('db')
    expect(within(popover).getByText('dev')).toBeInTheDocument()
  })

  it('does not show suggestions already on the VM as chips', async () => {
    const user = userEvent.setup()
    // tags already contains 'prod' and 'web'
    const { container } = renderWithProviders(
      <TagManager {...makeProps({ tags: ['prod', 'web'] })} />,
    )

    await user.click(findAddBtn(container))

    // Wait for the popover then confirm db loads (fetch completed)
    const popover = await waitFor(() => findPopover())
    await within(popover).findByText('db')

    // 'prod' and 'web' are already on the VM so must NOT appear as suggestions
    // inside the popover -- they are absent from the suggestion chip list.
    expect(within(popover).queryByText('prod')).not.toBeInTheDocument()
    expect(within(popover).queryByText('web')).not.toBeInTheDocument()
  })
})

// ------------------------------------------------------------------ //
// 3. Adding a tag via the text input triggers onTagsChange
// ------------------------------------------------------------------ //
describe('TagManager - adding a tag via input calls onTagsChange', () => {
  beforeEach(() => {
    cleanup()
  })

  it('calls onTagsChange with the new tag appended after a successful PUT', async () => {
    const onTagsChange = vi.fn()
    const user = userEvent.setup()

    server.use(
      http.get(RESOURCES_URL, () => HttpResponse.json(resourcesFixture)),
      http.put(CONFIG_URL, () => HttpResponse.json({ data: null })),
    )

    const { container } = renderWithProviders(
      <TagManager {...makeProps({ tags: ['prod'], onTagsChange })} />,
    )

    // Open the popover
    await user.click(findAddBtn(container))

    // Wait for the popover to mount (portal outside container)
    const popover = await waitFor(() => findPopover())

    // Type a new tag in the text field
    const input = within(popover).getByPlaceholderText('New tag...')
    await user.type(input, 'newtag')

    // Click the Add button inside the popover (MUI Button, not the icon-button)
    await user.click(within(popover).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(onTagsChange).toHaveBeenCalledWith(['prod', 'newtag'])
    })
  })

  it('does not call onTagsChange when the PUT returns an error', async () => {
    const onTagsChange = vi.fn()
    const user = userEvent.setup()

    // Stub window.alert so the error path does not throw in jsdom
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => {})

    server.use(
      http.get(RESOURCES_URL, () => HttpResponse.json(resourcesFixture)),
      http.put(CONFIG_URL, () => HttpResponse.json({ error: 'Permission denied' }, { status: 403 })),
    )

    const { container } = renderWithProviders(
      <TagManager {...makeProps({ tags: ['prod'], onTagsChange })} />,
    )

    await user.click(findAddBtn(container))

    const popover = await waitFor(() => findPopover())
    const input = within(popover).getByPlaceholderText('New tag...')
    await user.type(input, 'failingtag')

    await user.click(within(popover).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalled()
    })
    expect(onTagsChange).not.toHaveBeenCalled()

    alertSpy.mockRestore()
  })
})

// ------------------------------------------------------------------ //
// 4. Removing a tag (chip delete) triggers onTagsChange
// ------------------------------------------------------------------ //
describe('TagManager - removing a tag calls onTagsChange', () => {
  beforeEach(() => {
    cleanup()
  })

  it('calls onTagsChange with the tag removed after a successful PUT', async () => {
    const onTagsChange = vi.fn()
    const user = userEvent.setup()

    server.use(
      http.put(CONFIG_URL, () => HttpResponse.json({ data: null })),
    )

    const { container } = renderWithProviders(
      <TagManager {...makeProps({ tags: ['prod', 'web'], onTagsChange })} />,
    )

    // Find the 'prod' chip then click its MUI delete icon.
    const prodChip = within(container).getByText('prod').closest('.MuiChip-root') as HTMLElement
    const deleteBtn = prodChip.querySelector('.MuiChip-deleteIcon') as HTMLElement
    expect(deleteBtn).not.toBeNull()

    await user.click(deleteBtn)

    await waitFor(() => {
      expect(onTagsChange).toHaveBeenCalledWith(['web'])
    })
  })

  it('sends delete=tags body when the last tag is removed', async () => {
    const onTagsChange = vi.fn()
    const user = userEvent.setup()

    let capturedBody: any = null
    server.use(
      http.put(CONFIG_URL, async ({ request }) => {
        capturedBody = await request.json()
        return HttpResponse.json({ data: null })
      }),
    )

    const { container } = renderWithProviders(
      <TagManager {...makeProps({ tags: ['only-tag'], onTagsChange })} />,
    )

    const chip = within(container).getByText('only-tag').closest('.MuiChip-root') as HTMLElement
    const deleteBtn = chip.querySelector('.MuiChip-deleteIcon') as HTMLElement
    await user.click(deleteBtn)

    await waitFor(() => {
      expect(onTagsChange).toHaveBeenCalledWith([])
    })
    // Proxmox requires `delete: 'tags'` when removing the last tag (empty string ignored)
    expect(capturedBody).toEqual({ delete: 'tags' })
  })
})
