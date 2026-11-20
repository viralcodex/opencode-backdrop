import { afterEach, expect, jest, spyOn, test } from "bun:test"
import { batch, createMemo, createRoot, createSignal } from "solid-js"
import type { WallpaperChoice } from "./model"
import { createWallpaperImage, createWallpaperVisibility } from "./render"

const data = "data:image/png;base64,YWJj"
const originalImage = Object.getOwnPropertyDescriptor(globalThis, "Image")
let dispose: (() => void) | undefined
let decodes: { resolve: () => void; reject: () => void }[]
let urls: string[]
let revoked: string[]

function fixture(duration = 0, animateVisibility = false) {
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
  let image!: ReturnType<typeof createWallpaperImage>
  let visibility: ReturnType<typeof createWallpaperVisibility> | undefined
  let setEnabled!: (enabled: boolean) => void
  let setReducedMotion!: (reduced: boolean) => void
  createRoot((cleanup) => {
    dispose = cleanup
    const [selected, setSelected] = createSignal<WallpaperChoice>()
    const [enabled, updateEnabled] = createSignal(false)
    const [motion, updateMotion] = createSignal(false)
    setEnabled = (value) => { updateEnabled(value) }
    setReducedMotion = (value) => { updateMotion(value) }
    visibility = animateVisibility ? createWallpaperVisibility(enabled, () => !!image.url, motion) : undefined
    const source = visibility ? createMemo<WallpaperChoice | undefined>(() => enabled() ? selected() : visibility?.enabled() ? image.choice : undefined) : selected
    select = (choice) => {
      if (!visibility) { setSelected(choice); return }
      batch(() => { if (choice) setSelected(choice); updateEnabled(!!choice) })
    }
    image = createWallpaperImage(source, async () => data, () => duration)
  })
  const choose = (id: string) => select({ id, title: id, version: "1", image: data })
  return { image, choose, select, setEnabled, setReducedMotion, visibility }
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

test("preserves the last readable image on failure and clears it when its source is removed", async () => {
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

test("holds the decoded wallpaper through off fades, reverses quick toggles, and cancels pending image changes", async () => {
  jest.useFakeTimers()
  const f = fixture(0, true)
  f.choose("a")
  expect(f.visibility?.fade()).toBeUndefined()
  decodes[0].resolve()
  await flush()
  expect(f.visibility?.fade()?.show).toBe(true)
  jest.advanceTimersByTime(800)
  f.select(undefined)
  expect(f.visibility?.fade()?.show).toBe(false)
  expect(f.image.url).toBe("blob:test-0")
  jest.advanceTimersByTime(400)
  f.setEnabled(true)
  expect(f.visibility?.fade()?.show).toBe(true)
  expect(decodes).toHaveLength(1)
  jest.advanceTimersByTime(800)
  expect(revoked).toEqual([])
  f.choose("b")
  f.select(undefined)
  expect(decodes).toHaveLength(2)
  decodes[1].resolve()
  await flush()
  expect(f.image.choice?.id).toBe("a")
  jest.advanceTimersByTime(799)
  expect(f.image.url).toBe("blob:test-0")
  jest.advanceTimersByTime(1)
  expect(f.image.url).toBe("")
  expect(revoked.sort()).toEqual(["blob:test-0", "blob:test-1"])
  expect(jest.getTimerCount()).toBe(0)
  f.choose("a")
  decodes[2].resolve()
  await flush()
  f.setReducedMotion(true)
  expect(f.visibility?.fade()).toBeUndefined()
  f.select(undefined)
  expect(f.image.url).toBe("")
  expect(jest.getTimerCount()).toBe(0)
})
