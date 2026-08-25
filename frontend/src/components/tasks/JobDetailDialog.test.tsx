import { describe, it, expect, vi, afterEach } from "vitest"
import { render, screen, cleanup, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"

import JobDetailDialog, { isAtTail, logsAsText } from "./JobDetailDialog"

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("isAtTail", () => {
  it("counts a scroller parked at the bottom as following", () => {
    expect(isAtTail({ scrollHeight: 1000, scrollTop: 700, clientHeight: 300 })).toBe(true)
  })

  it("tolerates the few pixels a smooth scroll leaves behind", () => {
    expect(isAtTail({ scrollHeight: 1000, scrollTop: 690, clientHeight: 300 })).toBe(true)
  })

  it("stops following once the reader has scrolled up to an earlier line", () => {
    expect(isAtTail({ scrollHeight: 1000, scrollTop: 200, clientHeight: 300 })).toBe(false)
  })

  it("follows by default when there is no element yet", () => {
    expect(isAtTail(null)).toBe(true)
  })
})

describe("logsAsText", () => {
  it("formats each entry the way the panel prints it", () => {
    const ts = "2026-08-24T16:58:41.000Z"
    const text = logsAsText([
      { ts, msg: "Adopted vm-70011-disk-0.qcow2 (rename, no disk copy)", level: "success" },
      { ts, msg: "Disk 1 attached as scsi0", level: "info" },
    ])
    const stamp = new Date(ts).toLocaleTimeString()

    expect(text).toBe(
      `[${stamp}] Adopted vm-70011-disk-0.qcow2 (rename, no disk copy)\n[${stamp}] Disk 1 attached as scsi0`,
    )
  })

  it("carries the node of an entry that has one", () => {
    expect(logsAsText([{ message: "entering maintenance", node: "pve1" }])).toBe("[pve1] entering maintenance")
  })

  it("copies the WHOLE log, not just the 100 lines the panel renders", () => {
    const entries = Array.from({ length: 250 }, (_, i) => ({ msg: `line ${i}` }))
    const lines = logsAsText(entries).split("\n")

    expect(lines).toHaveLength(250)
    expect(lines[0]).toBe("line 0")
  })

  it("takes a bare string entry, which is what some sources return", () => {
    expect(logsAsText(["plain line"])).toBe("plain line")
  })
})

describe("JobDetailDialog logs panel", () => {
  const job = { id: "job-1", name: "Migration - NginX", type: "migration", status: "running", progress: 50 }
  const t = (key: string) => key

  it("copies the fetched log to the clipboard", async () => {
    const writeText = vi.fn(async () => {})
    Object.assign(navigator, { clipboard: { writeText } })
    const ts = "2026-08-24T16:58:41.000Z"
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { logs: [{ ts, msg: "Adopted the converted disk", level: "success" }] } }),
    })))

    render(
      <JobDetailDialog open job={job} onClose={() => {}} onAction={() => {}} actionError={null} isEnterprise t={t} />,
    )

    await waitFor(() => expect(screen.getByText(/Adopted the converted disk/)).toBeTruthy())
    await userEvent.click(screen.getByLabelText("common.copy"))

    expect(writeText).toHaveBeenCalledWith(`[${new Date(ts).toLocaleTimeString()}] Adopted the converted disk`)
  })

  it("offers no copy button while there is nothing to copy", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ data: { logs: [] } }) })))

    render(
      <JobDetailDialog open job={job} onClose={() => {}} onAction={() => {}} actionError={null} isEnterprise t={t} />,
    )

    await waitFor(() => expect(screen.getByText("jobsPage.noLogs")).toBeTruthy())
    expect(screen.queryByLabelText("common.copy")).toBeNull()
  })
})
