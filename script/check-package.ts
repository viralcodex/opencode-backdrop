import assert from "node:assert/strict"
import { builtinModules } from "node:module"
import { fileURLToPath } from "node:url"
import { Script } from "node:vm"
import manifest from "../package.json"

for (const [name, version] of [manifest.devDependencies, manifest.peerDependencies].flatMap((dependencies) => Object.entries(dependencies))) {
  assert(!/^(?:link:|file:|workspace:)/.test(version), `Local dependency cannot be published: ${name}`)
}

// Ignore lifecycle scripts during package inspection.
const result = Bun.spawn(["npm", "pack", "--dry-run", "--ignore-scripts", "--json"], {
  cwd: fileURLToPath(new URL("..", import.meta.url)),
  stdout: "pipe",
  stderr: "inherit",
})
const output = await new Response(result.stdout).text()
assert.equal(await result.exited, 0, "npm pack failed")
const [packed] = JSON.parse(output) as { size: number; unpackedSize: number; files: { path: string }[] }[]
assert(packed, "npm pack returned no package")
const files = packed.files.map((file) => file.path).sort()
assert.deepEqual(files, [
  "LICENSE", "README.md", "package.json",
  ...new Set(Object.values(manifest.exports).map((file) => file.replace(/^\.\//, ""))),
].sort(), "Unexpected package contents. Keep local images, tests and build tools out of the release.")
assert(packed.unpackedSize < 256 * 1024, "Package exceeds the 256 KiB release budget")

const bundle = await Bun.file(new URL(`../${manifest.exports["./gui-experimental"]}`, import.meta.url)).text()
new Script(bundle, { filename: "gui-experimental.cjs" })
const shared = new Set(["@opencode/plugin/gui", "effect", "solid-js", "solid-js/web", "solid-js/store"])
for (const match of bundle.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
  const id = match[1]!
  assert(shared.has(id) || builtinModules.includes(id.replace(/^node:/, "")), `Unsupported GUI runtime import: ${id}`)
}
console.log(`Package checked: ${files.length} files, ${packed.size} bytes packed.`)
