import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"

import { buildOpenApiDocument } from "../src/lib/api-tokens/openapi"

const outDir = path.resolve(__dirname, "..", "public", "openapi")
const outFile = path.join(outDir, "proxcenter-public-api.json")

mkdirSync(outDir, { recursive: true })
writeFileSync(outFile, `${JSON.stringify(buildOpenApiDocument(), null, 2)}\n`, "utf8")
console.log(`[openapi] wrote ${outFile}`)
