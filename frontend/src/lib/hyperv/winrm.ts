/**
 * WinRM (Windows Remote Management) SOAP client
 *
 * Communicates with a Windows host via the WS-Management protocol (SOAP over HTTP).
 * Uses Basic auth against http(s)://<host>:<port>/wsman.
 *
 * Protocol flow per command execution:
 *   1. Create a remote shell  (ws-transfer Create)
 *   2. Execute a command       (shell/Command)
 *   3. Receive stdout/stderr   (shell/Receive)  -- polled until CommandState = Done
 *   4. Delete the shell        (ws-transfer Delete)
 *
 * Prerequisites on the Windows host:
 *   Enable-PSRemoting -Force
 *   winrm set winrm/config/service/auth @{Basic="true"}
 *   winrm set winrm/config/service @{AllowUnencrypted="true"}   # HTTP only
 */

import { randomUUID } from "crypto"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WinRMConnection {
  host: string
  username: string
  password: string
  port?: number     // default 5985
  useSSL?: boolean  // default false
  /** Timeout in ms for each HTTP request (default 30 000) */
  timeout?: number
}

// ---------------------------------------------------------------------------
// XML Namespaces (constants)
// ---------------------------------------------------------------------------

const NS = {
  s:    "http://www.w3.org/2003/05/soap-envelope",
  wsa:  "http://schemas.xmlsoap.org/ws/2004/08/addressing",
  wsman: "http://schemas.dmtf.org/wbem/wsman/1/wsman.xsd",
  rsp:  "http://schemas.microsoft.com/wbem/wsman/1/windows/shell",
  xfer: "http://schemas.xmlsoap.org/ws/2004/09/transfer",
} as const

const SHELL_URI = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/cmd"
const COMMAND_ACTION = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Command"
const RECEIVE_ACTION = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Receive"
const SIGNAL_ACTION  = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/Signal"
const SIGNAL_TERMINATE = "http://schemas.microsoft.com/wbem/wsman/1/windows/shell/signal/terminate"

/**
 * WS-Management OperationTimeout sent in every header. A Receive blocks on the
 * server until the command writes output or this elapses, in which case the
 * server answers a wsman:TimedOut fault and the client simply asks again.
 */
const OPERATION_TIMEOUT_SEC = 60

/**
 * HTTP budget for a Receive request: it must outlive OperationTimeout, or a
 * PowerShell script that stays silent for 30 s (Get-VM over a host with many
 * guests) aborts on our side before the server had a chance to answer.
 */
const RECEIVE_TIMEOUT_MS = (OPERATION_TIMEOUT_SEC + 15) * 1000

/**
 * Overall cap on one command's output wait (two OperationTimeout rounds).
 * Ordinary listings finish in a few seconds; the inventory's client budget
 * for Hyper-V (lib/inventory/externalVmFetch.ts) sits above this cap plus the
 * shell round trips, so the UI never gives up before the route does.
 */
export const MAX_RECEIVE_WAIT_MS = 2 * OPERATION_TIMEOUT_SEC * 1000

/** True for the server-side wsman:TimedOut fault (no output yet, command still running). */
function isOperationTimeoutFault(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /TimedOut|OperationTimeout/i.test(msg)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Encode a PowerShell command as Base64 UTF-16LE (for -EncodedCommand) */
function encodePSCommand(cmd: string): string {
  const buf = Buffer.from(cmd, "utf16le")
  return buf.toString("base64")
}

/**
 * Turn PowerShell's stderr into the text of the real errors only.
 *
 * Over WinRM, powershell.exe serialises its error stream as CLIXML
 * (`#< CLIXML` header followed by an <Objs> document). That stream also
 * carries progress records ("Preparing modules for first use", pipeline
 * progress) which are not errors at all, so a command with no stdout and a
 * module import on a cold host looked like a failure. Keep the <S S="Error">
 * strings, drop the rest; a plain-text stderr is returned unchanged.
 */
export function cleanPowerShellStderr(stderr: string): string {
  const text = stderr.trim()
  if (!text.startsWith("#< CLIXML")) return text

  const errors: string[] = []
  const re = /<S S="Error">([\s\S]*?)<\/S>/g
  for (const m of text.matchAll(re)) {
    const decoded = m[1]
      .replaceAll(/_x000D__x000A_/g, "\n")
      .replaceAll(/_x000A_/g, "\n")
      .replaceAll(/&lt;/g, "<")
      .replaceAll(/&gt;/g, ">")
      .replaceAll(/&quot;/g, '"')
      .replaceAll(/&apos;/g, "'")
      .replaceAll(/&amp;/g, "&")
      .trim()
    if (decoded) errors.push(decoded)
  }
  return errors.join("\n").trim()
}

/** Extract the text content of the first XML tag matching a local name. */
function xmlTag(xml: string, localName: string): string | null {
  // Matches <prefix:localName ...>content</prefix:localName> or <localName ...>content</localName>
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${localName}[^>]*>([\\s\\S]*?)<\\/(?:[a-zA-Z0-9_]+:)?${localName}>`)
  const m = xml.match(re)
  return m ? m[1] : null
}

/** Extract an attribute value from the first element matching a local name. */
function xmlAttr(xml: string, localName: string, attrName: string): string | null {
  const re = new RegExp(`<(?:[a-zA-Z0-9_]+:)?${localName}[^>]*?${attrName}="([^"]*)"`)
  const m = xml.match(re)
  return m ? m[1] : null
}

/** Check if response contains a SOAP Fault */
function checkFault(xml: string): void {
  const fault = xmlTag(xml, "Fault")
  if (fault) {
    const reason = xmlTag(fault, "Text") || xmlTag(fault, "faultstring") || fault.slice(0, 500)
    throw new Error(`WinRM SOAP Fault: ${reason.trim()}`)
  }
}

// ---------------------------------------------------------------------------
// WinRM Client
// ---------------------------------------------------------------------------

export class WinRMClient {
  private endpoint: string
  private authHeader: string
  private timeout: number

  constructor(private conn: WinRMConnection) {
    const protocol = conn.useSSL ? "https" : "http"
    const port = conn.port ?? (conn.useSSL ? 5986 : 5985)
    // Strip any protocol prefix the user may have included in the host field
    const host = conn.host.replace(/^https?:\/\//, "").replace(/\/+$/, "").split(":")[0]
    this.endpoint = `${protocol}://${host}:${port}/wsman`
    this.authHeader = `Basic ${Buffer.from(`${conn.username}:${conn.password}`).toString("base64")}`
    this.timeout = conn.timeout ?? 30_000
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Execute a PowerShell command on the remote host and return stdout.
   * Throws on SOAP faults, HTTP errors, or non-empty stderr with no stdout.
   */
  async execute(psCommand: string): Promise<string> {
    const shellId = await this.createShell()

    try {
      // Progress records would otherwise land on stderr as CLIXML; nobody
      // watches a progress bar over WinRM, and they cost bandwidth per poll.
      const script = `$ProgressPreference = 'SilentlyContinue'\n${psCommand}`
      const commandId = await this.runCommand(shellId, script)
      const { stdout, stderr } = await this.receiveOutput(shellId, commandId)
      await this.signalTerminate(shellId, commandId)

      // If we got nothing on stdout but a real error on stderr, fail
      const errorText = cleanPowerShellStderr(stderr)
      if (!stdout.trim() && errorText) {
        throw new Error(`PowerShell error: ${errorText.slice(0, 2000)}`)
      }

      return stdout
    } finally {
      await this.deleteShell(shellId).catch(() => {
        // Best-effort cleanup; don't mask the real error
      })
    }
  }

  /**
   * Test the connection by retrieving hostname and Windows version.
   */
  async testConnection(): Promise<{ hostname: string; version: string }> {
    const ps = `@{Hostname=$env:COMPUTERNAME; Version=(Get-ItemProperty 'HKLM:\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion').ProductName} | ConvertTo-Json`
    const raw = await this.execute(ps)
    const data = JSON.parse(raw.trim())
    return {
      hostname: data.Hostname || "unknown",
      version: data.Version || "unknown",
    }
  }

  // -----------------------------------------------------------------------
  // SOAP envelope builders
  // -----------------------------------------------------------------------

  /** Build a common SOAP header block. */
  private soapHeader(action: string, resourceUri: string, extras = ""): string {
    const messageId = `uuid:${randomUUID()}`
    return `
      <s:Header>
        <wsa:To>${this.endpoint}</wsa:To>
        <wsman:ResourceURI s:mustUnderstand="true">${resourceUri}</wsman:ResourceURI>
        <wsa:ReplyTo>
          <wsa:Address s:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2004/08/addressing/role/anonymous</wsa:Address>
        </wsa:ReplyTo>
        <wsa:Action s:mustUnderstand="true">${action}</wsa:Action>
        <wsa:MessageID>${messageId}</wsa:MessageID>
        <wsman:OperationTimeout>PT${OPERATION_TIMEOUT_SEC}S</wsman:OperationTimeout>
        ${extras}
      </s:Header>`
  }

  private soapEnvelope(header: string, body: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="${NS.s}" xmlns:wsa="${NS.wsa}" xmlns:wsman="${NS.wsman}" xmlns:rsp="${NS.rsp}">
  ${header}
  <s:Body>
    ${body}
  </s:Body>
</s:Envelope>`
  }

  // -----------------------------------------------------------------------
  // Step 1: Create Shell
  // -----------------------------------------------------------------------

  private async createShell(): Promise<string> {
    const header = this.soapHeader(
      `${NS.xfer}/Create`,
      SHELL_URI,
      `<wsman:OptionSet>
        <wsman:Option Name="WINRS_NOPROFILE">TRUE</wsman:Option>
        <wsman:Option Name="WINRS_CODEPAGE">65001</wsman:Option>
      </wsman:OptionSet>`
    )
    const body = `
      <rsp:Shell>
        <rsp:InputStreams>stdin</rsp:InputStreams>
        <rsp:OutputStreams>stdout stderr</rsp:OutputStreams>
      </rsp:Shell>`

    const xml = await this.post(this.soapEnvelope(header, body))
    const shellId = xmlTag(xml, "ShellId")
    if (!shellId) {
      throw new Error(`WinRM: failed to create shell. Response: ${xml.slice(0, 1000)}`)
    }
    return shellId.trim()
  }

  // -----------------------------------------------------------------------
  // Step 2: Execute Command
  // -----------------------------------------------------------------------

  private async runCommand(shellId: string, psCommand: string): Promise<string> {
    const encoded = encodePSCommand(psCommand)
    const selectorHeader = `<wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>`
    const header = this.soapHeader(COMMAND_ACTION, SHELL_URI, selectorHeader)
    const body = `
      <rsp:CommandLine>
        <rsp:Command>powershell.exe</rsp:Command>
        <rsp:Arguments>-NoProfile -NonInteractive -EncodedCommand ${encoded}</rsp:Arguments>
      </rsp:CommandLine>`

    const xml = await this.post(this.soapEnvelope(header, body))
    const commandId = xmlTag(xml, "CommandId")
    if (!commandId) {
      throw new Error(`WinRM: failed to run command. Response: ${xml.slice(0, 1000)}`)
    }
    return commandId.trim()
  }

  // -----------------------------------------------------------------------
  // Step 3: Receive Output (poll until done)
  // -----------------------------------------------------------------------

  private async receiveOutput(
    shellId: string,
    commandId: string
  ): Promise<{ stdout: string; stderr: string }> {
    const stdoutParts: string[] = []
    const stderrParts: string[] = []

    const deadline = Date.now() + MAX_RECEIVE_WAIT_MS

    while (Date.now() < deadline) {
      const selectorHeader = `<wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>`
      const header = this.soapHeader(RECEIVE_ACTION, SHELL_URI, selectorHeader)
      const body = `
        <rsp:Receive>
          <rsp:DesiredStream CommandId="${commandId}">stdout stderr</rsp:DesiredStream>
        </rsp:Receive>`

      let xml: string
      try {
        xml = await this.post(this.soapEnvelope(header, body), RECEIVE_TIMEOUT_MS)
      } catch (err) {
        // The server waited OperationTimeout without output: the command is
        // still running, ask again. Anything else is a real failure.
        if (isOperationTimeoutFault(err)) continue
        throw err
      }

      // Extract Stream elements with Name="stdout" or Name="stderr"
      // containing base64-encoded output
      const streams = xml.matchAll(/<(?:[a-zA-Z0-9_]+:)?Stream[^>]*Name="(stdout|stderr)"[^>]*>([^<]*)<\/(?:[a-zA-Z0-9_]+:)?Stream>/g)
      for (const m of streams) {
        const b64 = m[2].trim()
        if (b64) {
          const decoded = Buffer.from(b64, "base64").toString("utf8")
          if (m[1] === "stdout") stdoutParts.push(decoded)
          else stderrParts.push(decoded)
        }
      }

      // Check if the command is done
      const state = xmlAttr(xml, "CommandState", "State")
      if (state && state.includes("Done")) {
        break
      }

      // Brief pause before next poll
      await new Promise(r => setTimeout(r, 500))
    }

    return {
      stdout: stdoutParts.join(""),
      stderr: stderrParts.join(""),
    }
  }

  // -----------------------------------------------------------------------
  // Step 3b: Signal terminate (optional but clean)
  // -----------------------------------------------------------------------

  private async signalTerminate(shellId: string, commandId: string): Promise<void> {
    const selectorHeader = `<wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>`
    const header = this.soapHeader(SIGNAL_ACTION, SHELL_URI, selectorHeader)
    const body = `
      <rsp:Signal CommandId="${commandId}">
        <rsp:Code>${SIGNAL_TERMINATE}</rsp:Code>
      </rsp:Signal>`

    try {
      await this.post(this.soapEnvelope(header, body))
    } catch {
      // Best-effort; some servers reject signal after Done state
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Delete Shell
  // -----------------------------------------------------------------------

  private async deleteShell(shellId: string): Promise<void> {
    const selectorHeader = `<wsman:SelectorSet><wsman:Selector Name="ShellId">${shellId}</wsman:Selector></wsman:SelectorSet>`
    const header = this.soapHeader(`${NS.xfer}/Delete`, SHELL_URI, selectorHeader)
    const body = ""

    await this.post(this.soapEnvelope(header, body))
  }

  // -----------------------------------------------------------------------
  // HTTP transport
  // -----------------------------------------------------------------------

  private async post(soapXml: string, timeoutMs: number = this.timeout): Promise<string> {
    const fetchOpts: RequestInit & { dispatcher?: unknown } = {
      method: "POST",
      headers: {
        "Content-Type": "application/soap+xml;charset=UTF-8",
        Authorization: this.authHeader,
        // Defeat brotli/zstd decode regressions on Node 26 + undici 8.x when
        // a custom dispatcher is attached (see lib/http/insecure-fetch.ts).
        "Accept-Encoding": "identity",
      },
      body: soapXml,
      signal: AbortSignal.timeout(timeoutMs),
    }

    // For HTTPS with self-signed certs, disable TLS verification
    if (this.conn.useSSL) {
      try {
        const { Agent } = await import("undici")
        fetchOpts.dispatcher = new Agent({ connect: { rejectUnauthorized: false }, allowH2: false })
      } catch {
        // undici not available; proceed without custom dispatcher
      }
    }

    const res = await fetch(this.endpoint, fetchOpts as any)
    const text = await res.text()

    if (!res.ok) {
      // Try to extract a meaningful error from the SOAP fault
      const faultText = xmlTag(text, "Text") || xmlTag(text, "faultstring") || ""
      throw new Error(
        `WinRM HTTP ${res.status}: ${faultText || text.slice(0, 500)}`
      )
    }

    checkFault(text)
    return text
  }
}
