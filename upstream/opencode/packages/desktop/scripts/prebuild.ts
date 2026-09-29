import { $ } from "bun"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..")
// The public desktop uses its embedded source engine; no upstream CLI download.
await $`bun ./scripts/copy-icons.ts`.cwd(root)
await $`bun script/build-node.ts`.cwd(resolve(root, "../opencode"))
