import { describe, expect, it } from "vitest"

import { DrainConfigError, sanitizeDrainConfig } from "./config"

describe("sanitizeDrainConfig (#248)", () => {
  it("keeps the known settings with their types, and drops everything else", () => {
    expect(sanitizeDrainConfig({
      target_node: "pve2", exclude_nodes: ["pve1"], max_concurrent_migrations: 3, migration_timeout: 600,
      mem_ceiling_percent: 85, include_stopped: false, enter_maintenance: true,
      ssh_credentials: { sshPassword: "forged" }, ssh_overrides: { pve3: { address: "6.6.6.6" } }, anything: "x",
    })).toEqual({
      target_node: "pve2", exclude_nodes: ["pve1"], max_concurrent_migrations: 3, migration_timeout: 600,
      mem_ceiling_percent: 85, include_stopped: false, enter_maintenance: true,
    })
  })

  it("reads no config, or an empty target, as automatic defaults", () => {
    expect(sanitizeDrainConfig(undefined)).toEqual({})
    expect(sanitizeDrainConfig(null)).toEqual({})
    expect(sanitizeDrainConfig({ target_node: "" })).toEqual({})
  })

  it.each([
    [[1, 2], "config must be an object"],
    ["x", "config must be an object"],
    [{ target_node: "pve2; reboot" }, "target_node is not a valid node name"],
    [{ exclude_nodes: "pve1" }, "exclude_nodes must be a list"],
    [{ exclude_nodes: ["../etc"] }, "exclude_nodes is not a valid node name"],
    [{ max_concurrent_migrations: 9 }, "max_concurrent_migrations must be an integer between 1 and 5"],
    [{ mem_ceiling_percent: 10 }, "mem_ceiling_percent must be an integer between 50 and 100"],
    [{ migration_timeout: 1.5 }, "migration_timeout must be an integer"],
    [{ include_stopped: "yes" }, "include_stopped must be true or false"],
    [{ enter_maintenance: 1 }, "enter_maintenance must be true or false"],
  ])("refuses %j", (raw, message) => {
    expect(() => sanitizeDrainConfig(raw)).toThrow(DrainConfigError)
    expect(() => sanitizeDrainConfig(raw)).toThrow(message)
  })
})

describe("sanitizeDrainConfig, the edited plan (#248)", () => {
  it("keeps a target per guest and the guests left on the node", () => {
    expect(sanitizeDrainConfig({ guest_targets: { 105: "pve1", "92481": "pve2" }, keep_vmids: [92483] }))
      .toEqual({ guest_targets: { 105: "pve1", 92481: "pve2" }, keep_vmids: [92483] })
  })

  it.each([
    [{ guest_targets: ["pve1"] }, "guest_targets must map VMIDs to node names"],
    [{ guest_targets: { abc: "pve1" } }, "guest_targets holds an invalid VMID"],
    [{ guest_targets: { 105: "pve1;reboot" } }, "guest_targets is not a valid node name"],
    [{ keep_vmids: "105" }, "keep_vmids must be a list of VMIDs"],
    [{ keep_vmids: [0] }, "keep_vmids holds an invalid VMID"],
    [{ enter_maintenance: true, keep_vmids: [105] }, "guests cannot be left on a node entering maintenance"],
  ])("refuses %j", (raw, message) => {
    expect(() => sanitizeDrainConfig(raw)).toThrow(message)
  })
})
