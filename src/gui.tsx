import { Command, Plugin, SettingsPage, Store } from "@opencode/plugin/gui"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Schema } from "effect"
import { wallpaperCommand } from "./command"
import { Catalog } from "./contract"
import { changeWallpaper, setWallpaperEnabled, wallpaperCatalog, wallpaperTitle, type WallpaperChoice } from "./model"
import { appearanceKeys, Preferences, initial, slideshowControls, wallpaperFadeDuration } from "./preferences"
import { createWallpaperImage, type WallpaperReader } from "./render"
import { imageError, thumbnailBlob } from "./image"
import { createWallpaperErrorReporter } from "./errors"
import { createThumbnailCache } from "./thumbnail-cache"
import { alignWallpaperHeaders } from "./backdrop"
import { wallpaperCanvasStyle, wallpaperVariableStyle } from "./style"
import { WallpaperSettings } from "./settings"
import { WallpaperPicker } from "./picker"
import { createWallpaperSlideshow } from "./slideshow"
import { fadeWallpaper, wallpaperTransitionStyle } from "./transition"
import en from "./i18n/en"
import css from "./settings.css?inline"

export default Plugin.define({
  stores: { preferences: Store.global(Preferences, initial) },
  i18n: { en },
  async main(ctx) {
    const { createCatalog, wallpaperFolder, wallpaperFolderLabel } = await import("./catalog")
    let catalog: ReturnType<typeof createCatalog> | undefined
    let initializing: Promise<boolean> | undefined
    let fallback: typeof Catalog.spec.state.Type = { folder: "", ready: false, images: [], error: "" }
    const folder = () => ctx.storage.store("folder", { schema: Schema.String, initial: "" })
    ctx.onCleanup(() => catalog?.dispose())
    let lastError = ""
    const state = () => {
      const value = catalog?.state() ?? fallback
      return { ...value, folderLabel: wallpaperFolderLabel(value.folder) }
    }
    const changed = () => {
      const error = state().error
      if (error && error !== lastError) ctx.log.write("error", "wallpaper folder scan failed", { error })
      lastError = error
      provider.changed()
    }
    function refresh(): Promise<boolean> {
      if (ctx.signal.aborted) return Promise.resolve(false)
      if (catalog) return catalog.refresh()
      if (initializing) return initializing
      initializing = (async () => {
        try {
          const configured = ctx.options.folder ?? ctx.options.folders
          if (ctx.signal.aborted) return false
          catalog = createCatalog(wallpaperFolder(folder().value || configured), changed)
          changed()
          return await catalog.refresh()
        } catch (error) {
          if (!ctx.signal.aborted) {
            fallback = { ...fallback, ready: true, error: String(error) }
            changed()
          }
          return false
        }
      })().finally(() => { initializing = undefined })
      return initializing
    }
    const provider = ctx.provide(Catalog, {
      state,
      refresh,
      async setFolder(value, caller) {
        if (initializing) await initializing
        caller.signal.throwIfAborted()
        ctx.signal.throwIfAborted()
        const selected = wallpaperFolder(value)
        folder().set(selected)
        catalog?.dispose()
        catalog = createCatalog(selected, changed)
        changed()
        return catalog.refresh()
      },
      async read(request, caller) {
        if (!catalog) await refresh()
        if (!catalog) throw new Error(state().error || "Wallpaper folders are unavailable.")
        return catalog.read(request, caller.signal)
      },
    })
    await refresh()
  },
  setup(ctx) {
    const catalog = ctx.desktop ? ctx.main(Catalog) : undefined
    const report = createWallpaperErrorReporter(ctx.toast)
    const images = createMemo<WallpaperChoice[]>((previous) =>
      wallpaperCatalog(catalog?.state()?.images, ctx.stores.preferences.value, previous),
      [],
    )
    const settings = ctx.stores.preferences
    const slideshow = createWallpaperSlideshow(() => settings.value, images, () =>
      !image.loading && !image.previous && (!!image.url || !!image.error),
    )
    const selected = slideshow.selected
    const select = (choice: string) => batch(() => {
      slideshow.reset()
      settings.update((draft) => { changeWallpaper(draft, choice) })
    })
    const setEnabled = (enabled: boolean) => batch(() => {
      slideshow.reset()
      settings.update((draft) => { setWallpaperEnabled(draft, enabled, images()) })
    })
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
    const [reducedMotion, setReducedMotion] = createSignal(motion.matches)
    const motionChanged = () => setReducedMotion(motion.matches)
    motion.addEventListener("change", motionChanged)
    onCleanup(() => motion.removeEventListener("change", motionChanged))
    const read: WallpaperReader = async (choice, signal) => {
      if (!catalog) throw new Error("image.readError")
      return catalog.read({ id: choice.id, version: choice.version }, { signal: AbortSignal.any([signal, ctx.signal]) })
    }
    const image = createWallpaperImage(selected, read, () =>
      settings.value.slideshow && (settings.value.transition ?? slideshowControls.transition) === "fade" && !reducedMotion()
        ? wallpaperFadeDuration : 0,
    )
    const reportImage = (choice: WallpaperChoice, error: string) => report(
      `image:${choice.id}:${choice.version}`, ctx.t("title"),
      [`${wallpaperTitle(choice, ctx.t)}: ${imageError(error, ctx.t)}`],
    )
    const thumbnails = createThumbnailCache(async (choice, signal) => {
      try {
        return await thumbnailBlob(choice.image ?? await read(choice, signal), signal)
      } catch (error) {
        if (!signal.aborted && !ctx.signal.aborted) reportImage(choice, error instanceof Error ? error.message : String(error))
        throw error
      }
    }, { signal: ctx.signal })
    onCleanup(thumbnails.dispose)
    createEffect(() => thumbnails.retain(images()))
    createEffect(() => {
      if (ctx.signal.aborted) return
      const state = catalog?.state()
      if (state?.error) report(`folder:${state.folder}`, ctx.t("folders.title"),
        state.error.split("\n").map((error) => error.replace(/image\.[A-Za-z]+$/, (key) => ctx.t(key))))
      const choice = selected()
      if (choice && image.error) reportImage(choice, image.error)
      const preferences = ctx.stores.preferences.value
      if (preferences.enabled && preferences.preset.startsWith("file:") && state?.ready && !state.error && !choice) {
        report(`missing:${preferences.preset}`, ctx.t("title"), [ctx.t("folders.missing")])
      }
    })
    const settingsStyle = document.createElement("style")
    const canvasStyle = document.createElement("style")
    const imageStyle = document.createElement("style")
    settingsStyle.dataset.wallpaperStyle = "settings"
    canvasStyle.dataset.wallpaperStyle = "canvas"
    imageStyle.dataset.wallpaperStyle = "image"
    settingsStyle.textContent = css
    canvasStyle.textContent = wallpaperCanvasStyle + wallpaperTransitionStyle
    canvasStyle.disabled = true
    document.head.append(settingsStyle, canvasStyle, imageStyle)
    onCleanup(() => { settingsStyle.remove(); canvasStyle.remove(); imageStyle.remove() })
    createEffect(() => {
      const variables = wallpaperVariableStyle(settings.value, image.url)
      imageStyle.textContent = variables
      canvasStyle.disabled = !variables
    })
    createEffect(() => {
      if (!image.url || !image.width || !image.height) return
      onCleanup(alignWallpaperHeaders({ image: { width: image.width, height: image.height }, fit: ctx.stores.preferences.value.fit }))
    })
    createEffect(() => {
      const previous = image.previous
      if (!previous || reducedMotion() || !settings.value.enabled || !settings.value.slideshow || settings.value.transition === "none") return
      onCleanup(fadeWallpaper(previous, settings.value.fit, image.transition))
    })
    ctx.add(SettingsPage, {
      id: "wallpaper",
      icon: "outline-photo",
      get title() {
        return ctx.t("title")
      },
      get entries() {
        return ["enabled", ...(ctx.desktop ? ["folders"] : []), "preset", "slideshow", ...(settings.value.slideshow ? ["transition", "duration"] : []), ...appearanceKeys].map((id) => ({
          id: `wallpaper-${id}`,
          title: ctx.t(`${id}.title`),
          keywords: "wallpaper background image upload fit folder tint brightness contrast slideshow transition fade duration seconds",
        }))
      },
      render: () => (
        <WallpaperSettings
          images={images}
          selected={selected}
          select={select}
          setEnabled={setEnabled}
          thumbnails={thumbnails}
          folder={() => catalog?.state()?.folderLabel ?? catalog?.state()?.folder ?? ""}
          changeFolder={async (folder, signal) => {
            if (!catalog) throw new Error("Wallpaper folders are unavailable.")
            return catalog.setFolder(folder, { signal: AbortSignal.any([signal, ctx.signal]) })
          }}
        />
      ),
    })
    ctx.add(Command, () => ({
      id: "settings",
      title: ctx.t("title"),
      description: ctx.t("description"),
      keywords: "wallpaper background image",
      run: () => ctx.layout.settings("wallpaper"),
    }))
    ctx.add(Command, () =>
      wallpaperCommand(ctx, images, async () => {
        if (!catalog) return true
        try {
          return await catalog.refresh({ signal: ctx.signal })
        } catch (error) {
          if (!ctx.signal.aborted) report("refresh", ctx.t("folders.title"), [String(error)])
          return false
        }
      }, () => settings.value.enabled ? selected()?.id ?? settings.value.preset : "off", select,
      (options, choose) => {
        ctx.dialogs.open((dialog) => <WallpaperPicker
          options={options}
          enabled={() => settings.value.enabled}
          onToggle={setEnabled}
          onSelect={(value) => { dialog.close(); choose(value) }}
        />)
      }),
    )
  },
})
