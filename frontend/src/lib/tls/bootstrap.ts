// src/lib/tls/bootstrap.ts
//
// Opening (and closing) the HTTPS listener. This runs inside the Next server
// process, which is what lets it reach Prisma and decryptSecret — start.js is
// CommonJS outside the bundle and has neither.

import { createHash } from 'node:crypto'

import { buildHttpPolicy } from '@/lib/tls/policy'
import { resolveTlsPort } from '@/lib/tls/schema'
import { defaultSelfSignedNames, generateSelfSigned } from '@/lib/tls/selfSigned'
import { loadTlsSettings } from '@/lib/tls/settings'
import { countCertificates, loadActiveMaterial, saveCertificate } from '@/lib/tls/store'

type Controller = NonNullable<typeof globalThis.__proxcenterTls>

function controller(): Controller | null {
  return (globalThis as any).__proxcenterTls ?? null
}

/**
 * First boot only: forge a self-signed certificate so enabling HTTPS later is
 * one click and no wait. It is stored ACTIVE, but `enabled` stays false on an
 * upgrade, so an existing install sees no behaviour change.
 */
async function ensureCertificateExists(): Promise<void> {
  if ((await countCertificates()) > 0) return

  const { commonName, sanNames } = defaultSelfSignedNames()
  const { certPem, keyPem } = await generateSelfSigned({ commonName, sanNames })

  await saveCertificate({ source: 'self_signed', certPem, keyPem, activate: true })
  console.log(`[tls] generated a self-signed certificate for ${commonName}`)
}

/**
 * The identity of what the listener actually serves, which is the only thing
 * worth comparing on a tick.
 *
 * Not the leaf fingerprint: that says nothing about the intermediates shipped
 * with it. Not a digest of chainPem either, which was the first fix and only
 * half of one — an operator who pastes leaf-plus-intermediates into the
 * certificate field alone leaves chainPem null, so two bundles with the same
 * leaf and different issuers compared equal and the listener was never
 * reloaded. The digest therefore covers exactly the bytes start.js hands to
 * https.createServer as `cert`, whichever field they arrived in.
 */
function servedFingerprint(certPem: string, chainPem: string | null): string {
  return createHash('sha256').update(chainPem ? `${certPem}\n${chainPem}` : certPem).digest('hex')
}

/**
 * Bring the running listener in line with the database. Also the HA
 * propagation path: a replica that renews changes the active fingerprint, and
 * every other replica notices here on its next tick.
 *
 * `ctl.start()` rejects when the listen fails (a bound port, a bad
 * certificate): that rejection is left to propagate here rather than
 * swallowed, so nothing downstream ever reports 'started' for a listener that
 * never came up. `startTlsListener` is what keeps that from taking the boot
 * down; a caller invoking this directly (e.g. after a settings save) sees the
 * rejection and can surface it to the operator.
 *
 * What counts as "in line" is everything that decides the served
 * configuration, not just the leaf certificate: the whole served bundle and the
 * minimum TLS version. Comparing the leaf fingerprint alone made raising
 * minVersion from 1.2 to 1.3 a no-op — the listener kept accepting 1.2 and the
 * settings page said otherwise — and made a corrected intermediate chain under
 * an unchanged leaf never reach the wire.
 */
export async function applyActiveCertificate(): Promise<
  'started' | 'restarted' | 'reloaded' | 'unchanged' | 'stopped' | 'idle'
> {
  const ctl = controller()

  if (!ctl) return 'idle'

  const settings = await loadTlsSettings()

  // The configured policy is only safe to apply once something is actually
  // answering on the HTTPS port. Applied before that — as it used to be — a
  // listener that fails to bind (port taken, unreadable key, anything) leaves
  // every plain-HTTP request bouncing to a port with nothing behind it, and
  // the operator locked out of the appliance through the very path the design
  // calls the way back in. Every branch that leaves the listener down applies
  // `grounded` instead, and only a confirmed listener gets `configured`.
  const configured = buildHttpPolicy(settings)
  const grounded = { ...configured, redirect: false }

  const state = ctl.state()

  if (!settings.enabled) {
    ctl.setHttpPolicy(grounded)

    if (!state.listening) return 'idle'
    await ctl.stop()

    return 'stopped'
  }

  const material = await loadActiveMaterial()

  if (!material) {
    ctl.setHttpPolicy(grounded)

    return 'idle'
  }

  const served = servedFingerprint(material.certPem, material.chainPem)

  const open = async () => {
    try {
      await ctl.start({
        port: resolveTlsPort(),
        certPem: material.certPem,
        chainPem: material.chainPem,
        keyPem: material.keyPem,
        minVersion: settings.minVersion,
        fingerprint: material.fingerprint,
        servedFingerprint: served,
      })
    } catch (err) {
      ctl.setHttpPolicy(grounded)
      throw err
    }

    ctl.setHttpPolicy(configured)
  }

  if (!state.listening) {
    await open()

    return 'started'
  }

  // A minimum version is fixed when the secure context is built and governs
  // the handshake itself. setSecureContext is documented to swap the
  // certificate for new connections; it is not the tool for moving the
  // protocol floor, and a listener that keeps accepting TLS 1.2 after the
  // operator asked for 1.3 is a silent lie. Bounce the listener instead —
  // the same bounce a TLS toggle already performs.
  if (state.minVersion !== settings.minVersion) {
    ctl.setHttpPolicy(grounded)
    await ctl.stop()
    await open()

    return 'restarted'
  }

  ctl.setHttpPolicy(configured)

  // The intermediates can move under an unchanged leaf: re-importing a bundle
  // with the right ones is precisely how an operator fixes a chain error, and
  // that bundle may well arrive in the certificate field alone. Comparing the
  // served bytes catches it whichever field carried it.
  if (state.servedFingerprint === served) return 'unchanged'

  ctl.reload({
    certPem: material.certPem,
    chainPem: material.chainPem,
    keyPem: material.keyPem,
    fingerprint: material.fingerprint,
    servedFingerprint: served,
  })

  return 'reloaded'
}

export async function startTlsListener(): Promise<void> {
  if (process.env.DEMO_MODE === 'true') return

  try {
    await ensureCertificateExists()
    await applyActiveCertificate()
  } catch (err) {
    // Boot must never depend on TLS: the plain HTTP listener is the way back
    // in when something here is wrong, and the next boot retries.
    console.error('[tls] listener startup failed (non-fatal):', err)
  }
}
