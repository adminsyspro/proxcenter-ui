// PVE `PUT /qemu/{vmid}/config` is synchronous and can take ~10s on slow storage
// (e.g. ZFS-over-iSCSI). pveFetch's 8s default fires before the metadata write
// commits, and the abort then trips the failover circuit breaker, surfacing as a
// fake "all cluster nodes unreachable". Issue #332.
export const PVE_CONFIG_PUT_TIMEOUT_MS = 120_000
