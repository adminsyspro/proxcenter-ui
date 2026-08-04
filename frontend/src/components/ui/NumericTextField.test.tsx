import { useState } from 'react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, userEvent } from '@/__tests__/setup/renderWithProviders'
import NumericTextField from './NumericTextField'

type HarnessProps = Omit<React.ComponentProps<typeof NumericTextField>, 'value' | 'onChange'> & {
  initial: number
  onValue?: (v: number) => void
}

// The component is controlled, so every test drives it through a real parent.
function Harness({ initial, onValue, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial)

  return (
    <>
      <NumericTextField
        {...rest}
        value={value}
        onChange={v => {
          setValue(v)
          onValue?.(v)
        }}
      />
      <span data-testid="committed">{String(value)}</span>
      <button type="button">elsewhere</button>
    </>
  )
}

const field = () => screen.getByLabelText('Size') as HTMLInputElement
const committed = () => screen.getByTestId('committed').textContent

describe('NumericTextField', () => {
  // This suite renders repeatedly; RTL is not auto-cleaned up in this repo.
  afterEach(cleanup)

  it('shows the value it is given', () => {
    renderWithProviders(<Harness initial={8} fallback={1} label="Size" />)
    expect(field().value).toBe('8')
  })

  it('can be cleared, and does not snap back to the fallback while typing', async () => {
    renderWithProviders(<Harness initial={8} fallback={1} label="Size" />)
    await userEvent.clear(field())
    expect(field().value).toBe('')
    // The parent keeps the last good number; only the display is empty.
    expect(committed()).toBe('8')
  })

  it('replaces the value instead of gluing the old digit in front (discussion #634)', async () => {
    const onValue = vi.fn()

    renderWithProviders(<Harness initial={1} fallback={1} label="Size" onValue={onValue} />)
    await userEvent.clear(field())
    await userEvent.type(field(), '20')
    expect(field().value).toBe('20')
    expect(committed()).toBe('20')
    expect(onValue).not.toHaveBeenCalledWith(1)
  })

  it('commits the fallback when the field is left empty', async () => {
    renderWithProviders(<Harness initial={8} fallback={1} label="Size" />)
    await userEvent.clear(field())
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(field().value).toBe('1')
    expect(committed()).toBe('1')
  })

  it('clamps to min and max on blur', async () => {
    const { unmount } = renderWithProviders(<Harness initial={8} fallback={1} label="Size" min={2} max={64} />)

    await userEvent.clear(field())
    await userEvent.type(field(), '999')
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(committed()).toBe('64')
    unmount()

    renderWithProviders(<Harness initial={8} fallback={4} label="Size" min={2} max={64} />)
    await userEvent.clear(field())
    await userEvent.type(field(), '1')
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(committed()).toBe('2')
  })

  it('lets a decimal be typed through its half-written states', async () => {
    renderWithProviders(
      <Harness initial={0} fallback={0} label="Size" parse={Number.parseFloat} />,
    )
    await userEvent.clear(field())
    await userEvent.type(field(), '0.')
    expect(field().value).toBe('0.')
    await userEvent.type(field(), '5')
    expect(field().value).toBe('0.5')
    expect(committed()).toBe('0.5')
  })

  it('accepts a negative number through its leading minus sign', async () => {
    renderWithProviders(<Harness initial={0} fallback={0} label="Size" />)
    await userEvent.clear(field())
    await userEvent.type(field(), '-')
    expect(field().value).toBe('-')
    expect(committed()).toBe('0')
    await userEvent.type(field(), '5')
    expect(committed()).toBe('-5')
  })

  it('follows the value when the parent changes it behind the input', async () => {
    function PresetHarness() {
      const [value, setValue] = useState(512)

      return (
        <>
          <NumericTextField value={value} onChange={setValue} fallback={128} label="Size" />
          <button type="button" onClick={() => setValue(2048)}>preset</button>
        </>
      )
    }

    renderWithProviders(<PresetHarness />)
    await userEvent.clear(field())
    await userEvent.click(screen.getByRole('button', { name: 'preset' }))
    expect(field().value).toBe('2048')
  })

  it('uses format for display, so a sentinel value can render blank', async () => {
    renderWithProviders(
      <Harness initial={0} fallback={0} label="Size" format={n => (n === 0 ? '' : String(n))} />,
    )
    expect(field().value).toBe('')
    await userEvent.type(field(), '4')
    expect(committed()).toBe('4')
  })

  it('does not commit a lossy format back into state on a bare focus and blur', async () => {
    const onValue = vi.fn()

    // State in MiB, field shown in whole GiB: 3000 MiB has no exact GiB display.
    renderWithProviders(
      <Harness
        initial={3000}
        fallback={1024}
        label="Size"
        onValue={onValue}
        format={n => String(Math.round(n / 1024))}
        parse={s => Number.parseFloat(s) * 1024}
      />,
    )
    expect(field().value).toBe('3')
    await userEvent.click(field())
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(onValue).not.toHaveBeenCalled()
    expect(committed()).toBe('3000')

    // Editing it still commits through the lossy conversion, as it must.
    await userEvent.clear(field())
    await userEvent.type(field(), '4')
    expect(committed()).toBe('4096')
  })

  it('does not fire onChange on blur when the value is unchanged', async () => {
    const onValue = vi.fn()

    renderWithProviders(<Harness initial={8} fallback={1} label="Size" onValue={onValue} />)
    await userEvent.click(field())
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(onValue).not.toHaveBeenCalled()
  })

  it('still forwards a caller-supplied onBlur', async () => {
    const onBlur = vi.fn()

    renderWithProviders(<Harness initial={8} fallback={1} label="Size" onBlur={onBlur} />)
    await userEvent.click(field())
    await userEvent.click(screen.getByRole('button', { name: 'elsewhere' }))
    expect(onBlur).toHaveBeenCalledOnce()
  })
})
