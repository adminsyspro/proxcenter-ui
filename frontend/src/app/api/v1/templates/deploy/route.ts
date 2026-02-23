// src/app/api/v1/templates/deploy/route.ts
import { NextResponse, after } from "next/server"
import { getServerSession } from "next-auth"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { deploySchema } from "@/lib/schemas"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { getImageBySlug } from "@/lib/templates/cloudImages"

export const runtime = "nodejs"

type DeploymentStatus = "pending" | "downloading" | "creating" | "configuring" | "starting" | "completed" | "failed"

async function updateDeployment(id: string, status: DeploymentStatus, extra: Record<string, any> = {}) {
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
    const image = getImageBySlug(body.imageSlug)
    if (!image) {
      return NextResponse.json({ error: "Unknown image slug" }, { status: 400 })
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
        config: JSON.stringify({
          storage: body.storage,
          vmName: body.vmName,
          hardware: body.hardware,
          cloudInit: body.cloudInit,
        }),
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
          hardware: JSON.stringify(body.hardware),
          cloudInit: body.cloudInit ? JSON.stringify(body.cloudInit) : null,
          createdBy: session?.user?.id || null,
        },
      }).catch(() => {}) // Non-blocking
    }

    // Run the deployment pipeline asynchronously after the response is sent
    after(async () => {
      try {
        // Step 1: Download image to storage (skip if already present)
        await updateDeployment(deployment.id, "downloading")

        const rawFilename = image.downloadUrl.split("/").pop() || `${image.slug}.${image.format}`
        // PVE import content type requires .qcow2/.raw/.vmdk extension — rename .img to .qcow2
        const urlFilename = rawFilename.replace(/\.img$/, ".qcow2")

        // Ensure storage has 'import' content type enabled (required for import-from)
        const storageConfig = await pveFetch<any>(
          conn,
          `/storage/${encodeURIComponent(body.storage)}`
        )
        const currentContent = String(storageConfig?.content || "")
        if (!currentContent.split(",").map((s: string) => s.trim()).includes("import")) {
          const newContent = currentContent ? `${currentContent},import` : "import"
          await pveFetch<any>(
            conn,
            `/storage/${encodeURIComponent(body.storage)}`,
            { method: "PUT", body: new URLSearchParams({ content: newContent }) }
          )
        }

        // Check if image already exists on PVE storage (import content type)
        const storageContents = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(body.node)}/storage/${encodeURIComponent(body.storage)}/content?content=import`
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
            storage: body.storage,
            "verify-certificates": "0",
          })

          const downloadResult = await pveFetch<any>(
            conn,
            `/nodes/${encodeURIComponent(body.node)}/storage/${encodeURIComponent(body.storage)}/download-url`,
            { method: "POST", body: downloadParams }
          )

          // If download returned a task UPID, wait for it to complete
          if (downloadResult) {
            const upid = typeof downloadResult === "string" ? downloadResult : downloadResult
            await updateDeployment(deployment.id, "downloading", { taskUpid: String(upid) })
            await waitForTask(conn, body.node, String(upid))
          }
        }

        const importVolume = `${body.storage}:import/${urlFilename}`

        // Step 2: Create VM with imported disk
        await updateDeployment(deployment.id, "creating")

        const hw = body.hardware

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
          net0: `${hw.networkModel},bridge=${hw.networkBridge}${hw.vlanTag ? `,tag=${hw.vlanTag}` : ""}`,
          ide2: `${body.storage}:cloudinit`,
          boot: "order=scsi0",
          serial0: "socket",
          vga: "serial0",
          agent: hw.agent ? "1" : "0",
        })

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
          // Build body manually — PVE expects ipconfig values with raw "=" signs,
          // and sshkeys to be URL-encoded once (PVE decodes internally).
          // URLSearchParams double-encodes "=" in values which breaks ipconfig parsing.
          const ciParts: string[] = []
          if (ci.ciuser) ciParts.push(`ciuser=${encodeURIComponent(ci.ciuser)}`)
          if (ci.sshKeys) ciParts.push(`sshkeys=${encodeURIComponent(ci.sshKeys)}`)
          if (ci.ipconfig0) {
            // Sanitize: trim spaces around commas (PVE rejects " ip" vs "ip")
            const sanitized = ci.ipconfig0.split(',').map((s: string) => s.trim()).filter(Boolean).join(',')
            ciParts.push(`ipconfig0=${encodeURIComponent(sanitized)}`)
          }
          if (ci.nameserver) ciParts.push(`nameserver=${encodeURIComponent(ci.nameserver)}`)
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
        const diskSizeNum = parseInt(hw.diskSize)
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
        await updateDeployment(deployment.id, "failed", { error: err?.message || String(err) })
      }
    })

    // Return immediately — the pipeline runs in after()
    return NextResponse.json({ data: { deploymentId: deployment.id, status: "pending", vmid: body.vmid } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/** Poll a PVE task until it completes or fails */
async function waitForTask(
  conn: { baseUrl: string; apiToken: string; insecureDev: boolean; id: string },
  node: string,
  upid: string,
  timeoutMs = 240000
): Promise<void> {
  const start = Date.now()
  const interval = 3000

  while (Date.now() - start < timeoutMs) {
    const status = await pveFetch<any>(
      conn,
      `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`
    )

    if (status?.status === "stopped") {
      if (status.exitstatus === "OK") return
      throw new Error(`PVE task failed: ${status.exitstatus || "unknown error"}`)
    }

    await new Promise(r => setTimeout(r, interval))
  }

  throw new Error(`PVE task timed out after ${timeoutMs / 1000}s`)
}
