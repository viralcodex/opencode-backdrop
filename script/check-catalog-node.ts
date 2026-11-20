import assert from "node:assert/strict"
import { fileURLToPath } from "node:url"

const root = fileURLToPath(new URL("..", import.meta.url))
const bundle = await Bun.build({
  entrypoints: [fileURLToPath(new URL("../src/catalog.ts", import.meta.url))],
  target: "node",
  packages: "external",
  format: "esm",
})
assert(bundle.success, "Catalog test bundle failed to build")
const output = bundle.outputs[0]
assert(output, "Catalog test bundle is missing")
const scenario = `
{
  const assert = (await import('node:assert/strict')).default
  const fs = await import('node:fs/promises')
  const path = (await import('node:path')).default
  const os = await import('node:os')
  const temporary = path.join(os.tmpdir(), 'opencode')
  await fs.mkdir(temporary, { recursive: true })
  const directory = await fs.mkdtemp(path.join(temporary, 'wallpaper-node-test-'))
  const target = path.join(directory, 'target')
  const aliases = path.join(directory, 'aliases')
  const alias = path.join(aliases, 'alias')
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
  const pending = new Set()
  const catalog = createCatalog(alias, () => { for (const notify of [...pending]) notify() })
  const waitFor = (predicate) => new Promise((resolve, reject) => {
    if (predicate()) { resolve(); return }
    const notify = () => {
      if (!predicate()) return
      clearTimeout(timer)
      pending.delete(notify)
      resolve()
    }
    const timer = setTimeout(() => {
      pending.delete(notify)
      reject(new Error('Filesystem event did not update the catalog: ' + JSON.stringify(catalog.state())))
    }, 5000)
    pending.add(notify)
  })
  try {
    await fs.mkdir(target)
    await fs.mkdir(aliases)
    await fs.symlink(target, alias, ${JSON.stringify(process.platform === "win32" ? "junction" : "dir")})
    await fs.writeFile(path.join(target, 'before.svg'), svg)
    assert.equal(await catalog.refresh(), true)
    assert.equal(catalog.state().images.length, 1)
    const removed = waitFor(() => catalog.state().images.length === 0 && catalog.state().error.includes('ENOENT'))
    await fs.rm(target, { recursive: true })
    await removed
    const restored = waitFor(() => !catalog.state().error && catalog.state().images.some(image => image.title === 'restored'))
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, 'restored.svg'), svg)
    await restored
    assert.ok((await catalog.read(catalog.state().images[0])).includes(Buffer.from(svg).toString('base64')))
    const changed = waitFor(() => catalog.state().images.length === 2)
    await fs.writeFile(path.join(target, 'another.svg'), svg)
    await changed
    catalog.dispose()
    assert.equal(await catalog.refresh(), false)
    console.log('Node catalog passed: symlink target removal, recreation, subsequent changes, reads, and disposal.')
  } finally {
    catalog.dispose()
    await fs.rm(directory, { recursive: true, force: true })
  }
}
`
const node = Bun.spawn([process.env.NODE_BIN ?? "node", "--input-type=module", "--eval", `${await output.text()}\n${scenario}`],
  { cwd: root, stdout: "pipe", stderr: "pipe" },
)
const [stdout, stderr, exit] = await Promise.all([new Response(node.stdout).text(), new Response(node.stderr).text(), node.exited])
assert.equal(exit, 0, stderr)
console.log(stdout.trim())
