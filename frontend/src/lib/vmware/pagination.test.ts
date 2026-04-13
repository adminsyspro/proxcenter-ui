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
