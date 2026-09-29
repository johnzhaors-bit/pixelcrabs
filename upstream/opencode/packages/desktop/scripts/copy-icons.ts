import { copyFile, mkdir } from "node:fs/promises"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const target = resolve(root, "resources/icons")
await mkdir(target, { recursive: true })
for (const name of ["icon.png", "icon.ico", "icon.icns", "dock.png"]) {
  await copyFile(resolve(root, "icons/pixelcrabs-open", name), resolve(target, name))
}
console.log("Prepared PixelCrabs Open icons")
