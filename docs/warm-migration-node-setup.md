# Preparing a Proxmox node for Warm Migration

Warm migration (VMware to Proxmox, with no in-transit data loss) keeps the source
VM running while ProxCenter reads its disks over VMware's VDDK and writes the
changed blocks to a block-storage target on the Proxmox node. Each Proxmox node
that will receive a warm migration needs a small runtime installed once.

ProxCenter does not install this for you: the migrate dialog runs a go/no-go
preflight against the node you pick and blocks the launch until the runtime is in
place. This guide covers that one-time preparation. Run every command as root on
each target Proxmox node.

## What the node needs

| Component | Source | Notes |
| --- | --- | --- |
| `nbdkit` | Debian main | The NBD server. |
| `nbd-client` | Debian main | Attaches the NBD device on the node. |
| `nbdkit-plugin-vddk` | Debian non-free | Not enabled on a stock node (see step 2). |
| Broadcom VDDK (`libvixDiskLib.so*`) | Broadcom (EULA) | Installed under `/usr/lib/vmware-vix-disklib/lib64`. |
| `nbd` kernel module | in-tree | Loaded with `max_part=0`. |

Two more requirements that are not installed but must hold:

- **Block-storage target.** Warm migration patches the target by byte offset, which
  is only valid on a raw block device. The target storage must be LVM, LVM-thin,
  ZFS, or Ceph RBD. File-based storage (a directory or NFS holding qcow2) is not
  supported; use a cold migration for those.
- **Network.** The Proxmox node must reach the ESXi host on TCP 443 and 902. The
  VDDK transport from a Proxmox node uses NFC, which opens 902 in addition to the
  443 management port.

## 1. Install nbdkit and nbd-client (Debian main)

```bash
apt-get update
apt-get install -y nbdkit nbd-client
```

On a node without a Proxmox subscription, `apt-get update` may exit with a 401 on
the `enterprise.proxmox.com` repository. That is harmless for this step, since
these two packages come from the Debian repositories. If you want a clean update,
switch the node to the no-subscription repo first:

```bash
sed -i 's|^deb https://enterprise.proxmox.com|# &|' /etc/apt/sources.list.d/pve-enterprise.list 2>/dev/null || true
echo "deb http://download.proxmox.com/debian/pve $(. /etc/os-release && echo "$VERSION_CODENAME") pve-no-subscription" \
  > /etc/apt/sources.list.d/pve-no-subscription.list
apt-get update
```

## 2. Install the nbdkit VDDK plugin (Debian non-free)

`nbdkit-plugin-vddk` lives in Debian's `non-free` component, which a stock Proxmox
node does not enable. Add `contrib non-free`, then install the plugin:

```bash
. /etc/os-release
echo "deb http://deb.debian.org/debian ${VERSION_CODENAME} contrib non-free non-free-firmware" \
  > /etc/apt/sources.list.d/proxcenter-nonfree.list
apt-get update
apt-get install -y nbdkit-plugin-vddk
```

(Adjust the mirror or codename if your node uses a custom Debian mirror.)

## 3. Install the Broadcom VDDK

The Virtual Disk Development Kit is distributed by Broadcom under their own
license, so ProxCenter cannot bundle or redistribute it. Download it once and
install it on each node.

1. Download the VDDK for **Linux x86_64** from Broadcom (a Broadcom account and
   acceptance of their EULA are required):
   https://developer.broadcom.com/sdks/vmware-virtual-disk-development-kit-vddk/latest/

2. Copy the tarball to the node and extract it into the default libdir
   (`/usr/lib/vmware-vix-disklib`):

   ```bash
   mkdir -p /usr/lib/vmware-vix-disklib
   tar -xzf vmware-vix-disklib-*.tar.gz -C /tmp
   cp -a /tmp/vmware-vix-disklib-distrib/. /usr/lib/vmware-vix-disklib/
   rm -rf /tmp/vmware-vix-disklib-distrib
   ```

3. nbdkit 1.42 (Debian 13 / PVE 9) loads the `libvixDiskLib.so.8` SONAME. VDDK 9.x
   ships `libvixDiskLib.so.9` (ABI compatible), so add a symlink. VDDK 8.0.x ships
   `.so.8` directly and needs no symlink.

   ```bash
   if [ -e /usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9 ] \
      && [ ! -e /usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.8 ]; then
     ln -sf libvixDiskLib.so.9 /usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.8
   fi
   ldconfig
   ```

## 4. Load the nbd kernel module

```bash
modprobe nbd max_part=0
echo nbd > /etc/modules-load.d/proxcenter-nbd.conf
printf 'options nbd max_part=0\n' > /etc/modprobe.d/proxcenter-nbd.conf
```

## 5. Verify

The strongest single check loads the plugin and dlopens the VDDK library in one go:

```bash
nbdkit vddk libdir=/usr/lib/vmware-vix-disklib --dump-plugin
```

It should print the plugin's version block with no error. If it complains about a
missing `libvixDiskLib.so.8`, revisit the symlink in step 3.

Then confirm from ProxCenter: open the migrate dialog for a VMware VM, choose
**Warm Migration** and pick this node as the target. The dialog reports
**"Target node is ready for warm migration"** when everything above is present, or
lists whatever is still missing (and blocks the launch until it is resolved).

## Using a non-default libdir

The engine and the preflight both accept a custom VDDK libdir, but the migrate
dialog uses the default `/usr/lib/vmware-vix-disklib`. Install under that path
unless you have a specific reason not to.
