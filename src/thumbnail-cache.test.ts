import { expect, spyOn, test } from "bun:test"
import { createThumbnailCache } from "./thumbnail-cache"
import type { ThumbnailBlob } from "./image"

const file = { id: "file:example.png", title: "example", version: "1" }
const thumbnail = (): ThumbnailBlob => ({ blob: new Blob(["tile"], { type: "image/png" }), width: 32, height: 20 })
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve))

test("reopening a tile reuses its URL synchronously without another read or decode", async () => {
  let loads = 0
  const cache = createThumbnailCache(async () => { loads++; return thumbnail() })
  try {
    const first = cache.acquire(file)
    const loaded = await first.ready
    first.release()
    const reopened = cache.acquire({ ...file, title: "renamed label" })
    expect(reopened.value).toBe(loaded)
    expect(await reopened.ready).toBe(loaded)
    expect(loads).toBe(1)
    reopened.release()
  } finally { cache.dispose() }
})

test("shares an in-flight thumbnail and lets it finish after one consumer closes", async () => {
  let loads = 0
  const pending = deferred<ThumbnailBlob>()
  const cache = createThumbnailCache(async () => { loads++; return pending.promise })
  try {
    const first = cache.acquire(file)
    const second = cache.acquire(file)
    expect(first.ready).toBe(second.ready)
    first.release()
    pending.resolve(thumbnail())
    await second.ready
    expect(loads).toBe(1)
    second.release()
    expect(cache.peek(file)?.url).toBeTruthy()
  } finally { cache.dispose() }
})

test("invalidates changed file versions and changed uploaded content", async () => {
  for (const [before, after] of [
    [{ ...file }, { ...file, version: "2" }],
    [{ ...file, id: "upload:one", image: "first" }, { ...file, id: "upload:one", image: "second" }],
  ]) {
    let loads = 0
    const cache = createThumbnailCache(async () => { loads++; return thumbnail() })
    try {
      const first = cache.acquire(before)
      await first.ready
      first.release()
      const original = { ...before }
      Object.assign(before, after)
      cache.retain([before])
      expect(cache.peek(original)).toBeUndefined()
      const changed = cache.acquire(before)
      await changed.ready
      expect(loads).toBe(2)
      changed.release()
    } finally { cache.dispose() }
  }
})

test("bounds idle entries and bytes without evicting displayed thumbnails", async () => {
  const revoke = spyOn(URL, "revokeObjectURL")
  try {
    for (const limits of [{ maxEntries: 1 }, { maxBytes: 4 }]) {
      const cache = createThumbnailCache(async () => thumbnail(), limits)
      try {
        const first = cache.acquire(file)
        const firstImage = await first.ready
        const secondFile = { ...file, id: "file:other.png" }
        const second = cache.acquire(secondFile)
        await second.ready
        expect(cache.peek(file)).toBe(firstImage)
        first.release()
        second.release()
        expect(cache.peek(file)).toBeUndefined()
        expect(cache.peek(secondFile)).toBeTruthy()
        expect(revoke).toHaveBeenCalledWith(firstImage.url)
      } finally { cache.dispose() }
    }
  } finally { revoke.mockRestore() }
})

test("limits concurrent thumbnail generation", async () => {
  const gates = Array.from({ length: 3 }, () => deferred<ThumbnailBlob>())
  let loads = 0
  const cache = createThumbnailCache(async () => gates[loads++]!.promise, { concurrency: 1 })
  try {
    const leases = gates.map((_, index) => cache.acquire({ ...file, id: `file:${index}.png` }))
    await tick()
    expect(loads).toBe(1)
    for (let index = 0; index < gates.length; index++) {
      gates[index]!.resolve(thumbnail())
      await leases[index]!.ready
      leases[index]!.release()
      await tick()
      expect(loads).toBe(Math.min(index + 2, gates.length))
    }
  } finally { cache.dispose() }
})

test("allows a new request after failure and cancels late work on plugin shutdown", async () => {
  let loads = 0
  const cache = createThumbnailCache(async () => {
    if (++loads === 1) throw new Error("image.decodeError")
    return thumbnail()
  })
  try {
    const failed = cache.acquire(file)
    await expect(failed.ready).rejects.toThrow("image.decodeError")
    failed.release()
    const requested = cache.acquire(file)
    await requested.ready
    requested.release()
    expect(loads).toBe(2)
  } finally { cache.dispose() }

  const pending = deferred<ThumbnailBlob>()
  const signal = new AbortController()
  const create = spyOn(URL, "createObjectURL")
  const stopped = createThumbnailCache(async () => pending.promise, { signal: signal.signal })
  try {
    const lease = stopped.acquire(file)
    const failure = lease.ready.catch((error: unknown) => error)
    await tick()
    signal.abort()
    expect(await failure).toMatchObject({ name: "AbortError" })
    pending.resolve(thumbnail())
    await tick()
    expect(create).not.toHaveBeenCalled()
    expect(stopped.peek(file)).toBeUndefined()
    lease.release()
  } finally { stopped.dispose(); create.mockRestore() }
})
