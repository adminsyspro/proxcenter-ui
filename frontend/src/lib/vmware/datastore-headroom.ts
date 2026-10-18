// Free space of the datastores a VM's disks live on (roadmap#53).
//
// A warm migration keeps a VMware snapshot open on the source for the whole
// copy, and the snapshot delta grows with everything the guest writes in the
// meantime. Several warm jobs started together on VMs of the same datastore
// each hold their own delta, so a datastore already near full is the first
// thing that breaks when a batch runs in parallel: the guest, not the
// migration, is what stalls when the delta cannot grow. The engine reads the
// headroom at planning time and warns when it is thin.

import type { SoapSession } from "./soap"
import { soapRequest, extractProp } from "./soap"

export interface DatastoreHeadroom {
  mor: string
  name: string
  capacityBytes: number
  freeBytes: number
}

/** Below this share of the capacity, or this absolute size, the headroom is reported as thin. */
export const THIN_HEADROOM_RATIO = 0.1
export const THIN_HEADROOM_BYTES = 10 * 1024 ** 3

const ENV = (inner: string) => `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25"><soapenv:Body>${inner}</soapenv:Body></soapenv:Envelope>`

/** Datastore morefs of a VM config response (`storage.perDatastoreUsage` entries, or the `datastore` property). */
export function parseVmDatastoreMors(vmXml: string): string[] {
  const usage = extractProp(vmXml, "storage.perDatastoreUsage")
  const mors = [...usage.matchAll(/<datastore[^>]*>([^<]+)<\/datastore>/g)].map(m => m[1].trim())
  return [...new Set(mors)]
}

/** Parse a RetrievePropertiesEx answer carrying summary.name/capacity/freeSpace per Datastore object. */
export function parseDatastoreSummaries(xml: string): DatastoreHeadroom[] {
  const out: DatastoreHeadroom[] = []
  for (const obj of xml.split(/<objects>/).slice(1)) {
    const mor = /<obj type="Datastore">([^<]+)<\/obj>/.exec(obj)?.[1]
    if (!mor) continue
    const name = extractProp(obj, "summary.name")
    const capRaw = extractProp(obj, "summary.capacity").trim()
    const freeRaw = extractProp(obj, "summary.freeSpace").trim()
    if (!/^\d+$/.test(capRaw) || !/^\d+$/.test(freeRaw)) continue
    const capacityBytes = Number(capRaw)
    const freeBytes = Number(freeRaw)
    out.push({ mor, name: name || mor, capacityBytes, freeBytes })
  }
  return out
}

export function isThinHeadroom(d: DatastoreHeadroom): boolean {
  return d.freeBytes < THIN_HEADROOM_BYTES || (d.capacityBytes > 0 && d.freeBytes / d.capacityBytes < THIN_HEADROOM_RATIO)
}

const gb = (b: number) => (b / 1024 ** 3).toFixed(1)

/** One sentence per datastore, flagged when thin; `concurrent` other warm jobs sharing the source are named when known. */
export function describeHeadroom(d: DatastoreHeadroom): string {
  const pct = d.capacityBytes > 0 ? Math.round((d.freeBytes / d.capacityBytes) * 100) : 0
  const base = `Source datastore "${d.name}": ${gb(d.freeBytes)} GB free of ${gb(d.capacityBytes)} GB (${pct}%)`
  return isThinHeadroom(d)
    ? `${base}. The snapshot this migration holds grows with every guest write until the cutover, and other warm jobs on the same datastore each hold their own; if it fills up the guests stall. Free space or run fewer migrations at once.`
    : base
}

/** Read the summaries of the given datastores. */
export async function soapGetDatastoreHeadroom(session: SoapSession, mors: string[]): Promise<DatastoreHeadroom[]> {
  const valid = mors.filter(m => /^[A-Za-z0-9_:-]+$/.test(m))
  if (valid.length === 0) return []
  const body = ENV(`<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>` +
    `<urn:specSet><urn:propSet><urn:type>Datastore</urn:type><urn:pathSet>summary.name</urn:pathSet><urn:pathSet>summary.capacity</urn:pathSet><urn:pathSet>summary.freeSpace</urn:pathSet></urn:propSet>` +
    valid.map(m => `<urn:objectSet><urn:obj type="Datastore">${m}</urn:obj><urn:skip>false</urn:skip></urn:objectSet>`).join("") +
    `</urn:specSet><urn:options/></urn:RetrievePropertiesEx>`)
  const res = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  return parseDatastoreSummaries(res.text)
}
