/*
   Why a ceph-exporter could not be read. Shared by the server (which classifies the failure of the GET) and the
   client hooks (which read the reason from the API), so it holds no server import.
     refused  the node answers but nothing listens on the port: package missing or service stopped
     timeout  no answer in time: port filtered by a firewall, or node unreachable
     invalid  anything else: HTTP status other than 200, body too large, unexpected failure
*/

export type ExporterFailure = 'refused' | 'timeout' | 'invalid'

export const EXPORTER_FAILURES: readonly ExporterFailure[] = ['refused', 'timeout', 'invalid']

export function isExporterFailure(value: unknown): value is ExporterFailure {
  return typeof value === 'string' && (EXPORTER_FAILURES as readonly string[]).includes(value)
}

export type ExporterHelp = {
  /** Key of the message under `cephCockpit.osd.activity`. */
  messageKey: 'unreachable' | 'unreachableRefused' | 'unreachableTimeout' | 'unreachableInvalid'
  /** The installation procedure is relevant: package missing, or cause unknown. */
  install: boolean
}

/**
 * What to tell about a node whose exporter is not read. No reason (an older server) or no node to name: the generic
 * message and the installation procedure, as before. A timeout only reminds of the port (the message says it); an
 * invalid answer points at the port set on the connection; neither offers an installation.
 */
export function exporterHelp(reason: ExporterFailure | null | undefined, hasNode: boolean): ExporterHelp {
  if (!reason || !hasNode) return { messageKey: 'unreachable', install: true }
  if (reason === 'refused') return { messageKey: 'unreachableRefused', install: true }
  if (reason === 'timeout') return { messageKey: 'unreachableTimeout', install: false }
  return { messageKey: 'unreachableInvalid', install: false }
}
