import { describe, expect, it } from "vitest"
import { BROADCOM_DEFAULT_LIBDIR, libdirError, OPENVDDK_DEFAULT_LIBDIR, OPENVDDK_KIT, OPENVDDK_KIT_URL } from "./vddk-library"

describe("OpenVDDK pin (roadmap#177)", () => {
  it("installs the pinned upstream release into its own directory, never Broadcom's", () => {
    expect(OPENVDDK_DEFAULT_LIBDIR).toBe("/usr/lib/openvddk")
    expect(OPENVDDK_DEFAULT_LIBDIR).not.toBe(BROADCOM_DEFAULT_LIBDIR)
    expect(OPENVDDK_KIT_URL).toBe(
      "https://github.com/openvddk/openvddk/releases/download/v0.7.5/openvddk-runtime-0.7.5-d7262efa169c.tar.gz",
    )
    expect(OPENVDDK_KIT.file).toBe(`openvddk-runtime-${OPENVDDK_KIT.version}-${OPENVDDK_KIT.commit}.tar.gz`)
    expect(OPENVDDK_KIT.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(OPENVDDK_KIT.libSha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe("libdirError", () => {
  it("accepts dedicated absolute directories", () => {
    expect(libdirError("/usr/lib/openvddk")).toBeNull()
    expect(libdirError("/opt/openvddk-0.7.4/")).toBeNull()
  })
  it("refuses relative paths, traversal and shell metacharacters", () => {
    expect(libdirError("usr/lib/openvddk")).toBe("invalid_path")
    expect(libdirError("/usr/lib/../etc")).toBe("invalid_path")
    expect(libdirError("/opt/x;rm -rf /")).toBe("invalid_path")
    expect(libdirError("")).toBe("invalid_path")
  })
  it("refuses system directories, which the OpenVDDK install would replace", () => {
    for (const d of ["/", "/usr", "/usr/lib", "/opt", "/etc/", "/var/lib"]) expect(libdirError(d)).toBe("system_dir")
  })
})
