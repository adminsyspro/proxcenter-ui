/*
   Installation of ceph-exporter on a Ceph node (verified on the lab, Ceph 20 / PVE 9). Without the
   drop-in the unit fails with "unable to find a keyring ... ceph.client.<node>.keyring: Permission denied".
   Shown as is in the OSD sheet, with a copy button; not translated (shell commands).
*/
export const CEPH_EXPORTER_INSTALL_STEPS = `apt install ceph-exporter
mkdir -p /etc/systemd/system/ceph-exporter@.service.d
cat > /etc/systemd/system/ceph-exporter@.service.d/no-mon-config.conf <<'X'
[Service]
ExecStart=
ExecStart=/usr/bin/ceph-exporter -f --id %i --no-mon-config --sock-dir /var/run/ceph --setuser ceph --setgroup ceph
X
systemctl daemon-reload && systemctl enable --now ceph-exporter@$(hostname)`
