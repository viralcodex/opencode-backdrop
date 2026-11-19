import { createEffect, createMemo, createSignal, on, onCleanup, type Accessor } from "solid-js"
import { selectedWallpaper, type WallpaperChoice } from "./model"
import { slideshowControls, type WallpaperPreferences } from "./preferences"

export function nextWallpaper(current: string, images: readonly WallpaperChoice[]) {
  if (!images.length) return undefined
  const index = images.findIndex((image) => image.id === current)
  return images[(index + 1) % images.length]
}

// Automatic selections stay in the window, not in the shared preference store.
export function createWallpaperSlideshow(settings: Accessor<WallpaperPreferences>, images: Accessor<readonly WallpaperChoice[]>, ready: Accessor<boolean>) {
  const [automatic, setAutomatic] = createSignal<string>()
  const reset = () => { setAutomatic(undefined) }
  createEffect(on(() => [settings().enabled, settings().preset, settings().slideshow], reset, { defer: true }))
  const selected = createMemo(() => {
    const preferences = settings()
    if (!preferences.enabled) return undefined
    if (preferences.slideshow) return images().find((image) => image.id === automatic())
      ?? selectedWallpaper(preferences, images()) ?? images()[0]
    return selectedWallpaper(preferences, images())
  })
  createEffect(() => {
    const preferences = settings()
    const current = selected()
    if (!preferences.enabled || !preferences.slideshow || !current || images().length < 2 || !ready()) return
    const timer = setTimeout(() => setAutomatic(nextWallpaper(current.id, images())?.id), (preferences.duration ?? slideshowControls.duration) * 1000)
    onCleanup(() => clearTimeout(timer))
  })
  return { selected, reset }
}
