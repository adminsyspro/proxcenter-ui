/**
 * Pure builders for the shell commands the migration pipelines run on a Proxmox
 * node, and through it on an ESXi host.
 *
 * Names reported by the source hypervisor (datastore names, disk paths, VM
 * names) and paths derived from request data used to be interpolated into
 * double-quoted command strings. Inside double quotes the remote shell still
 * expands `$(...)`, backticks, `\` and `"`, so an unusual name was executed as
 * shell on the node, and in the nested `ssh host "..."` form a second time on
 * the ESXi host. Every value that is not a constant or a checked integer goes
 * through shellEscape() here, and a nested remote command is escaped once more
 * as a whole so it reaches the far shell as one argument.
 *
 * Kept free of I/O so each builder can be checked with a real shell in tests.
 */
import { shellEscape } from "@/lib/ssh/exec"

const q = shellEscape

/** The decimal process id a `... & echo $!` launch prints, or null for anything else. */
export function parseBackgroundPid(output: string | undefined | null): string | null {
  const s = (output ?? "").trim()
  return /^\d{1,10}$/.test(s) ? s : null
}

function tcpPort(port: number | string): number {
  const p = Number(port)
  if (!Number.isInteger(p) || p < 1 || p > 65535) throw new Error(`Invalid SSH port: ${JSON.stringify(port)}`)
  return p
}

/** ESXi path of a disk file as vCenter reports it: `/vmfs/volumes/<datastore>/<relative path>`. */
export function vmfsPath(datastoreName: string, relativePath: string): string {
  return `/vmfs/volumes/${datastoreName}/${relativePath}`
}

/**
 * `<ssh prefix> -p <port> user@host '<remote command>'`: the login and the whole
 * remote command are one word each for the node's shell, and the remote command
 * is parsed again by the ESXi shell with its own quoting intact.
 */
export function esxiSshCommand(sshPrefix: string, port: number | string, user: string, host: string, remoteCommand: string): string {
  return `${sshPrefix} -p ${tcpPort(port)} ${q(`${user}@${host}`)} ${q(remoteCommand)}`
}

/**
 * Same, authenticated with sshpass from the environment. The export and the ssh
 * run in one node-side command so the password never appears on a command line.
 */
export function sshpassEsxiCommand(password: string, sshOpts: string, port: number | string, user: string, host: string, remoteCommand: string): string {
  return `export SSHPASS=${q(password)} && sshpass -e ssh ${sshOpts} -p ${tcpPort(port)} ${q(`${user}@${host}`)} ${q(remoteCommand)} 2>&1`
}

/** Key-based login probe used right after a temporary key was deployed. */
export function esxiKeyLoginProbeCommand(keyPath: string, sshOpts: string, port: number | string, user: string, host: string): string {
  return `ssh -i ${q(keyPath)} ${sshOpts} -p ${tcpPort(port)} ${q(`${user}@${host}`)} 'echo KEYOK' 2>&1`
}

// ── Commands run on the ESXi host ──

/** vmkfstools thin clone of a (possibly locked) descriptor into a new VMDK. */
export function vmkfstoolsCloneCommand(descriptorPath: string, cloneVmdkPath: string): string {
  return `vmkfstools -i ${q(descriptorPath)} ${q(cloneVmdkPath)} -d thin`
}

export function vmkfstoolsDeleteCommand(vmdkPath: string): string {
  return `vmkfstools -U ${q(vmdkPath)}`
}

/** Size in bytes of a file, 0 when it does not exist yet. */
export function fileSizeCommand(path: string): string {
  return `stat -c %s ${q(path)} 2>/dev/null || echo 0`
}

/** Stream a file to stdout. */
export function ddReadCommand(path: string): string {
  return `dd if=${q(path)} bs=4M`
}

export function readlinkCommand(path: string): string {
  return `readlink -f ${q(path)}`
}

export function listDirCommand(path: string): string {
  return `ls -la ${q(path)}`
}

/**
 * Append a public key to the ESXi user's authorized_keys. ESXi keeps them under
 * /etc/ssh/keys-<user>/ by default; some images use ~/.ssh instead.
 */
export function authorizedKeysDeployCommand(user: string, pubKey: string, location: "etc" | "home"): string {
  if (location === "etc") {
    const dir = `/etc/ssh/keys-${user}`
    return `mkdir -p ${q(dir)} 2>/dev/null; echo ${q(pubKey)} >> ${q(`${dir}/authorized_keys`)}; echo DEPLOYED`
  }
  return `mkdir -p ~/.ssh 2>/dev/null; chmod 700 ~/.ssh; echo ${q(pubKey)} >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; echo DEPLOYED`
}

/**
 * Remove the lines holding `keyMaterial` (a slice of the key's base64 body) from
 * both authorized_keys locations, then print `marker`.
 */
export function authorizedKeysRevokeCommand(user: string, keyMaterial: string, marker = "REVOKED"): string {
  // Basic regular expression specials, with `/` for the sed delimiter.
  const pattern = keyMaterial.replaceAll(/[\\/&.^$*[\]]/g, "\\$&")
  return `sed -i ${q(`/${pattern}/d`)} ${q(`/etc/ssh/keys-${user}/authorized_keys`)} ~/.ssh/authorized_keys 2>/dev/null; echo ${q(marker)}`
}

// ── Commands run on the Proxmox node ──

export function fileExistsCommand(path: string): string {
  return `test -f ${q(path)} && echo EXISTS || echo MISSING`
}

export interface SshfsMountSpec {
  mountPath: string
  /** Comma-separated sshfs `-o` options, assembled from constants and app-generated paths. */
  options: string
  user: string
  host: string
  remotePath: string
  /** Piped to sshfs on stdin (needs `password_stdin` in options). */
  password?: string
}

export function sshfsMountCommand(spec: SshfsMountSpec): string {
  const feed = spec.password === undefined ? "" : `printf '%s' ${q(spec.password)} | `
  return `mkdir -p ${q(spec.mountPath)} && ${feed}sshfs -o ${q(spec.options)} ${q(`${spec.user}@${spec.host}:${spec.remotePath}`)} ${q(spec.mountPath)} 2>&1`
}

export interface QemuSshProbeSpec {
  host: string
  port: number | string
  path: string
  user: string
  identityFile: string
}

/** `qemu-img info` through QEMU's ssh block driver; the JSON is one argument. */
export function qemuImgSshProbeCommand(spec: QemuSshProbeSpec): string {
  const json = JSON.stringify({
    "file.driver": "ssh",
    "file.host": spec.host,
    "file.port": tcpPort(spec.port),
    "file.path": spec.path,
    "file.user": spec.user,
    "file.host-key-check.mode": "none",
    "file.identity-file": spec.identityFile,
  })
  return `timeout 15 qemu-img info ${q(`json:${json}`)} 2>&1`
}

export type ImageFormat = "raw" | "vmdk" | "qcow2"

export function qemuImgInfoCommand(path: string, format?: ImageFormat): string {
  return `timeout 10 qemu-img info ${format ? `-f ${format} ` : ""}${q(path)} 2>&1`
}

export function qemuNbdServeCommand(socketPath: string, format: ImageFormat, imagePath: string): string {
  return `qemu-nbd --fork --persistent --socket=${q(socketPath)} --format=${format} --cache=writeback --aio=threads ${q(imagePath)} 2>&1`
}

export interface ConvertScriptSpec {
  inputFormat: ImageFormat
  outputFormat: ImageFormat
  sourcePath: string
  outputPath: string
  /** qemu-img's progress and errors (stderr) land here. */
  progressFile: string
  exitFile: string
}

/** Body of the script a background `qemu-img convert` runs from. */
export function qemuImgConvertScript(spec: ConvertScriptSpec): string {
  return `qemu-img convert -p -f ${spec.inputFormat} -O ${spec.outputFormat} ${q(spec.sourcePath)} ${q(spec.outputPath)} 2>${q(spec.progressFile)}\necho $? > ${q(spec.exitFile)}`
}

export interface DdCopyScriptSpec {
  sourcePath: string
  devicePath: string
  progressFile: string
  exitFile: string
}

/** Body of the script a background raw `dd` copy runs from. */
export function ddCopyScript(spec: DdCopyScriptSpec): string {
  return `dd if=${q(spec.sourcePath)} of=${q(spec.devicePath)} bs=4M status=progress 2>${q(spec.progressFile)}\necho $? > ${q(spec.exitFile)}`
}

/**
 * Write `body` to `scriptPath` through a quoted heredoc (no expansion at write
 * time), ready for `nohup bash <scriptPath>`.
 */
export function writeScriptCommand(scriptPath: string, body: string, delimiter = "PCEOF"): string {
  if (body.split("\n").includes(delimiter)) throw new Error("script body contains the heredoc delimiter")
  return `cat > ${q(scriptPath)} << '${delimiter}'\n${body}\n${delimiter}`
}

/** Detach `inner` with nohup and print its pid. `inner` is one argument to bash. */
export function backgroundBashCommand(inner: string): string {
  return `nohup bash -c ${q(inner)} > /dev/null 2>&1 & echo $!`
}

/**
 * A value for a QEMU option string (`-drive file=...,format=...`): QEMU reads
 * `,,` as one literal comma, so a comma in a path cannot start another option.
 */
export function qemuOptionValue(value: string): string {
  return value.replaceAll(",", ",,")
}

/**
 * A double-quoted value for a curl config file (`url = "..."`). curl unescapes
 * `\\` and `\"` inside the quotes; a line break or NUL would start another
 * directive, so they are refused rather than escaped.
 */
export function curlConfigQuoted(value: string): string {
  if (/[\0-\x1f\x7f]/.test(value)) throw new Error("curl config value contains a control character")
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
}
