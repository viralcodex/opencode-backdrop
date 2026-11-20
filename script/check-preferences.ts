import assert from "node:assert/strict"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { build } from "vite"

const checkout = process.argv[2] ?? process.env.OPENCODE_CHECKOUT
assert(checkout, "Pass an OpenCode checkout path, or set OPENCODE_CHECKOUT, to test the real host persistence implementation.")
const host = path.resolve(checkout, "packages/app/src/runtime/persistence/schema.ts")
assert(await Bun.file(host).exists(), `OpenCode persistence source is missing: ${host}`)
const root = fileURLToPath(new URL("..", import.meta.url))
const effect = fileURLToPath(import.meta.resolve("effect"))
const entry = path.join(root, "script/virtual-preference-test.ts")
const source = `
import { Persistence } from ${JSON.stringify(host)}
import { Schema } from 'effect'
import { Preferences, StoredPreferences, initial } from ${JSON.stringify(path.join(root, "src/preferences.ts"))}
import assert from 'node:assert/strict'

const image = 'data:image/png;base64,YWJj'
const upload = { id: 'upload:one', name: 'one.png', image }
const schema = Persistence.withInitial(StoredPreferences, initial)
for (const changed of [{ tint: 101 }, { fit: undefined }, { brightness: 'bad' }, { duration: 0 }, { strength: 'bad' }]) {
  const saved = { enabled: true, preset: 'custom', image, imageName: 'old.png', images: [upload], strength: 20, fit: 'contain', ...changed }
  const restored = Schema.decodeUnknownSync(schema)(saved)
  assert.equal(restored.enabled, true)
  assert.equal(restored.preset, 'custom')
  assert.deepEqual(restored.images, [{ id: 'custom', name: 'old.png', image }, upload])
  const written = Schema.encodeSync(schema)({ ...restored, brightness: 120 })
  assert.ok(!Object.hasOwn(written, 'image'))
  assert.ok(!Object.hasOwn(written, 'strength'))
  assert.deepEqual(Schema.decodeUnknownSync(schema)(written).images, restored.images)
}
assert.throws(() => Schema.encodeUnknownSync(Preferences)({ ...initial, tint: 101, images: [upload] }))
assert.throws(() => Schema.encodeUnknownSync(schema)({ ...initial, tint: 101, images: [upload] }))
console.log('Host persistence passed: independent field recovery preserves saved uploads and selection; writes stay strict.')
`
const result = await build({
  configFile: false,
  logLevel: "error",
  resolve: { alias: [{ find: /^effect$/, replacement: effect }] },
  plugins: [{ name: "preference-test", resolveId: (id) => id === entry ? entry : undefined, load: (id) => id === entry ? source : undefined }],
  build: { write: false, lib: { entry, formats: ["es"] }, rollupOptions: { external: [effect, "node:assert/strict"] } },
})
const bundle = Array.isArray(result) ? result[0] : result
assert(bundle && "output" in bundle)
const chunk = bundle.output.find((output) => output.type === "chunk")
assert(chunk?.type === "chunk")
await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString("base64")}`)
