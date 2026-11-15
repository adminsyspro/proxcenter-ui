/**
 * Added downtime of a guest conversion at warm cutover (#1000), shared by the
 * engine (projected downtime) and the "Cutover now" dialog. Kept apart from
 * guest-conversion.ts, which reaches the node over SSH and must stay out of
 * client bundles. The bare conversion measured 41 to 64 s per guest with
 * virt-v2v 2.6.0; from "source off" to "target attached" a cutover spends 95 to
 * 100 s in it (Debian 13 on XCP-ng, Windows Server 2022 on vCenter, 14/11/2026),
 * overlays and VirtIO driver injection included. At 60 s the automatic cutover
 * accepted a 2 min budget and then missed it by 10 to 15 s.
 */
export const GUEST_CONVERSION_ESTIMATE_SEC = 100
