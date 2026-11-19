import { afterEach, expect, jest, test } from "bun:test"
import { batch, createRoot, createSignal } from "solid-js"
import { createStore } from "solid-js/store"
import { initial } from "./preferences"
import { createWallpaperSlideshow } from "./slideshow"

const choices = ["a", "b", "c"].map((id) => ({ id, title: id, version: "1" }))
let dispose: (() => void) | undefined

afterEach(() => { dispose?.(); dispose = undefined; jest.useRealTimers() })

function fixture() {
  jest.useFakeTimers()
  return createRoot((cleanup) => {
    dispose = cleanup
    const [settings, update] = createStore({ ...initial, enabled: true, preset: "a", slideshow: true, duration: 5 })
    const [images, setImages] = createSignal(choices)
    const [ready, setReady] = createSignal(true)
    const slideshow = createWallpaperSlideshow(() => settings, images, ready)
    return { ...slideshow, settings, update, setImages, setReady }
  })
}

test("cycles the gallery in order and wraps without rewriting the saved selection", () => {
  const f = fixture()
  for (const id of ["b", "c", "a"]) {
    jest.advanceTimersByTime(4999)
    expect(f.selected()?.id).not.toBe(id)
    jest.advanceTimersByTime(1)
    expect(f.selected()?.id).toBe(id)
    expect(f.settings.preset).toBe("a")
  }
  f.setImages([])
  expect(f.selected()).toBeUndefined()
  expect(jest.getTimerCount()).toBe(0)
})

test("pauses during loading or transitions and stops for static, disabled, or single-image galleries", () => {
  const f = fixture()
  jest.advanceTimersByTime(4000)
  f.setReady(false)
  jest.advanceTimersByTime(10000)
  expect(f.selected()?.id).toBe("a")
  f.setReady(true)
  jest.advanceTimersByTime(4999)
  expect(f.selected()?.id).toBe("a")
  jest.advanceTimersByTime(1)
  expect(f.selected()?.id).toBe("b")
  f.update("slideshow", false)
  jest.advanceTimersByTime(10000)
  expect(f.selected()?.id).toBe("a")
  expect(jest.getTimerCount()).toBe(0)
  f.update({ slideshow: true, enabled: false })
  expect(f.selected()).toBeUndefined()
  expect(jest.getTimerCount()).toBe(0)
  f.update("enabled", true)
  f.setImages([choices[0]])
  expect(jest.getTimerCount()).toBe(0)
})

test("restarts on manual selections and duration changes, recovers from removal, and clears timers on cleanup", () => {
  const f = fixture()
  jest.advanceTimersByTime(5000)
  jest.advanceTimersByTime(4000)
  batch(() => { f.reset(); f.update("preset", "b") })
  jest.advanceTimersByTime(4999)
  expect(f.selected()?.id).toBe("b")
  jest.advanceTimersByTime(1)
  expect(f.selected()?.id).toBe("c")
  f.reset()
  expect(f.selected()?.id).toBe("b")
  f.update("preset", "c")
  jest.advanceTimersByTime(4000)
  f.update("duration", 10)
  jest.advanceTimersByTime(9999)
  expect(f.selected()?.id).toBe("c")
  jest.advanceTimersByTime(1)
  expect(f.selected()?.id).toBe("a")
  f.setImages([choices[1]])
  expect(f.selected()?.id).toBe("b")
  f.setImages(choices)
  expect(jest.getTimerCount()).toBe(1)
  dispose?.()
  dispose = undefined
  expect(jest.getTimerCount()).toBe(0)
})
