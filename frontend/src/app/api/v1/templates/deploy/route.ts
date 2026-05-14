// src/app/api/v1/templates/deploy/route.ts
import { NextResponse, after } from "next/server"

import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId , DEFAULT_TENANT_ID } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { deploySchema } from "@/lib/schemas"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { getImageBySlug, customImageToCloudImage } from "@/lib/templates/cloudImages"
import { isFileBasedStorage, supportsVmDisks } from "@/lib/proxmox/storage"
import { resolveVdcForTenant, checkVdcQuota } from "@/lib/vdc/quota"
import { getAllowedBridgesForTenant, resolveSubnetForBridge } from "@/lib/vdc/vnets"
import { generatePveMacAddress } from "@/lib/vdc/sdn"
import { allocateIp, releaseIp, IpamExhaustedError } from "@/lib/vdc/ipam"
import { scanUsedIpsForSubnet, scannedToIntSet } from "@/lib/vdc/ipamScan"
import { parseCidr } from "@/lib/vdc/network"
import { waitForTask } from "@/lib/proxmox/tasks"
import { getVdcScope } from "@/lib/vdc/scope"

export const runtime = "nodejs"

type DeploymentStatus = "pending" | "downloading" | "creating" | "configuring" | "starting" | "completed" | "failed"

async function updateDeployment(id: string, status: DeploymentStatus, extra: Record<string, any> = {}) {
  const prisma = await getSessionPrisma()

  await prisma.deployment.update({
    where: { id },
    data: {
      status,
      currentStep: status,
      ...(status === "completed" ? { completedAt: new Date() } : {}),
      ...extra,
    },
  })
}

export async function POST(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)

    if (denied) return denied

    const session = await getServerSession(authOptions)
    const rawBody = await req.json().catch(() => null)

    if (!rawBody) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const parseResult = deploySchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const body = parseResult.data

    // Resolve image: built-in first, then custom from DB
    const tenantId = await getCurrentTenantId()
    let image = getImageBySlug(body.imageSlug) as any
    let isCustom = false
    let sourceType = 'url'
    let volumeId: string | null = null

    if (!image) {
      const customRow = await prisma.customImage.findUnique({ where: { tenantId_slug: { tenantId, slug: body.imageSlug } } })

      if (!customRow) {
        return NextResponse.json({ error: "Unknown image slug" }, { status: 400 })
      }

      image = customImageToCloudImage(customRow)
      isCustom = true
      sourceType = customRow.sourceType
      volumeId = customRow.volumeId
    }

    // Resolve the tenant's vDC for this connection+node so we can pin
    // the VM to its PVE pool. Without this the inventory filter (which
    // lists VMs by `pool === vdc.pvePoolName`) wouldn't surface the
    // deployed VM and the tenant would think the deploy failed.
    //
    // Errors are NOT swallowed here — a NODE_NOT_AUTHORIZED throw means
    // the tenant tried to deploy on a node outside its vDC and must be
    // refused; any other error must surface so the deploy stops before
    // we forge a PVE call. For non-provider tenants, vdcInfo MUST be
    // non-null afterwards: a tenant with no vDC on the connection has
    // no business creating a VM here.
    const isTenant = tenantId !== DEFAULT_TENANT_ID
    let vdcInfo: Awaited<ReturnType<typeof resolveVdcForTenant>> = null

    try {
      vdcInfo = await resolveVdcForTenant(tenantId, body.connectionId, body.node)
    } catch (e: any) {
      if (e?.message === 'NODE_NOT_AUTHORIZED') {
        return NextResponse.json({ error: 'This node is not authorized for your vDC' }, { status: 403 })
      }

      throw e
    }

    if (isTenant && !vdcInfo) {
      return NextResponse.json({ error: 'No vDC on this connection — deploy not allowed' }, { status: 403 })
    }

    // vDC quota enforcement. Mirrors the create-VM route on
    // /connections/[id]/guests/[type]/[node] so a tenant can't bypass
    // their CPU / RAM / storage / VM-count limits by going through the
    // template wizard instead. Provider (vdcInfo === null) is not
    // capped. The disk size we account for is body.hardware.diskSize
    // (GB), since both the URL and ISO branches end up importing /
    // creating a disk of that size; the ephemeral cloudinit drive is
    // negligible and not metered.
    if (vdcInfo) {
      const hw = body.hardware || ({} as any)
      const cores = Number.parseInt(String(hw.cores ?? '1'))
      const sockets = Number.parseInt(String(hw.sockets ?? '1'))
      const vcpus = (Number.isFinite(cores) ? cores : 1) * (Number.isFinite(sockets) ? sockets : 1)
      const ramMb = Number.parseInt(String(hw.memory ?? '512'))
      const diskGb = Number.parseInt(String(hw.diskSize ?? '0').replace(/G$/i, ''))
      const storageMb = (Number.isFinite(diskGb) && diskGb > 0) ? diskGb * 1024 : 0

      const quotaCheck = await checkVdcQuota(body.connectionId, vdcInfo.poolName, vdcInfo.quota, {
        type: 'create',
        addVcpus: vcpus,
        addRamMb: Number.isFinite(ramMb) ? ramMb : 0,
        addStorageMb: storageMb,
        addVms: 1,
      })

      if (!quotaCheck.allowed) {
        return NextResponse.json({
          error: 'Quota exceeded',
          violations: quotaCheck.violations,
          currentUsage: quotaCheck.currentUsage,
        }, { status: 409 })
      }
    }

    // Storage / bridge / ISO storage allow-lists from the tenant's vDC
    // scope. Tenants must pick infra they actually own; the wizard
    // already enforces this client-side, but the API contract has to
    // hold against forged payloads too.
    if (isTenant) {
      const scope = await getVdcScope(tenantId)

      if (!scope) {
        return NextResponse.json({ error: 'Tenant vDC scope not resolved' }, { status: 403 })
      }

      const allowedStorages = scope.storagesByConnection.get(body.connectionId) ?? new Set<string>()

      if (!allowedStorages.has(body.storage)) {
        return NextResponse.json(
          { error: `Storage "${body.storage}" is not authorised for this tenant.` },
          { status: 403 },
        )
      }

      if (body.isoStorage && !allowedStorages.has(body.isoStorage)) {
        return NextResponse.json(
          { error: `ISO storage "${body.isoStorage}" is not authorised for this tenant.` },
          { status: 403 },
        )
      }

      const allowedBridges = await getAllowedBridgesForTenant(tenantId, body.connectionId)
      const bridge = body.hardware?.networkBridge

      if (allowedBridges !== null && bridge && !allowedBridges.has(bridge)) {
        return NextResponse.json(
          { error: `Bridge "${bridge}" is not authorised for this vDC. Allowed: ${Array.from(allowedBridges).join(', ')}` },
          { status: 403 },
        )
      }
    }

    const conn = await getConnectionById(body.connectionId)

    // Create deployment record
    const deployment = await prisma.deployment.create({
      data: {
        connectionId: body.connectionId,
        node: body.node,
        vmid: body.vmid,
        vmName: body.vmName || null,
        imageSlug: body.imageSlug,
        blueprintId: body.blueprintId || null,
        blueprintName: body.blueprintName || null,
        config: {
          storage: body.storage,
          vmName: body.vmName,
          hardware: body.hardware,
          cloudInit: body.cloudInit,
        },
        status: "pending",
        currentStep: "pending",
        startedAt: new Date(),
      },
    })

    // Save as blueprint if requested
    if (body.saveAsBlueprint && body.blueprintName) {
      await prisma.blueprint.create({
        data: {
          name: body.blueprintName,
          imageSlug: body.imageSlug,
          hardware: body.hardware,
          cloudInit: body.cloudInit ?? null,
          createdBy: session?.user?.id || null,
        },
      }).catch(() => {}) // Non-blocking
    }

    // True when the resolved image is an install-media ISO. We branch the
    // pipeline below: no cloud-init disk import, no auto-start — the VM is
    // created stopped with the ISO mounted on a CD-ROM drive so the tenant
    // can run the installer manually via the noVNC console.
    const isIsoMode = String(image?.format || '').toLowerCase() === 'iso'

    if (isIsoMode && !body.isoStorage) {
      return NextResponse.json(
        { error: "isoStorage is required when deploying from an ISO image" },
        { status: 400 }
      )
    }

    // Run the deployment pipeline asynchronously after the response is sent
    after(async () => {
      // Hoisted so the catch below can release the IPAM reservation if
      // the pipeline throws after we've claimed an IP. `let` inside the
      // try wouldn't be visible from the sibling catch block.
      let ipamAllocation: { subnetId: string; ip: string } | null = null

      try {
        // ─────────── ISO branch ───────────────────────────────────────
        // Stops at the "creating" step (no cloud-init, no start). The VM
        // boots from CD-ROM on first power-up and the user installs the
        // OS manually via the console.
        if (isIsoMode) {
          await runIsoDeploy({
            deploymentId: deployment.id,
            conn,
            body,
            image,
            isCustom,
            sourceType,
            volumeId,
            vdcInfo,
            onIpamAllocation: (alloc) => { ipamAllocation = alloc },
          })

return
        }

        let importVolume: string

        if (sourceType === 'volume' && volumeId) {
          // ── Volume mode: image already on PVE storage, skip download ──
          await updateDeployment(deployment.id, "downloading")
          importVolume = volumeId
        } else {
          // ── URL mode: download image to storage ──
          // Step 1: Download image to storage (skip if already present)
          await updateDeployment(deployment.id, "downloading")

          // Filename strategy:
          //  - Built-in images (Ubuntu official, etc.): keep the upstream
          //    filename so all tenants share the same downloaded artefact
          //    (natural deduplication on the same PVE storage).
          //  - Custom images: derive from the slug, which is already
          //    tenant-prefixed for private images (e.g. `custom-acme-myapp`)
          //    by the POST /custom-images route. Two tenants that upload the
          //    same source URL therefore land in distinct files and can't
          //    overwrite each other's image on a shared storage.
          const rawFilename = isCustom
            ? `${image.slug}.${image.format}`
            : (image.downloadUrl.split("/").pop() || `${image.slug}.${image.format}`)


          // PVE import content type requires .qcow2/.raw/.vmdk extension — rename .img to .qcow2
          const urlFilename = rawFilename.replace(/\.img$/, ".qcow2")

          // Determine if target storage is file-based (supports download-url) or block-based
          const storageConfig = await pveFetch<any>(
            conn,
            `/storage/${encodeURIComponent(body.storage)}`
          )

          const storageType = storageConfig?.type || "dir"
          let downloadStorage = body.storage

          // Reject storages that don't support VM disk images (e.g. CephFS)
          if (!supportsVmDisks(storageType)) {
            throw new Error(
              `Storage '${body.storage}' (type '${storageType}') does not support VM disk images. ` +
              `Please select a storage that supports VM images (e.g. dir, NFS, RBD, LVM, ZFS).`
            )
          }

          // The backing technology supports images, but PVE also requires the
          // storage to be configured with `content=images` (or rootdir for
          // containers). The default `local` directory storage typically only
          // ships with `iso,vztmpl,backup` and PVE rejects vm creation with a
          // 400 — check up front so we surface a readable error instead of
          // the cryptic Proxmox parameter-verification message.
          const storageContent = String(storageConfig?.content || '')

          if (!storageContent.split(',').map(s => s.trim()).some(c => c === 'images' || c === 'rootdir')) {
            throw new Error(
              `Storage '${body.storage}' is not configured for VM disk images ` +
              `(content="${storageContent || 'unknown'}"). Pick another storage in your vDC ` +
              `that includes "images" in its content types (e.g. local-lvm, ceph, NFS).`
            )
          }

          // Block-based storages (zfspool, lvm, lvmthin, rbd...) do not support download-url.
          // Use a file-based storage as staging area for the download, then import-from it.
          if (!isFileBasedStorage(storageType)) {
            const nodeStorages = await pveFetch<any[]>(
              conn,
              `/nodes/${encodeURIComponent(body.node)}/storage`
            ).catch(() => [])

            const staging = (nodeStorages || []).find((s: any) => isFileBasedStorage(s.type) && s.enabled !== 0)

            if (!staging) {
              throw new Error(
                `Storage '${body.storage}' is type '${storageType}' which does not support direct image download. ` +
                `No file-based storage (dir/NFS/CIFS) found on node '${body.node}' to use as staging area.`
              )
            }

            downloadStorage = staging.storage
          }

          // Ensure download storage has 'import' content type enabled
          if (downloadStorage !== body.storage) {
            const dlStorageConfig = await pveFetch<any>(
              conn,
              `/storage/${encodeURIComponent(downloadStorage)}`
            )

            const dlContent = String(dlStorageConfig?.content || "")

            if (!dlContent.split(",").map((s: string) => s.trim()).includes("import")) {
              const newContent = dlContent ? `${dlContent},import` : "import"

              await pveFetch<any>(
                conn,
                `/storage/${encodeURIComponent(downloadStorage)}`,
                { method: "PUT", body: new URLSearchParams({ content: newContent }) }
              )
            }
          } else {
            const currentContent = String(storageConfig?.content || "")

            if (!currentContent.split(",").map((s: string) => s.trim()).includes("import")) {
              const newContent = currentContent ? `${currentContent},import` : "import"

              await pveFetch<any>(
                conn,
                `/storage/${encodeURIComponent(body.storage)}`,
                { method: "PUT", body: new URLSearchParams({ content: newContent }) }
              )
            }
          }

          // Check if image already exists on download storage
          const storageContents = await pveFetch<any[]>(
            conn,
            `/nodes/${encodeURIComponent(body.node)}/storage/${encodeURIComponent(downloadStorage)}/content?content=import`
          ).catch(() => [])

          const imageAlreadyExists = (storageContents || []).some(
            (item: any) => item.volid?.endsWith(`/${urlFilename}`) || item.volid?.endsWith(`:import/${urlFilename}`)
          )

          if (!imageAlreadyExists) {
            const downloadParams = new URLSearchParams({
              url: image.downloadUrl,
              content: "import",
              filename: urlFilename,
              node: body.node,
              storage: downloadStorage,
              "verify-certificates": "0",
            })

            const downloadResult = await pveFetch<any>(
              conn,
              `/nodes/${encodeURIComponent(body.node)}/storage/${encodeURIComponent(downloadStorage)}/download-url`,
              { method: "POST", body: downloadParams }
            )

            // If download returned a task UPID, wait for it to complete
            if (downloadResult) {
              const upid = downloadResult

              await updateDeployment(deployment.id, "downloading", { taskUpid: String(upid) })
              await waitForTask(conn, body.node, String(upid))
            }
          }

          importVolume = `${downloadStorage}:import/${urlFilename}`
        }

        // Step 2: Create VM with imported disk
        await updateDeployment(deployment.id, "creating")

        const hw = body.hardware

        // IPAM auto-allocation via our own SQLite-backed IPAM. The deploy
        // wizard restricts the bridge picker to SDN VNets, so when the
        // chosen VNet has an IPAM-enabled subnet we mint a stable MAC,
        // claim an IP from the IPAM, and inject the matching ipconfig0 —
        // without this the VM hangs at systemd-networkd-wait-online
        // because PVE-native DHCP isn't available on VXLAN.
        //
        // Lookup uses connectionId+bridge (no tenant filter) so a
        // super-admin (default tenant) deploying into a tenant-owned
        // vDC still hits the IPAM path. Authorisation was already done
        // upstream by resolveVdcForTenant + RBAC.
        let netSpec = `${hw.networkModel},bridge=${hw.networkBridge}${hw.vlanTag ? `,tag=${hw.vlanTag}` : ""}`
        let ipamIpconfig0: string | null = null
        let ipamDns: string[] = []

        const subnet = await resolveSubnetForBridge(body.connectionId, hw.networkBridge)

        if (subnet) {
          const mac = generatePveMacAddress()


          // Pin the MAC into the model token so PVE doesn't roll its own
          // and our IPAM record stays in sync across rebuilds.
          netSpec = `${hw.networkModel}=${mac},bridge=${hw.networkBridge}${hw.vlanTag ? `,tag=${hw.vlanTag}` : ""}`

          try {
            // Scan the vDC pool for IPs already deployed in PVE configs but
            // not tracked by our IPAM (CLI-created VMs, restored backups,
            // etc.). The result merges into the allocator's "taken" set so
            // we never collide with an out-of-band IP. Cached for 60s.
            // We use subnet.pvePoolName, NOT vdcInfo.poolName, because the
            // latter is null when a super-admin (default tenant) deploys
            // into another tenant's vDC — but the subnet still belongs to
            // a real pool we can scan.
            const externalScanned = await scanUsedIpsForSubnet({
              conn,
              vdcPoolName: subnet.pvePoolName,
              vnetPveName: subnet.pveName,
              subnetId: subnet.subnetId,
              connectionId: body.connectionId,
            })

            const externalIps = scannedToIntSet(externalScanned)

            const allocated = await allocateIp({
              vdcId: subnet.vdcId,
              subnetId: subnet.subnetId,
              vnetId: subnet.vnetId,
              connectionId: body.connectionId,
              mac,
              vmid: body.vmid,
              hostname: body.vmName || `vm-${body.vmid}`,
              externalIps,
            })

            ipamAllocation = { subnetId: subnet.subnetId, ip: allocated.ip }
            const cidrInfo = parseCidr(subnet.cidr)
            const prefix = cidrInfo?.prefix

            ipamIpconfig0 = [
              `ip=${allocated.ip}${prefix !== undefined ? `/${prefix}` : ''}`,
              `gw=${subnet.gateway}`,
            ].join(',')
            ipamDns = subnet.dnsServers
          } catch (err: any) {
            const msg = err instanceof IpamExhaustedError
              ? `Subnet ${subnet.cidr} is full — no free IP available`
              : `IPAM allocation failed: ${err?.message ?? String(err)}`

            await updateDeployment(deployment.id, "failed", { errorMessage: msg })
            throw err
          }
        }

        const createParams = new URLSearchParams({
          vmid: String(body.vmid),
          name: body.vmName || `${image.slug}-${body.vmid}`,
          ostype: hw.ostype,
          cores: String(hw.cores),
          sockets: String(hw.sockets),
          memory: String(hw.memory),
          cpu: hw.cpu,
          scsihw: hw.scsihw,
          scsi0: `${body.storage}:0,import-from=${importVolume}`,
          net0: netSpec,
          ide2: `${body.storage}:cloudinit`,
          boot: "order=scsi0",
          serial0: "socket",
          vga: "serial0",
          agent: hw.agent ? "1" : "0",
        })

        // Pin the VM to the tenant's vDC pool so it surfaces in their
        // inventory (the inventory stream filters by pool === vdc.pvePoolName).
        if (vdcInfo?.poolName) {
          createParams.set('pool', vdcInfo.poolName)
        }

        const createResult = await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(body.node)}/qemu`,
          { method: "POST", body: createParams }
        )

        // Wait for VM creation task — store its UPID for live tracking
        if (createResult) {
          await updateDeployment(deployment.id, "creating", { taskUpid: String(createResult) })
          await waitForTask(conn, body.node, String(createResult))
        }

        // Step 3: Configure cloud-init
        await updateDeployment(deployment.id, "configuring", { taskUpid: null })

        if (body.cloudInit) {
          const ci = body.cloudInit

          // Build body manually — PVE expects ipconfig values with raw "=" signs.
          // sshkeys must be double-encoded: PVE form-decodes the body, then
          // URL-decodes the sshkeys value internally.
          const ciParts: string[] = []

          if (ci.ciuser) ciParts.push(`ciuser=${encodeURIComponent(ci.ciuser)}`)
          if (ci.cipassword) ciParts.push(`cipassword=${encodeURIComponent(ci.cipassword)}`)
          if (ci.sshKeys) ciParts.push(`sshkeys=${encodeURIComponent(encodeURIComponent(ci.sshKeys))}`)

          // Resolve ipconfig0: prefer the IPAM-allocated static config when
          // we have one, unless the user explicitly typed a non-default
          // value (anything other than the wizard's `ip=dhcp` default).
          // Without this, IPAM-managed VNets (no DHCP server) leave the VM
          // hanging at systemd-networkd-wait-online.
          const userIpconfig0 = (ci.ipconfig0 || '').trim()
          const userPickedDefault = userIpconfig0 === '' || userIpconfig0 === 'ip=dhcp'
          const effectiveIpconfig0 = ipamIpconfig0 && userPickedDefault ? ipamIpconfig0 : ci.ipconfig0

          if (effectiveIpconfig0) {
            // Sanitize: trim spaces around commas (PVE rejects " ip" vs "ip")
            const sanitized = effectiveIpconfig0.split(',').map((s: string) => s.trim()).filter(Boolean).join(',')

            ciParts.push(`ipconfig0=${encodeURIComponent(sanitized)}`)
          }


          // Same logic for DNS — let the subnet's resolvers in unless the
          // user already pointed at a specific server.
          const effectiveNameserver = ci.nameserver || (ipamDns.length > 0 ? ipamDns.join(' ') : '')

          if (effectiveNameserver) ciParts.push(`nameserver=${encodeURIComponent(effectiveNameserver)}`)
          if (ci.searchdomain) ciParts.push(`searchdomain=${encodeURIComponent(ci.searchdomain)}`)

          if (ciParts.length > 0) {
            await pveFetch<any>(
              conn,
              `/nodes/${encodeURIComponent(body.node)}/qemu/${body.vmid}/config`,
              {
                method: "PUT",
                body: ciParts.join('&'),
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
              } as any
            )
          }
        }

        // Step 4: Resize disk if needed
        const diskSizeNum = Number.parseInt(hw.diskSize)

        if (diskSizeNum > 0) {
          await pveFetch<any>(
            conn,
            `/nodes/${encodeURIComponent(body.node)}/qemu/${body.vmid}/resize`,
            {
              method: "PUT",
              body: new URLSearchParams({ disk: "scsi0", size: hw.diskSize }),
            }
          )
        }

        // Step 5: Start VM
        await updateDeployment(deployment.id, "starting", { taskUpid: null })

        await pveFetch<any>(
          conn,
          `/nodes/${encodeURIComponent(body.node)}/qemu/${body.vmid}/status/start`,
          { method: "POST" }
        )

        // Done!
        await updateDeployment(deployment.id, "completed")

        // Audit
        const { audit } = await import("@/lib/audit")

        await audit({
          action: "create",
          category: "templates",
          resourceType: "vm",
          resourceId: String(body.vmid),
          resourceName: body.vmName || `${image.slug}-${body.vmid}`,
          details: { imageSlug: body.imageSlug, node: body.node, connectionId: body.connectionId },
          status: "success",
        })
      } catch (err: any) {
        // Roll back the IPAM allocation when the deploy pipeline fails after
        // we've claimed an IP — otherwise it sits reserved against a VM
        // that never finished creating (or got cleaned up by PVE on error).
        if (ipamAllocation) {
          try {
            await releaseIp({
              subnetId: ipamAllocation.subnetId,
              ip: ipamAllocation.ip,
            })
          } catch { /* tolerate */ }
        }

        await updateDeployment(deployment.id, "failed", { error: err?.message || String(err) })
      }
    })

    // Return immediately — the pipeline runs in after()
    return NextResponse.json({ data: { deploymentId: deployment.id, status: "pending", vmid: body.vmid } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * ISO deployment pipeline. Creates a stopped VM with:
 *  - empty data disk on `body.storage`
 *  - boot ISO mounted on ide2 from `body.isoStorage`
 *  - SeaBIOS or OVMF+efidisk0 (pre-enrolled-keys=1 for Windows Secure Boot)
 *  - q35 machine, std VGA (graphical install via noVNC)
 *
 * The VM is NOT started — the user runs the installer manually.
 */
async function runIsoDeploy(args: {
  deploymentId: string
  conn: any
  body: any
  image: any
  isCustom: boolean
  sourceType: string
  volumeId: string | null
  vdcInfo: { poolName?: string | null } | null

  /** Optional sink the caller fills in once we've claimed an IP — lets
   *  the parent's try/catch release the reservation if any later step
   *  throws (waitForTask timeout, audit failure, etc.). */
  onIpamAllocation?: (alloc: { subnetId: string; ip: string }) => void
}): Promise<void> {
  const { deploymentId, conn, body, image, isCustom, sourceType, volumeId, vdcInfo, onIpamAllocation } = args
  const hw = body.hardware
  const isoStorage: string = body.isoStorage

  // ── Step 1: Resolve / download the ISO ──
  await updateDeployment(deploymentId, "downloading")

  let isoVolume: string

  if (sourceType === 'volume' && volumeId) {
    // ISO already on a PVE storage. Keep its volid as-is — PVE accepts
    // `<storage>:iso/<file>.iso` directly on the ide2 line.
    isoVolume = volumeId
  } else {
    // URL mode: download to the user-selected ISO storage with content=iso.
    const rawFilename = isCustom
      ? `${image.slug}.iso`
      : (image.downloadUrl?.split("/").pop() || `${image.slug}.iso`)

    const isoFilename = rawFilename.toLowerCase().endsWith('.iso') ? rawFilename : `${rawFilename}.iso`

    const isoStorageConfig = await pveFetch<any>(
      conn,
      `/storage/${encodeURIComponent(isoStorage)}`
    )

    const isoContent = String(isoStorageConfig?.content || '')

    if (!isoContent.split(',').map((s: string) => s.trim()).includes('iso')) {
      throw new Error(
        `Storage '${isoStorage}' is not configured for ISO images ` +
        `(content="${isoContent || 'unknown'}"). Pick another ISO-capable storage in your vDC.`
      )
    }

    // Skip download if the ISO is already there
    const existing = await pveFetch<any[]>(
      conn,
      `/nodes/${encodeURIComponent(body.node)}/storage/${encodeURIComponent(isoStorage)}/content?content=iso`
    ).catch(() => [])

    const alreadyPresent = (existing || []).some(
      (item: any) => item.volid?.endsWith(`:iso/${isoFilename}`) || item.volid?.endsWith(`/${isoFilename}`)
    )

    if (!alreadyPresent) {
      const downloadParams = new URLSearchParams({
        url: image.downloadUrl,
        content: "iso",
        filename: isoFilename,
        node: body.node,
        storage: isoStorage,
        "verify-certificates": "0",
      })

      const downloadResult = await pveFetch<any>(
        conn,
        `/nodes/${encodeURIComponent(body.node)}/storage/${encodeURIComponent(isoStorage)}/download-url`,
        { method: "POST", body: downloadParams }
      )

      if (downloadResult) {
        await updateDeployment(deploymentId, "downloading", { taskUpid: String(downloadResult) })
        await waitForTask(conn, body.node, String(downloadResult))
      }
    }

    isoVolume = `${isoStorage}:iso/${isoFilename}`
  }

  // ── Step 2: Create VM with empty disk + ISO on ide2 ──
  await updateDeployment(deploymentId, "creating", { taskUpid: null })

  const diskSizeGb = String(hw.diskSize).replace(/G$/i, '') // "32G" → "32"
  const useUefi = hw.bios === 'ovmf'

  // ── IPAM reservation for ISO mode ──
  // PVE auto-generates a MAC unless we pin one. For ISO installs on an
  // IPAM-managed VNet, we need a deterministic MAC so the IPAM row stays
  // in lock-step with whatever the tenant types into the OS installer.
  // The wizard pre-allocates the IP and MAC client-side and submits them
  // here as `staticIp` / `staticMac`; we then claim them in the IPAM with
  // a hint.
  let isoNetSpec = `${hw.networkModel},bridge=${hw.networkBridge}${hw.vlanTag ? `,tag=${hw.vlanTag}` : ""}`
  let isoIpamAlloc: { subnetId: string; ip: string } | null = null
  const isoSubnet = await resolveSubnetForBridge(body.connectionId, hw.networkBridge)

  if (isoSubnet) {
    if (!body.staticIp) {
      throw new Error('Static IP is required when deploying an ISO into an IPAM-managed VNet — pass staticIp in the request body')
    }

    const isoMac = body.staticMac || generatePveMacAddress()

    const externalScanned = await scanUsedIpsForSubnet({
      conn,
      vdcPoolName: isoSubnet.pvePoolName,
      vnetPveName: isoSubnet.pveName,
      subnetId: isoSubnet.subnetId,
      connectionId: body.connectionId,
    })

    const allocated = await allocateIp({
      vdcId: isoSubnet.vdcId,
      subnetId: isoSubnet.subnetId,
      vnetId: isoSubnet.vnetId,
      connectionId: body.connectionId,
      mac: isoMac,
      vmid: body.vmid,
      hostname: body.vmName || `vm-${body.vmid}`,
      hint: body.staticIp,
      externalIps: scannedToIntSet(externalScanned),
    })

    isoIpamAlloc = { subnetId: isoSubnet.subnetId, ip: allocated.ip }
    isoNetSpec = `${hw.networkModel}=${isoMac},bridge=${hw.networkBridge}${hw.vlanTag ? `,tag=${hw.vlanTag}` : ""}`
    onIpamAllocation?.(isoIpamAlloc)
  }

  const createParams = new URLSearchParams({
    vmid: String(body.vmid),
    name: body.vmName || `${image.slug}-${body.vmid}`,
    ostype: hw.ostype,
    cores: String(hw.cores),
    sockets: String(hw.sockets),
    memory: String(hw.memory),
    cpu: hw.cpu,
    scsihw: hw.scsihw,

    // Empty data disk (no import-from). Format defaults to qcow2 on
    // file-based storage; on block-based storage PVE picks raw automatically.
    scsi0: `${body.storage}:${diskSizeGb}`,
    net0: isoNetSpec,

    // Boot ISO on the secondary IDE bus (PVE convention for install media).
    ide2: `${isoVolume},media=cdrom`,

    // CD-ROM first, fall back to the empty disk once the OS is installed.
    boot: 'order=ide2;scsi0',

    // Graphical install — VNC console. Serial0/serial0 (used by cloud-init)
    // would leave Windows install with no usable display.
    vga: 'std',
    agent: hw.agent ? "1" : "0",

    // q35 is mandatory for OVMF and a sensible default for modern guests
    // (PCIe, NVMe, VirtIO 1.x). Forced silently per spec.
    machine: 'q35',
  })

  if (useUefi) {
    createParams.set('bios', 'ovmf')

    // pre-enrolled-keys=1 ships the Microsoft Secure Boot keys into the
    // EFI vars from the start — required for Windows 11 / Server 2025.
    // efitype=4m matches OVMF_VARS_4M used by PVE.
    createParams.set('efidisk0', `${body.storage}:1,efitype=4m,pre-enrolled-keys=1`)
  }

  if (vdcInfo?.poolName) {
    createParams.set('pool', vdcInfo.poolName)
  }

  const createResult = await pveFetch<any>(
    conn,
    `/nodes/${encodeURIComponent(body.node)}/qemu`,
    { method: "POST", body: createParams }
  )

  if (createResult) {
    await updateDeployment(deploymentId, "creating", { taskUpid: String(createResult) })
    await waitForTask(conn, body.node, String(createResult))
  }

  // ── Step 3: Done — VM stays stopped, user installs via console ──
  await updateDeployment(deploymentId, "completed", { taskUpid: null })

  const { audit } = await import("@/lib/audit")

  await audit({
    action: "create",
    category: "templates",
    resourceType: "vm",
    resourceId: String(body.vmid),
    resourceName: body.vmName || `${image.slug}-${body.vmid}`,
    details: {
      imageSlug: body.imageSlug,
      node: body.node,
      connectionId: body.connectionId,
      mode: 'iso',
      bios: useUefi ? 'ovmf' : 'seabios',
    },
    status: "success",
  })
}
