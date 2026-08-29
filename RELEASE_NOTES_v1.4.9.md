# ProxCenter v1.4.9

**The API reference inside the product, warm migration from XCP-ng, rolling updates you can watch and approve, PBS 4 compatibility, and one HA leader at a time.**

## Rolling updates

- **Live apt progress per node**, with the apt output on screen when a step fails.
- **Explicit manual approval** of each node, from the wizard or the Task Center, and cancel honoured while paused.
- **The parallel migrations setting is honoured**, and evacuated guests are spread by projected load and affinity rules.
- **Finished runs stay in the Task Center** with their full log, and a cancelled run reads cancelled.
- **The Ceph wait only holds on real recovery**, not on our own `noout` flag or unrelated warnings.
- **Nodes are reached on their management address**, never on a Corosync or Ceph network.
- **Repository preflight reads the Proxmox fields correctly**, and the enterprise-without-free-alternative check fires at last.
- **A 2 GB disk floor replaces the check that failed a 14 GB root with 4.8 GB free.**
- **Tooltips on every wizard parameter**, health tiles, and a sudoers warning about `NOPASSWD: ALL`.

## Migration

- **XCP-ng direct pool connections (XAPI)** alongside Xen Orchestra, and **warm migration from XCP-ng with CBT over NBD**.
- **XCP-ng Live mode is removed**: it never worked. Offline downloads survive a slow SSH poll and retry three times.
- **Hyper-V: inventory in one PowerShell call**, wrong credentials shown as an authentication error, disk paths on SMB shares resolved, retry on the right engine.
- **Compact OS Windows guests convert**: the `ntfs-3g` system-compression plugin is installed by the preflight.
- **Hyper-V and Nutanix guests keep their source CPU count and memory** instead of 1 vCPU and 2 GB.
- **Cold migrations to file storage write the disk once**: the converted image is adopted in place, temporary space drops from 2x to 1x.
- **Warm node preparation says it needs Proxmox VE 9** instead of dumping an apt transcript.
- **Install missing packages gets a 20 minute budget**, and a 401 on the enterprise repository no longer aborts Debian packages.

## Consoles

- **Fullscreen and scaling controls** on VNC and SPICE, remembered per console kind.
- **VM power actions in the SPICE console**: start, shutdown, stop, pause, with automatic reconnect.
- **Send-key menu and clipboard text on noVNC**, and keystrokes typed into a guest are no longer logged to the browser console.

## High availability and DRS

- **One orchestrator leader at a time**: the lock is taken on the Postgres primary only, and the pool refuses a hot standby (no more SQLSTATE 25006).
- **The DRS page is populated from any node**, metrics and recommendations are routed to the leader through a new `/api/v1/leader` probe.
- **A long HA preflight returns its verdict** instead of a false "Orchestrator unavailable", and a cut response is told apart from a dead orchestrator.
- **DRS migrations stranded at running after an orchestrator restart are settled automatically**, and the task footer shows the real percentage instead of 50 %.

## Site Recovery

- **A replication job continues past a failing VM** and lands in a new Partially synced status, with the failed VMs named.
- **A replicated VM carrying a Proxmox snapshot syncs again** instead of failing on `rbd: File exists`.
- **Alerts and reports know the partial status**, and the failure alert no longer flaps during a rerun.

## Backups and PBS

- **PBS 4.x compatibility**: package refresh, repository toggle, API token listing, S3 endpoints and prune jobs all work again.

## Network and notifications

- **Configuring sFlow succeeds**, reports per-node results, and is re-applied after a node reboot.
- **Flows are attributed by guest MAC** on SDN topologies.
- **Commas work in the default recipients field**, and a list saved glued by the semicolon workaround is repaired.

## Interface and API

- **The public API reference is rendered inside the product**, under Settings, with Try-it on your own instance.
- **Tooltips stay reachable on disabled buttons**, so the reason a button is unavailable is readable.
- **The storage overview table fills the page.**

## Dependencies

Twenty-five Dependabot updates batched, including undici 8 pinned to HTTP/1.1, cron-parser 5, dagre 3, react-resizable 4 and `@types/node` 26. New dependency: `@scalar/api-reference-react` for the API reference page.

## Upgrading

Pull the images. One schema migration ships with this release, applied by the frontend entrypoint at first boot: the XCP-ng connection sub-type, backfilled to Xen Orchestra for existing connections.

**HA clusters:** the DRS leader routing needs a new HAProxy frontend and the `ORCHESTRATOR_LEADER_URL` variable on each node, which an image pull does not add. Nothing breaks without them; the two edits are in the [HA documentation](https://docs.proxcenter.io/operations/ha-prerequisites).
