import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { shellEscape } from "@/lib/ssh/exec"
import {
  authorizedKeysDeployCommand, authorizedKeysRevokeCommand, backgroundBashCommand, curlConfigQuoted, ddCopyScript,
  ddReadCommand, esxiKeyLoginProbeCommand, esxiSshCommand, fileExistsCommand, fileSizeCommand, listDirCommand,
  parseBackgroundPid, qemuImgConvertScript, qemuImgInfoCommand, qemuImgSshProbeCommand, qemuNbdServeCommand,
  qemuOptionValue, readlinkCommand, sshfsMountCommand, sshpassEsxiCommand, vmfsPath, vmkfstoolsCloneCommand,
  vmkfstoolsDeleteCommand, writeScriptCommand,
} from "./remote-commands"

/**
 * Every builder is checked against a real shell: the command runs in bash (or
 * in sh, for what the ESXi busybox shell will parse) with the program replaced
 * by a function that records its argv, so the test sees exactly what the real
 * program would have received. A canary file inside the hostile name proves
 * that `$(...)` and backticks were never expanded.
 */
const SEP = "\u001f"
// NODE_ENV only because this repo's ProcessEnv augmentation requires it.
const ENV: NodeJS.ProcessEnv = { PATH: "/usr/bin:/bin", HOME: "", NODE_ENV: "test" }

let dir: string
let canary: string
let hostileDs: string
let hostileRel: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "remote-commands-"))
  canary = join(dir, "pwned")
  ENV.HOME = dir
  hostileDs = `ds $(touch ${canary}) \`touch ${canary}\` "dq" 'sq' ;&|<> \\ name`
  hostileRel = `vm 'a'/disk$(touch ${canary})"b".vmdk`
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

/**
 * Run `command` with `programs` stubbed by argv-recording functions; return the
 * recorded argv lists in call order. `wrappers` (timeout, nohup) are replaced
 * by functions that drop their own name and run the rest.
 */
function argvOf(programs: string[], command: string, shell: "bash" | "sh" = "bash", wrappers: string[] = []): string[][] {
  const stubs = [
    ...wrappers.map(w => `${w}() { shift; "$@"; }`),
    ...programs.map(p => `${p}() { printf '%s${SEP}' "$#" "$@"; printf '\\n'; }`),
  ].join("\n")
  const out = execFileSync(shell, ["-c", `${stubs}\n${command}`], { encoding: "utf8", env: ENV })
  return out.split("\n").filter(Boolean).map(line => {
    const parts = line.split(SEP).slice(0, -1)
    return parts.slice(1, 1 + Number(parts[0]))
  })
}

const noCanary = () => expect(existsSync(canary)).toBe(false)

describe("parseBackgroundPid", () => {
  it("accepts the pid a `& echo $!` launch prints and nothing else", () => {
    expect(parseBackgroundPid("4242\n")).toBe("4242")
    expect(parseBackgroundPid(" 7 ")).toBe("7")
    expect(parseBackgroundPid("bash: nohup: command not found")).toBeNull()
    expect(parseBackgroundPid("12 34")).toBeNull()
    expect(parseBackgroundPid("")).toBeNull()
    expect(parseBackgroundPid(undefined)).toBeNull()
  })
})

describe("ESXi-side builders", () => {
  it("vmkfstools clone and delete receive the hostile paths as single arguments", () => {
    const descriptor = vmfsPath(hostileDs, hostileRel)
    const clone = vmfsPath(hostileDs, ".proxcenter-clone-j-disk0.vmdk")
    expect(descriptor).toBe(`/vmfs/volumes/${hostileDs}/${hostileRel}`)

    expect(argvOf(["vmkfstools"], vmkfstoolsCloneCommand(descriptor, clone), "sh")).toEqual([["-i", descriptor, clone, "-d", "thin"]])
    expect(argvOf(["vmkfstools"], vmkfstoolsDeleteCommand(clone), "sh")).toEqual([["-U", clone]])
    noCanary()
  })

  it("stat, dd, readlink and ls take one path argument", () => {
    const p = vmfsPath(hostileDs, hostileRel)
    const [statArgv] = argvOf(["stat"], fileSizeCommand(p), "sh")
    expect(statArgv).toEqual(["-c", "%s", p])
    expect(argvOf(["dd"], ddReadCommand(p), "sh")).toEqual([[`if=${p}`, "bs=4M"]])
    expect(argvOf(["readlink"], readlinkCommand(p), "sh")).toEqual([["-f", p]])
    expect(argvOf(["ls"], listDirCommand(p), "sh")).toEqual([["-la", p]])
    noCanary()
  })

  it("fileSizeCommand answers 0 when stat fails", () => {
    const out = execFileSync("sh", ["-c", `stat() { return 1; }\n${fileSizeCommand(hostileDs)}`], { encoding: "utf8", env: ENV })
    expect(out.trim()).toBe("0")
    noCanary()
  })

  it("authorized_keys deployment quotes the user-derived directory and the key", () => {
    const user = `r$(touch ${canary})`
    const key = `ssh-rsa AAAA'B"C$(touch ${canary}) proxcenter`
    expect(authorizedKeysDeployCommand(user, key, "etc")).toBe(
      `mkdir -p ${shellEscape(`/etc/ssh/keys-${user}`)} 2>/dev/null; echo ${shellEscape(key)} >> ${shellEscape(`/etc/ssh/keys-${user}/authorized_keys`)}; echo DEPLOYED`,
    )
    expect(authorizedKeysDeployCommand(user, key, "home")).toBe(
      `mkdir -p ~/.ssh 2>/dev/null; chmod 700 ~/.ssh; echo ${shellEscape(key)} >> ~/.ssh/authorized_keys; chmod 600 ~/.ssh/authorized_keys; echo DEPLOYED`,
    )
    // The home variant can run for real: ~ is the test's temp directory.
    const out = execFileSync("sh", ["-c", authorizedKeysDeployCommand(user, key, "home")], { encoding: "utf8", env: ENV })
    expect(out.trim()).toBe("DEPLOYED")
    expect(readFileSync(join(dir, ".ssh/authorized_keys"), "utf8")).toBe(`${key}\n`)
    noCanary()
  })

  it("authorized_keys revocation passes sed one escaped pattern and the key files", () => {
    const user = `r$(touch ${canary})`
    const cmd = authorizedKeysRevokeCommand(user, "AAAAB3Nza/C1yc2E.+x$(touch pwned)", "CLEANED")
    const [sedArgv] = argvOf(["sed"], cmd, "sh")
    expect(sedArgv).toEqual(["-i", "/AAAAB3Nza\\/C1yc2E\\.+x\\$(touch pwned)/d", `/etc/ssh/keys-${user}/authorized_keys`, `${dir}/.ssh/authorized_keys`])
    expect(cmd.endsWith("; echo 'CLEANED'")).toBe(true)
    noCanary()
  })
})

describe("node-side ssh wrappers", () => {
  const OPTS = "-o StrictHostKeyChecking=no -o LogLevel=ERROR"

  it("esxiSshCommand hands ssh the login and the whole remote command as single arguments", () => {
    const remote = vmkfstoolsCloneCommand(vmfsPath(hostileDs, hostileRel), "/vmfs/volumes/ds/c.vmdk")
    const user = `root$(touch ${canary})`
    const host = `esx "1" $(touch ${canary})`
    const [sshArgv] = argvOf(["ssh"], esxiSshCommand(`ssh ${OPTS}`, 22, user, host, remote))
    expect(sshArgv).toEqual([...OPTS.split(" "), "-p", "22", `${user}@${host}`, remote])
    // What ESXi's shell then makes of the remote command.
    expect(argvOf(["vmkfstools"], sshArgv.at(-1)!, "sh")).toEqual([["-i", vmfsPath(hostileDs, hostileRel), "/vmfs/volumes/ds/c.vmdk", "-d", "thin"]])
    noCanary()
  })

  it("esxiSshCommand refuses a port that is not a TCP port", () => {
    expect(() => esxiSshCommand("ssh", "22; id", "root", "esx", "ls")).toThrow(/Invalid SSH port/)
    expect(() => esxiSshCommand("ssh", 0, "root", "esx", "ls")).toThrow(/Invalid SSH port/)
  })

  it("sshpassEsxiCommand exports the raw password and keeps the login and remote command whole", () => {
    const password = `p'a"s$(touch ${canary}) \`id\` s`
    const cmd = sshpassEsxiCommand(password, OPTS, 2222, "root", `esx $(touch ${canary})`, fileSizeCommand(hostileDs))
    const out = execFileSync("bash", ["-c", `sshpass() { printf '%s${SEP}' "$SSHPASS" "$@"; }\n${cmd}`], { encoding: "utf8", env: ENV })
    const [seenPassword, ...argv] = out.split(SEP).slice(0, -1)
    expect(seenPassword).toBe(password)
    expect(argv).toEqual(["-e", "ssh", ...OPTS.split(" "), "-p", "2222", `root@esx $(touch ${canary})`, fileSizeCommand(hostileDs)])
    noCanary()
  })

  it("esxiKeyLoginProbeCommand quotes the key path and the login", () => {
    const key = `${dir}/key $(touch ${canary})`
    const [argv] = argvOf(["ssh"], esxiKeyLoginProbeCommand(key, OPTS, 22, "root", "esx"))
    expect(argv).toEqual(["-i", key, ...OPTS.split(" "), "-p", "22", "root@esx", "echo KEYOK"])
    noCanary()
  })
})

describe("node-side file and image builders", () => {
  it("fileExistsCommand finds a file whose name holds shell characters, and reports a missing one", () => {
    // A real file name cannot hold "/", so the canary becomes relative and the shell runs in `dir`.
    const name = hostileDs.replaceAll(canary, "pwned")
    const file = join(dir, name)
    writeFileSync(file, "x")
    const run = (cmd: string) => execFileSync("bash", ["-c", cmd], { encoding: "utf8", env: ENV, cwd: dir }).trim()
    expect(run(fileExistsCommand(file))).toBe("EXISTS")
    expect(run(fileExistsCommand(join(dir, "missing", name)))).toBe("MISSING")
    noCanary()
  })

  it("sshfsMountCommand passes the options, the remote spec and the mount point as single arguments", () => {
    const remotePath = `/vmfs/volumes/${hostileDs}`
    const mountPath = join(dir, "mnt $(touch pwned)")
    const spec = { mountPath, options: "allow_other,reconnect,ssh_command=/tmp/w.sh", user: "root", host: "esx", remotePath }
    const [argv] = argvOf(["sshfs"], sshfsMountCommand(spec))
    expect(argv).toEqual(["-o", spec.options, `root@esx:${remotePath}`, mountPath])
    expect(existsSync(mountPath)).toBe(true)

    // password_stdin: the password arrives on stdin, raw.
    const password = `p'w$(touch ${canary})`
    const withPassword = sshfsMountCommand({ ...spec, options: `password_stdin,${spec.options}`, password })
    const out = execFileSync("bash", ["-c", `sshfs() { IFS= read -r pw; printf '%s${SEP}' "$pw" "$@"; }\n${withPassword}`], { encoding: "utf8", env: ENV })
    expect(out.split(SEP).slice(0, -1)).toEqual([password, "-o", `password_stdin,${spec.options}`, `root@esx:${remotePath}`, mountPath])
    noCanary()
  })

  it("qemuImgSshProbeCommand gives qemu-img one json: argument carrying the raw path", () => {
    const path = vmfsPath(hostileDs, hostileRel)
    const cmd = qemuImgSshProbeCommand({ host: "esx", port: 22, path, user: "root", identityFile: `${dir}/key` })
    const [argv] = argvOf(["qemu-img"], cmd, "bash", ["timeout"])
    expect(argv[0]).toBe("info")
    expect(JSON.parse(argv[1].slice("json:".length))).toEqual({
      "file.driver": "ssh", "file.host": "esx", "file.port": 22, "file.path": path, "file.user": "root",
      "file.host-key-check.mode": "none", "file.identity-file": `${dir}/key`,
    })
    noCanary()
  })

  it("qemuImgInfoCommand and qemuNbdServeCommand quote the image path", () => {
    const image = join(dir, hostileRel)
    expect(argvOf(["qemu-img"], qemuImgInfoCommand(image, "vmdk"), "bash", ["timeout"])).toEqual([["info", "-f", "vmdk", image]])
    expect(argvOf(["qemu-img"], qemuImgInfoCommand(image), "bash", ["timeout"])).toEqual([["info", image]])
    const sock = `${dir}/nbd $(touch pwned).sock`
    expect(argvOf(["qemu-nbd"], qemuNbdServeCommand(sock, "raw", image))).toEqual([
      [`--fork`, `--persistent`, `--socket=${sock}`, `--format=raw`, `--cache=writeback`, `--aio=threads`, image],
    ])
    noCanary()
  })

  it("the convert and dd scripts, written through the heredoc, run their program once with quoted paths", () => {
    const source = join(dir, hostileRel)
    const output = join(dir, `out $(touch ${canary}).qcow2`)
    const progressFile = join(dir, "p.progress")
    const exitFile = join(dir, "p.exit")
    const script = join(dir, "convert.sh")

    execFileSync("bash", ["-c", writeScriptCommand(script, qemuImgConvertScript({ inputFormat: "raw", outputFormat: "qcow2", sourcePath: source, outputPath: output, progressFile, exitFile }), "CONVEOF")], { env: ENV })
    const body = readFileSync(script, "utf8")
    expect(argvOf(["qemu-img"], body)).toEqual([["convert", "-p", "-f", "raw", "-O", "qcow2", source, output]])
    expect(readFileSync(exitFile, "utf8").trim()).toBe("0")

    const device = join(dir, `dev $(touch ${canary})`)
    expect(argvOf(["dd"], ddCopyScript({ sourcePath: source, devicePath: device, progressFile, exitFile }))).toEqual([
      [`if=${source}`, `of=${device}`, "bs=4M", "status=progress"],
    ])
    noCanary()
  })

  it("writeScriptCommand refuses a body that would end its own heredoc", () => {
    expect(() => writeScriptCommand("/tmp/x.sh", "echo a\nPCEOF\necho b")).toThrow(/heredoc/)
  })

  it("backgroundBashCommand hands the inner command to bash as one argument", () => {
    const inner = `curl -K ${shellEscape(join(dir, hostileDs))} && echo done`
    const [argv] = argvOf(["nohup"], `${backgroundBashCommand(inner).replace(/ > \/dev\/null 2>&1 & echo \$!$/, "")}`)
    expect(argv).toEqual(["bash", "-c", inner])
    noCanary()
  })
})

describe("non-shell escapes", () => {
  it("qemuOptionValue doubles commas so a path cannot add a drive option", () => {
    expect(qemuOptionValue("/vmfs/volumes/ds,format=qcow2/a.vmdk")).toBe("/vmfs/volumes/ds,,format=qcow2/a.vmdk")
    expect(qemuOptionValue("/plain/path")).toBe("/plain/path")
  })

  it("curlConfigQuoted escapes quotes and backslashes and refuses line breaks", () => {
    expect(curlConfigQuoted("https://h/a b")).toBe('"https://h/a b"')
    expect(curlConfigQuoted('/tmp/x"\noutput = "/root/.ssh/authorized_keys'.replace("\n", ""))).toBe('"/tmp/x\\"output = \\"/root/.ssh/authorized_keys"')
    expect(curlConfigQuoted("C:\\x")).toBe('"C:\\\\x"')
    expect(() => curlConfigQuoted("a\nurl = \"evil\"")).toThrow(/control character/)
  })
})
