// frontend/src/lib/vmware/pagination.test.ts
import { describe, it, expect, vi } from 'vitest'
import { retrieveAllPropertiesEx } from './pagination'

const PC = 'propertyCollector'

function singlePageResponse(objectsXml: string): string {
  return `<?xml version="1.0"?>
<soap:Envelope><soap:Body>
  <RetrievePropertiesExResponse><returnval>
    ${objectsXml}
  </returnval></RetrievePropertiesExResponse>
</soap:Body></soap:Envelope>`
}

describe('retrieveAllPropertiesEx', () => {
  it('returns a single response when no continuation token is present', async () => {
    const xml = singlePageResponse('<objects><obj type="VirtualMachine">vm-1</obj></objects>')
    const soapReq = vi.fn().mockResolvedValueOnce({ text: xml })

    const result = await retrieveAllPropertiesEx(soapReq, '<initial-body/>', PC)

    expect(soapReq).toHaveBeenCalledTimes(1)
    expect(soapReq).toHaveBeenCalledWith('<initial-body/>')
    expect(result).toContain('<obj type="VirtualMachine">vm-1</obj>')
  })
})

function pageWithToken(objectsXml: string, token: string): string {
  return `<?xml version="1.0"?>
<soap:Envelope><soap:Body>
  <RetrievePropertiesExResponse><returnval>
    <token>${token}</token>
    ${objectsXml}
  </returnval></RetrievePropertiesExResponse>
</soap:Body></soap:Envelope>`
}

describe('retrieveAllPropertiesEx — continuation', () => {
  it('follows the token through one continuation and concatenates results', async () => {
    const page1 = pageWithToken(
      '<objects><obj type="VirtualMachine">vm-1</obj></objects>',
      'TOKEN-A',
    )
    const page2 = singlePageResponse(
      '<objects><obj type="VirtualMachine">vm-2</obj></objects>',
    )

    const soapReq = vi
      .fn()
      .mockResolvedValueOnce({ text: page1 })
      .mockResolvedValueOnce({ text: page2 })

    const result = await retrieveAllPropertiesEx(soapReq, '<initial/>', PC)

    expect(soapReq).toHaveBeenCalledTimes(2)
    // First call uses the original body
    expect(soapReq.mock.calls[0][0]).toBe('<initial/>')
    // Second call is a ContinueRetrievePropertiesEx with the token
    expect(soapReq.mock.calls[1][0]).toContain('ContinueRetrievePropertiesEx')
    expect(soapReq.mock.calls[1][0]).toContain('<urn:token>TOKEN-A</urn:token>')
    expect(soapReq.mock.calls[1][0]).toContain(`<urn:_this type="PropertyCollector">${PC}</urn:_this>`)
    // Both VMs are present in the concatenated text
    expect(result).toContain('vm-1')
    expect(result).toContain('vm-2')
  })
})

describe('retrieveAllPropertiesEx — edge cases', () => {
  it('follows the token across three pages', async () => {
    const soapReq = vi
      .fn()
      .mockResolvedValueOnce({ text: pageWithToken('<objects>a</objects>', 'T1') })
      .mockResolvedValueOnce({ text: pageWithToken('<objects>b</objects>', 'T2') })
      .mockResolvedValueOnce({ text: singlePageResponse('<objects>c</objects>') })

    const result = await retrieveAllPropertiesEx(soapReq, '<initial/>', PC)

    expect(soapReq).toHaveBeenCalledTimes(3)
    expect(soapReq.mock.calls[1][0]).toContain('<urn:token>T1</urn:token>')
    expect(soapReq.mock.calls[2][0]).toContain('<urn:token>T2</urn:token>')
    expect(result).toContain('a')
    expect(result).toContain('b')
    expect(result).toContain('c')
  })

  it('returns the single response when there are no objects and no token', async () => {
    const empty = `<?xml version="1.0"?>
<soap:Envelope><soap:Body>
  <RetrievePropertiesExResponse><returnval/></RetrievePropertiesExResponse>
</soap:Body></soap:Envelope>`
    const soapReq = vi.fn().mockResolvedValueOnce({ text: empty })

    const result = await retrieveAllPropertiesEx(soapReq, '<initial/>', PC)

    expect(soapReq).toHaveBeenCalledTimes(1)
    expect(result).toContain('returnval')
  })

  it('stops at maxIterations and warns when vCenter still has more pages', async () => {
    const soapReq = vi.fn().mockResolvedValue({
      text: pageWithToken('<objects>x</objects>', 'INFINITE'),
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await retrieveAllPropertiesEx(soapReq, '<initial/>', PC, 3)

    // 1 initial call + 3 continuations = 4 total
    expect(soapReq).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('hit max iterations (3)'),
    )
    warn.mockRestore()
  })

  it('does not extract a <token> element that appears inside an object property value', async () => {
    // Hostile input: a property value contains a literal <token>...</token>
    // that must not be mistaken for a continuation token.
    const xml = `<?xml version="1.0"?>
<soap:Envelope><soap:Body>
  <RetrievePropertiesExResponse><returnval>
    <objects>
      <obj type="VirtualMachine">vm-1</obj>
      <propSet><name>config.annotation</name><val>&lt;token&gt;FAKE&lt;/token&gt;</val></propSet>
    </objects>
  </returnval></RetrievePropertiesExResponse>
</soap:Body></soap:Envelope>`
    const soapReq = vi.fn().mockResolvedValueOnce({ text: xml })

    await retrieveAllPropertiesEx(soapReq, '<initial/>', PC)

    expect(soapReq).toHaveBeenCalledTimes(1)
  })
})
