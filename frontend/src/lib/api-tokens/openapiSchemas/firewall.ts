// Request and response schemas of the firewall entries. The handlers forward
// the body to the orchestrator (or to Proxmox directly): documentation only.
import { STRINGS } from "./shared"

const ENABLE_01 = { type: "integer", enum: [0, 1] }
const LOG_LEVEL = { type: "string", enum: ["emerg", "alert", "crit", "err", "warning", "notice", "info", "debug", "nolog"] }
const POLICY = { type: "string", enum: ["ACCEPT", "DROP", "REJECT"] }

/** The rule fields Proxmox takes, as the handlers forward them. */
const RULE_FIELDS = {
  type: { type: "string", enum: ["in", "out", "group"] },
  action: { type: "string", description: "ACCEPT, DROP or REJECT; the security group name for a `group` rule" },
  enable: { ...ENABLE_01, description: "Defaults to 1 on a creation; through the orchestrator an explicit 0 is also created as 1" },
  source: { type: "string", description: "Address, CIDR, alias or +ipset" },
  dest: { type: "string", description: "Address, CIDR, alias or +ipset" },
  proto: { type: "string", description: "tcp, udp, icmp, ..." },
  dport: { type: "string", description: "Port, range or list" },
  sport: { type: "string", description: "Port, range or list" },
  iface: { type: "string", description: "Network interface, e.g. net0" },
  log: LOG_LEVEL,
  macro: { type: "string", description: "Proxmox firewall macro, e.g. SSH" },
  comment: { type: "string" },
}

const RULE = {
  type: "object",
  properties: { pos: { type: "integer" }, ...RULE_FIELDS, digest: { type: "string" } },
}

const OPTIONS = {
  type: "object",
  description: "As Proxmox returns it",
  additionalProperties: true,
  properties: {
    enable: ENABLE_01,
    policy_in: POLICY,
    policy_out: POLICY,
    log_level_in: LOG_LEVEL,
    log_level_out: LOG_LEVEL,
  },
}

export const FIREWALL_REQUEST_SCHEMAS: Record<string, Record<string, unknown>> = {
  FirewallRuleCreateRequest: {
    type: "object",
    required: ["type", "action"],
    properties: {
      ...RULE_FIELDS,
      group: { type: "string", description: "Security group name, for a `group` rule" },
      pos: { type: "integer", description: "Position to insert the rule at" },
    },
  },
  FirewallRuleUpdateRequest: {
    type: "object",
    description: "Absent fields keep their value; an optional field sent empty is cleared.",
    properties: {
      ...RULE_FIELDS,
      moveto: { type: "integer", description: "Move the rule to this position" },
    },
  },
  FirewallOptionsUpdateRequest: {
    type: "object",
    description: "Absent fields keep their value. log_level_in / log_level_out apply to node and guest firewalls.",
    properties: {
      enable: ENABLE_01,
      policy_in: POLICY,
      policy_out: POLICY,
      log_level_in: LOG_LEVEL,
      log_level_out: LOG_LEVEL,
    },
  },
  FirewallAliasCreateRequest: {
    type: "object",
    required: ["name", "cidr"],
    properties: {
      name: { type: "string" },
      cidr: { type: "string", description: "Address or CIDR" },
      comment: { type: "string" },
    },
  },
  FirewallAliasUpdateRequest: {
    type: "object",
    required: ["cidr"],
    properties: {
      cidr: { type: "string", description: "Address or CIDR" },
      comment: { type: "string" },
    },
  },
  FirewallIpsetCreateRequest: {
    type: "object",
    required: ["name"],
    properties: { name: { type: "string" }, comment: { type: "string" } },
  },
  FirewallIpsetEntryCreateRequest: {
    type: "object",
    required: ["cidr"],
    properties: {
      cidr: { type: "string", description: "Address, CIDR or alias" },
      comment: { type: "string" },
      nomatch: { type: "boolean", description: "Exclude this entry from the set" },
    },
  },
  FirewallGroupCreateRequest: {
    type: "object",
    required: ["group"],
    properties: { group: { type: "string" }, comment: { type: "string" } },
  },
  FirewallMicrosegBaseGenerateRequest: {
    type: "object",
    properties: {
      dry_run: { type: "boolean", description: "Only return the plan" },
      networks: { ...STRINGS, description: "Network aliases (net-*) to cover; all when empty" },
      gateway_offset: { type: "integer", description: "Host part of the gateway address (default 254)" },
      create_gateways: { type: "boolean", description: "Also create the missing gw-* aliases" },
    },
  },
  FirewallVmIsolateRequest: {
    type: "object",
    properties: {
      enable_firewall: { type: "boolean" },
      set_policy_in_drop: { type: "boolean" },
      set_policy_out_drop: { type: "boolean" },
      apply_base_sgs: {
        type: "boolean",
        description: "Apply the sg-base-* group of each guest network, creating a missing one (and its gw-* alias). Refused to a vDC tenant token: 403",
      },
      additional_sgs: { ...STRINGS, description: "Other security groups to apply" },
      enable_nic_fw: { type: "boolean", description: "Set firewall=1 on every NIC" },
    },
  },
  FirewallVmNicFirewallUpdateRequest: {
    type: "object",
    required: ["enable"],
    properties: { enable: { type: "boolean" } },
  },
}

export const FIREWALL_RESPONSE_SCHEMAS: Record<string, Record<string, unknown>> = {
  FirewallStatusResponse: {
    type: "object",
    properties: { status: { type: "string", enum: ["created", "updated", "deleted"] } },
  },
  FirewallOptionsOrRulesResponse: {
    description: "The options object, or the rule array with `type=rules`",
    oneOf: [OPTIONS, { type: "array", items: RULE }],
  },
  FirewallAliasesResponse: {
    type: "array",
    items: {
      type: "object",
      properties: { name: { type: "string" }, cidr: { type: "string" }, comment: { type: "string" }, digest: { type: "string" } },
    },
  },
  FirewallGroupsResponse: {
    type: "array",
    items: {
      type: "object",
      properties: { group: { type: "string" }, comment: { type: "string" }, digest: { type: "string" }, rules: { type: "array", items: RULE } },
    },
  },
  FirewallIpsetsResponse: {
    type: "array",
    items: {
      type: "object",
      properties: {
        name: { type: "string" },
        comment: { type: "string" },
        digest: { type: "string" },
        members: {
          type: "array",
          items: {
            type: "object",
            properties: { cidr: { type: "string" }, comment: { type: "string" }, nomatch: { type: "boolean" } },
          },
        },
      },
    },
  },
  FirewallMicrosegBaseGenerateResponse: {
    type: "object",
    properties: {
      created_aliases: STRINGS,
      created_groups: STRINGS,
      errors: STRINGS,
      dry_run: { type: "boolean" },
      plan: {
        type: "array",
        description: "Dry run only",
        items: {
          type: "object",
          properties: { type: { type: "string", enum: ["alias", "security_group"] }, name: { type: "string" }, description: { type: "string" } },
        },
      },
    },
  },
  FirewallVmIsolateResponse: {
    type: "object",
    properties: {
      success: { type: "boolean" },
      applied_sgs: STRINGS,
      enabled_nics: STRINGS,
      actions: STRINGS,
      errors: STRINGS,
    },
  },
}
