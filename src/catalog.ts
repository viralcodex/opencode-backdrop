import { watch, type FSWatcher } from "node:fs"
import { open, readdir, realpath, stat } from "node:fs/promises"
import path from "node:path"
import { homedir } from "node:os"
import { Effect, Schema, Semaphore } from "effect"
import { Catalog, ImageRequest, maxImageBytes } from "./contract"

const formats: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
}
const missing = Schema.is(Schema.Struct({ code: Schema.Literal("ENOENT") }))

export function wallpaperFolder(options: unknown) {
  const configured = Schema.decodeUnknownSync(Schema.optional(Schema.Union([
    Schema.NonEmptyString,
    Schema.Array(Schema.NonEmptyString).check(Schema.isMinLength(1)),
  ])))(options)
  const folder = (Array.isArray(configured) ? configured[0] : configured) ?? ""
  if (!folder) return ""
  if (!path.isAbsolute(folder)) throw new Error("The wallpaper folder must use an absolute path.")
  return path.resolve(folder)
}

export function wallpaperFolderLabel(folder: string, home = homedir()) {
  if (!folder) return ""
  const relative = path.relative(home, folder)
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return folder
  return relative ? `~${path.sep}${relative}` : "~"
}

type Cached = { file: string; image: (typeof Catalog.spec.state.Type.images)[number] }

export function createCatalog(folder: string, changed: () => void) {
  const lifetime = new AbortController()
  const reads = Semaphore.makeUnsafe(2)
  let value: typeof Catalog.spec.state.Type = { folder, ready: !folder, images: [], error: "" }
  let cache = new Map<string, Cached>()
  let pending: Promise<boolean> | undefined
  let dirty = false
  let watcher: FSWatcher | undefined
  let resolvedFolder: string | undefined
  const parents = new Map<string, { directory: string; watcher: FSWatcher }>()
  let watchError = ""

  function invalidate() {
    dirty = true
    void refresh()
  }

  async function observe() {
    if (!folder) return
    let root: string | undefined
    let failure: unknown
    try {
      root = await realpath(folder)
      resolvedFolder = root
    } catch (error) {
      failure = error
    }
    const targets = new Set([folder, ...(resolvedFolder ? [resolvedFolder] : [])])
    for (const [target, monitor] of parents) {
      if (targets.has(target)) continue
      monitor.watcher.close()
      parents.delete(target)
    }
    for (const target of targets) {
      let parent = path.dirname(target)
      while (true) {
        try {
          await stat(parent)
          break
        } catch (error) {
          if (!missing(error) || parent === path.dirname(parent)) throw error
          parent = path.dirname(parent)
        }
      }
      if (lifetime.signal.aborted) return
      const previous = parents.get(target)
      if (previous?.directory === parent) continue
      previous?.watcher.close()
      const directory = parent
      const monitor = watch(directory, { signal: lifetime.signal }, (_event, filename) => {
        const file = filename === null ? target : path.resolve(directory, filename)
        const relative = path.relative(file, target)
        if (!relative || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative))) {
          watcher?.close()
          watcher = undefined
          invalidate()
        }
      })
      parents.set(target, { directory, watcher: monitor })
      monitor.on("error", (error) => {
        monitor.close()
        if (parents.get(target)?.watcher === monitor) parents.delete(target)
        reportWatchError(error)
      })
    }
    if (failure) throw failure
    if (lifetime.signal.aborted) return
    if (!watcher && root) {
      const monitor = watch(root, { recursive: true, signal: lifetime.signal }, invalidate)
      watcher = monitor
      monitor.on("error", (error) => {
        monitor.close()
        if (watcher === monitor) watcher = undefined
        reportWatchError(error)
      })
    }
    watchError = ""
  }

  function reportWatchError(error: unknown) {
    watchError = `${folder}: ${String(error)}`
    if (!lifetime.signal.aborted) {
      value = { ...value, error: [...new Set([value.error, watchError].filter(Boolean))].join("\n") }
      changed()
    }
  }

  function refresh() {
    if (lifetime.signal.aborted) return Promise.resolve(false)
    dirty = true
    if (pending) return pending
    pending = (async () => {
      do {
        dirty = false
        try { await observe() } catch (error) { watchError = `${folder}: ${String(error)}` }
        await scan()
      } while (dirty && !lifetime.signal.aborted)
    })().then(
      () => !lifetime.signal.aborted && !value.error,
      (error) => {
        if (!lifetime.signal.aborted) {
          value = { ...value, ready: true, error: String(error) }
          changed()
        }
        return false
      },
    ).finally(() => { pending = undefined })
    return pending
  }

  async function scan() {
    if (!folder) return
    const errors: string[] = watchError ? [watchError] : []
    let root = folder
    const files = new Set<string>()
    try {
      root = await realpath(folder)
      for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
        if (!entry.isFile() || !formats[path.extname(entry.name).toLowerCase()]) continue
        const filename = path.join(entry.parentPath, entry.name)
        try { files.add(await realpath(filename)) }
        catch (error) { errors.push(`${filename}: ${String(error)}`) }
      }
    } catch (error) {
      errors.push(`${folder}: ${String(error)}`)
    }
    const next = new Map<string, Cached>()
    for (const file of files) {
      if (lifetime.signal.aborted) return
      try {
        const info = await stat(file)
        requireSize(info.size)
        const version = stamp(info)
        const id = `file:${encodeURIComponent(file)}`
        const title = path.relative(root, file).slice(0, -path.extname(file).length)
        const previous = cache.get(id)
        const image = previous?.image.version === version && previous.image.title === title
          ? previous.image : { id, title, version }
        next.set(id, { file, image })
      } catch (error) {
        errors.push(`${path.relative(root, file)}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    if (lifetime.signal.aborted) return
    cache = next
    const images = [...cache.values()].map((entry) => entry.image).sort((a, b) => a.id.localeCompare(b.id))
    const error = [...new Set(errors)].sort().join("\n")
    if (value.ready && error === value.error && images.length === value.images.length && images.every((image, i) => image === value.images[i])) return
    value = { folder, ready: true, images, error }
    changed()
  }

  function read(request: typeof ImageRequest.Type, signal = lifetime.signal) {
    return Effect.runPromise(reads.withPermit(Effect.tryPromise({
      async try(signal) {
        const entry = cache.get(request.id)
        if (!entry || entry.image.version !== request.version) throw new Error("The selected wallpaper is missing or has changed.")
        const file = await open(entry.file, "r")
        try {
          const info = await file.stat()
          requireSize(info.size)
          if (stamp(info) !== request.version) throw new Error("The selected wallpaper has changed. Refresh the gallery.")
          const buffer = Buffer.alloc(info.size + 1)
          let size = 0
          while (size < buffer.length) {
            signal.throwIfAborted()
            const { bytesRead } = await file.read(buffer, size, buffer.length - size, null)
            if (!bytesRead) break
            size += bytesRead
          }
          requireSize(size)
          if (stamp(await file.stat()) !== request.version) throw new Error("The selected wallpaper changed while being read.")
          return `data:${formats[path.extname(entry.file).toLowerCase()]};base64,${buffer.subarray(0, size).toString("base64")}`
        } finally {
          await file.close()
        }
      },
      catch: (error) => error,
    })), { signal: AbortSignal.any([signal, lifetime.signal]) })
  }

  return {
    state: () => value,
    refresh,
    read,
    dispose() {
      lifetime.abort()
      watcher?.close()
      for (const monitor of parents.values()) monitor.watcher.close()
      parents.clear()
      cache.clear()
    },
  }
}

function requireSize(size: number) {
  if (size === 0 || size > maxImageBytes) throw new Error("image.sizeError")
}

function stamp(info: { size: number; mtimeMs: number; ctimeMs: number; dev: number; ino: number }) {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}:${info.ctimeMs}`
}
