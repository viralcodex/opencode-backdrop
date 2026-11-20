import { batch, createEffect, createMemo, createRenderEffect, createSignal, on, onCleanup, untrack, type Accessor } from "solid-js"
import { createStore } from "solid-js/store"
import { decodeWallpaper, wallpaperBlob } from "./image"
import { sameWallpaper, type WallpaperChoice } from "./model"
import type { ThumbnailCache, ThumbnailLease } from "./thumbnail-cache"
import { wallpaperFadeDuration } from "./preferences"

export type WallpaperReader = (image: WallpaperChoice, signal: AbortSignal) => Promise<string>

function imageSource(selected: Accessor<WallpaperChoice | undefined>) {
  return createMemo(() => {
    const choice = selected()
    return choice ? { ...choice } : undefined
  }, undefined, { equals: sameWallpaper })
}

export type WallpaperFrame = { url: string; width: number; height: number }

export function createWallpaperVisibility(enabled: Accessor<boolean>, loaded: Accessor<boolean>, reducedMotion: Accessor<boolean>) {
  const [paint, setPaint] = createSignal(enabled())
  const [fade, setFade] = createSignal<{ show: boolean; duration: number }>()
  let timer: ReturnType<typeof setTimeout> | undefined
  const cancel = () => { clearTimeout(timer); timer = undefined }
  const start = (show: boolean) => {
    cancel()
    const duration = loaded() && !reducedMotion() ? wallpaperFadeDuration : 0
    batch(() => {
      setFade(duration ? { show, duration } : undefined)
      if (!duration && !show) setPaint(false)
    })
    if (duration) timer = setTimeout(() => {
      timer = undefined
      batch(() => { setFade(undefined); if (!show) setPaint(false) })
    }, duration)
  }
  createEffect(on(() => [enabled(), reducedMotion()], ([show, reduced]) => {
    cancel()
    if (!show) return start(false)
    setPaint(true)
    if (reduced) setFade(undefined)
  }))
  createEffect(on(() => enabled() && loaded(), (show, previous) => {
    if (show && !previous) start(true)
  }))
  onCleanup(cancel)
  return { enabled: paint, fade }
}

export function createWallpaperImage(selected: Accessor<WallpaperChoice | undefined>, read: WallpaperReader, transition: Accessor<number> = () => 0) {
  const [state, setState] = createStore({ url: "", width: 0, height: 0, loading: false, error: "", choice: undefined as WallpaperChoice | undefined, previous: undefined as WallpaperFrame | undefined, transition: 0 })
  let expiry: ReturnType<typeof setTimeout> | undefined
  const releasePrevious = () => {
    clearTimeout(expiry)
    expiry = undefined
    if (state.previous) URL.revokeObjectURL(state.previous.url)
    setState({ previous: undefined, transition: 0 })
  }
  onCleanup(() => {
    releasePrevious()
    if (state.url) URL.revokeObjectURL(state.url)
  })
  const source = imageSource(selected)
  createEffect(on(source, (choice) => {
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
      if (state.url) URL.revokeObjectURL(state.url)
      setState({ url: "", width: 0, height: 0, choice: undefined })
      return
    }
    if (state.url && sameWallpaper(choice, state.choice)) {
      setState({ loading: false })
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
        const previous = state.url && duration > 0 ? { url: state.url, width: state.width, height: state.height } : undefined
        if (state.url && !previous) URL.revokeObjectURL(state.url)
        const current = { url, width: image.naturalWidth, height: image.naturalHeight }
        url = ""
        setState({ ...current, choice, previous, transition: previous ? duration : 0, loading: false, error: "" })
        if (previous) expiry = setTimeout(releasePrevious, duration)
      } catch (error) {
        if (url) URL.revokeObjectURL(url)
        url = ""
        if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : String(error) })
      }
    })()
  }))
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
