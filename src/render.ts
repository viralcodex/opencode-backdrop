import { createEffect, createMemo, createRenderEffect, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { decodeWallpaper, wallpaperBlob } from "./image"
import { sameWallpaper, type WallpaperChoice } from "./model"
import type { ThumbnailCache, ThumbnailLease } from "./thumbnail-cache"

export type WallpaperReader = (image: WallpaperChoice, signal: AbortSignal) => Promise<string>
export type WallpaperImage = ReturnType<typeof createWallpaperImage>

function imageSource(selected: Accessor<WallpaperChoice | undefined>) {
  return createMemo(() => {
    const choice = selected()
    return choice ? { ...choice } : undefined
  }, undefined, { equals: sameWallpaper })
}

export type WallpaperFrame = { url: string; width: number; height: number }

export function createWallpaperImage(selected: Accessor<WallpaperChoice | undefined>, read: WallpaperReader, transition: Accessor<number> = () => 0) {
  const [state, setState] = createStore({ url: "", width: 0, height: 0, loading: false, error: "", previous: undefined as WallpaperFrame | undefined, transition: 0 })
  let current: WallpaperFrame | undefined
  let previous: WallpaperFrame | undefined
  let expiry: ReturnType<typeof setTimeout> | undefined
  const releasePrevious = () => {
    clearTimeout(expiry)
    expiry = undefined
    if (previous) URL.revokeObjectURL(previous.url)
    previous = undefined
    setState({ previous: undefined, transition: 0 })
  }
  onCleanup(() => {
    releasePrevious()
    if (current) URL.revokeObjectURL(current.url)
  })
  const source = imageSource(selected)
  createEffect(() => {
    const choice = source()
    const controller = new AbortController()
    let url = ""
    onCleanup(() => {
      controller.abort()
      if (url) URL.revokeObjectURL(url)
      url = ""
    })
    setState({ loading: !!choice, error: "" })
    if (!choice) {
      releasePrevious()
      if (current) URL.revokeObjectURL(current.url)
      current = undefined
      setState({ url: "", width: 0, height: 0 })
      return
    }
    void (async () => {
      try {
        const data = choice.image ?? await read(choice, controller.signal)
        controller.signal.throwIfAborted()
        url = URL.createObjectURL(wallpaperBlob(data))
        const image = await decodeWallpaper(url, controller.signal)
        controller.signal.throwIfAborted()
        releasePrevious()
        const duration = untrack(transition)
        if (current && duration > 0) previous = current
        else if (current) URL.revokeObjectURL(current.url)
        current = { url, width: image.naturalWidth, height: image.naturalHeight }
        // The frame now owns this URL. Source cleanup only releases pending reads.
        url = ""
        setState({ ...current, previous, transition: previous ? duration : 0, loading: false, error: "" })
        if (previous) expiry = setTimeout(releasePrevious, duration)
      } catch (error) {
        if (url) URL.revokeObjectURL(url)
        url = ""
        if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
  })
  return state
}

export function createWallpaperThumbnail(selected: Accessor<WallpaperChoice | undefined>, cache: ThumbnailCache) {
  const [state, setState] = createStore({ url: "", width: 0, height: 0, loading: false, error: "" })
  const source = imageSource(selected)
  createRenderEffect(() => {
    const choice = source()
    const controller = new AbortController()
    let lease: ThumbnailLease | undefined
    onCleanup(() => { controller.abort(); lease?.release() })
    setState({ url: "", width: 0, height: 0, loading: !!choice, error: "" })
    if (!choice) return
    try {
      lease = cache.acquire(choice)
      if (lease.value) {
        setState({ ...lease.value, loading: false })
        return
      }
      void lease.ready.then((thumbnail) => {
        if (!controller.signal.aborted) setState({ ...thumbnail, loading: false })
      }, (error: unknown) => {
        if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
      })
    } catch (error) {
      setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
    }
  })
  return state
}
