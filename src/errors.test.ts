import { expect, test } from "bun:test"
import type { ToastOptions } from "@opencode/plugin/gui"
import { createWallpaperErrorReporter } from "./errors"

test("dismissed background errors do not return on polling, retries or Settings reopenings", () => {
  const shown: ToastOptions[] = []
  const report = createWallpaperErrorReporter({ show(options) { shown.push(options); return { dismiss() {} } } })
  report("folder", "Wallpaper folder", ["example.jpg: too large", "other.png: empty"])
  // No toast lifecycle callback is needed. Once reported, the scan remains seen
  // even after its toast closes or its error temporarily clears during a retry.
  report("folder", "Wallpaper folder", [])
  report("folder", "Wallpaper folder", ["other.png: empty", "example.jpg: too large"])
  expect(shown).toEqual([{
    variant: "error", icon: "outline-photo", title: "Wallpaper folder",
    description: "example.jpg: too large\n\nother.png: empty",
  }])
  report("folder", "Wallpaper folder", ["example.jpg: too large", "new.webp: unreadable"])
  expect(shown[1]?.description).toBe("new.webp: unreadable")
  expect(shown).toHaveLength(2)
})

test("image failures are shared across the active image and thumbnails, but new versions can notify", () => {
  const shown: ToastOptions[] = []
  const report = createWallpaperErrorReporter({ show(options) { shown.push(options); return { dismiss() {} } } })
  report("image:example:1", "Wallpapers", ["Unreadable image", "Unreadable image", ""])
  report("image:example:1", "Wallpapers", ["Unreadable image"])
  expect(shown).toHaveLength(1)
  report("image:example:2", "Wallpapers", ["Unreadable image"])
  expect(shown).toHaveLength(2)
})
