/**
 * Added downtime of a guest conversion at warm cutover (#1000), shared by the
 * engine (projected downtime) and the "Cutover now" dialog. Kept apart from
 * guest-conversion.ts, which reaches the node over SSH and must stay out of
 * client bundles. Measured on the lab: 41 to 64 s per guest with virt-v2v 2.6.0.
 */
export const GUEST_CONVERSION_ESTIMATE_SEC = 60
