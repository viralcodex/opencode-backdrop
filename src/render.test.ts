import { afterEach, expect, jest, spyOn, test } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import type { WallpaperChoice } from "./model"
import { createWallpaperImage, type WallpaperImage } from "./render"

const data = "data:image/png;base64,YWJj"
const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image")
let dispose: (() => void) | undefined
let decodes: { resolve: () => void; reject: () => void }[]
let urls: string[]
let revoked: string[]

function fixture(duration = 0) {
  decodes = []
  urls = []
  revoked = []
  Object.defineProperty(globalThis, "Image", { configurable: true, value: class {
    src = ""
    naturalWidth = 1000
    naturalHeight = 600
    decode() {
      return new Promise<void>((resolve, reject) => decodes.push({ resolve, reject: () => reject(new Error("bad image")) }))
    }
  } })
  spyOn(URL, "createObjectURL").mockImplementation(() => { const url = `blob:test-${urls.length}`; urls.push(url); return url })
  spyOn(URL, "revokeObjectURL").mockImplementation((url) => { revoked.push(url) })
  let select!: (choice: WallpaperChoice | undefined) => void
  let image!: WallpaperImage
  createRoot((cleanup) => {
    dispose = cleanup
    const [selected, setSelected] = createSignal<WallpaperChoice>()
    select = (choice) => { setSelected(choice) }
    image = createWallpaperImage(selected, async () => data, () => duration)
  })
  const choose = (id: string) => select({ id, title: id, version: "1", image: data })
  return { image, choose, select }
}

afterEach(() => {
  dispose?.()
  dispose = undefined
  jest.useRealTimers()
  spyOn(URL, "createObjectURL").mockRestore()
  spyOn(URL, "revokeObjectURL").mockRestore()
  if (originalImage) Object.defineProperty(globalThis, "Image", originalImage)
  else Reflect.deleteProperty(globalThis, "Image")
})

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

test("keeps the current frame during reads and decoding, then releases it for an instant switch", async () => {
  const f = fixture()
  f.choose("a")
  decodes[0].resolve()
  await flush()
  expect(f.image.url).toBe("blob:test-0")
  f.choose("b")
  expect(f.image.loading).toBe(true)
  expect(f.image.url).toBe("blob:test-0")
  expect(revoked).toEqual([])
  decodes[1].resolve()
  await flush()
  expect(f.image.url).toBe("blob:test-1")
  expect(f.image.previous).toBeUndefined()
  expect(revoked).toEqual(["blob:test-0"])
})

test("retains outgoing URLs until fades finish and releases every frame on cleanup", async () => {
  jest.useFakeTimers()
  const f = fixture(800)
  f.choose("a")
  decodes[0].resolve()
  await flush()
  f.choose("b")
  decodes[1].resolve()
  await flush()
  expect(f.image.previous?.url).toBe("blob:test-0")
  expect(f.image.transition).toBe(800)
  expect(revoked).toEqual([])
  jest.advanceTimersByTime(800)
  expect(f.image.previous).toBeUndefined()
  expect(revoked).toEqual(["blob:test-0"])
  f.choose("c")
  decodes[2].resolve()
  await flush()
  dispose?.()
  dispose = undefined
  expect(revoked.sort()).toEqual(["blob:test-0", "blob:test-1", "blob:test-2"])
  expect(jest.getTimerCount()).toBe(0)
})

test("preserves the last readable image on failure and clears it when wallpaper is disabled", async () => {
  const f = fixture()
  f.choose("a")
  decodes[0].resolve()
  await flush()
  f.choose("b")
  decodes[1].reject()
  await flush()
  expect(f.image.url).toBe("blob:test-0")
  expect(f.image.error).toBe("image.decodeError")
  expect(f.image.loading).toBe(false)
  f.select(undefined)
  expect(f.image.url).toBe("")
  expect(f.image.width).toBe(0)
  expect(revoked.sort()).toEqual(["blob:test-0", "blob:test-1"])
})

test("aborts rapid selections without letting stale decodes replace the current frame", async () => {
  const f = fixture(800)
  f.choose("a")
  f.choose("b")
  decodes[1].resolve()
  await flush()
  decodes[0].resolve()
  await flush()
  expect(f.image.url).toBe("blob:test-1")
  expect(f.image.previous).toBeUndefined()
  expect(f.image.error).toBe("")
  expect(revoked).toContain("blob:test-0")
})
