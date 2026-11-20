import { Command, Plugin, SettingsPage, Store, createKeyed } from "@opencode/plugin/gui"
import { batch, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { Schema } from "effect"
import { wallpaperCommand } from "./command"
import { Catalog } from "./contract"
import { changeWallpaper, setWallpaperEnabled, wallpaperCatalog, wallpaperTitle, type WallpaperChoice } from "./model"
import { appearanceKeys, StoredPreferences, initial, wallpaperFadeDuration } from "./preferences"
import { createWallpaperImage, createWallpaperVisibility, type WallpaperReader } from "./render"
import { imageError, thumbnailBlob } from "./image"
import { createWallpaperErrorReporter } from "./errors"
import { createThumbnailCache } from "./thumbnail-cache"
import { alignWallpaperHeaders } from "./backdrop"
import { createWallpaperStyles, wallpaperCanvasStyle, wallpaperVariableStyle } from "./style"
import { WallpaperSettings } from "./settings"
import { WallpaperPicker } from "./picker"
import { createWallpaperSlideshow } from "./slideshow"
import { createWallpaperVisibilityAnimation, fadeWallpaper, wallpaperTransitionStyle } from "./transition"
import en from "./i18n/en"
import css from "./settings.css?inline"

export default Plugin.define({
  stores: { preferences: Store.global(StoredPreferences, initial) },
  i18n: { en },
  async main(ctx) {
    const { createCatalog, wallpaperFolder, wallpaperFolderLabel } = await import("./catalog")
    ctx.signal.throwIfAborted()
    const folder = ctx.storage.store("folder", { schema: Schema.String, initial: "" })
    let catalog = createCatalog(wallpaperFolder(folder.value || (ctx.options.folder ?? ctx.options.folders)), changed)
    ctx.onCleanup(() => catalog.dispose())
    let lastError = ""
    const state = () => {
      const value = catalog.state()
      return { ...value, folderLabel: wallpaperFolderLabel(value.folder) }
    }
    function changed() {
      const error = state().error
      if (error && error !== lastError) ctx.log.write("error", "wallpaper folder scan failed", { error })
      lastError = error
      provider.changed()
    }
    const provider = ctx.provide(Catalog, {
      state,
      refresh: () => catalog.refresh(),
      async setFolder(value, caller) {
        caller.signal.throwIfAborted()
        ctx.signal.throwIfAborted()
        const selected = wallpaperFolder(value)
        folder.set(selected)
        catalog.dispose()
        catalog = createCatalog(selected, changed)
        changed()
        return catalog.refresh()
      },
      async read(request, caller) {
        return catalog.read(request, AbortSignal.any([caller.signal, ctx.signal]))
      },
    })
    await catalog.refresh()
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
      !image.loading && !image.previous && !visibility.fade() && (!!image.url || !!image.error),
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
    const visibility = createWallpaperVisibility(() => settings.value.enabled, () => !!image.url, reducedMotion)
    const painted = createMemo(() => settings.value.enabled ? selected() : visibility.enabled() ? image.choice : undefined)
    const image = createWallpaperImage(painted, read, () =>
      settings.value.slideshow && settings.value.transition === "fade" && !reducedMotion()
        ? wallpaperFadeDuration : 0,
    )
    const reportImage = (choice: WallpaperChoice, error: string) => report(
      `image:${choice.id}:${choice.version}`, ctx.t("title"),
      error ? [`${wallpaperTitle(choice, ctx.t)}: ${imageError(error, ctx.t)}`] : [],
    )
    const thumbnails = createThumbnailCache(async (choice, signal) => {
      try {
        const thumbnail = await thumbnailBlob(choice.image ?? await read(choice, signal), signal)
        reportImage(choice, "")
        return thumbnail
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
      if (state) report(`folder:${state.folder}`, ctx.t("folders.title"),
        state.error ? state.error.split("\n").map((error) => error.replace(/image\.[A-Za-z]+$/, (key) => ctx.t(key))) : [])
      const choice = selected()
      if (choice && !image.loading) reportImage(choice, image.error)
      const preferences = ctx.stores.preferences.value
      const missing = preferences.enabled && preferences.preset.startsWith("file:") && state?.ready && !state.error && !choice
      report(`missing:${preferences.preset}`, ctx.t("title"), missing ? [ctx.t("folders.missing")] : [])
      report.retain([
        ...images().map((image) => `image:${image.id}:${image.version}`),
        `folder:${state?.folder ?? ""}`, `missing:${preferences.preset}`, "refresh",
      ])
    })
    const styles = createWallpaperStyles(css, wallpaperCanvasStyle + wallpaperTransitionStyle)
    onCleanup(styles.dispose)
    const variables = createMemo(() => wallpaperVariableStyle({ ...settings.value, enabled: visibility.enabled() }, image.url))
    createEffect(() => styles.update(variables()))
    createKeyed(() => image.url ? { url: image.url, width: image.width, height: image.height, fit: settings.value.fit } : undefined,
      (frame) => onCleanup(alignWallpaperHeaders({ image: frame, fit: frame.fit })),
      { equals: (left, right) => left?.url === right?.url && left?.fit === right?.fit },
    )
    createEffect(() => {
      const previous = image.previous
      if (!previous || reducedMotion() || !settings.value.enabled || !settings.value.slideshow || settings.value.transition === "none") return
      onCleanup(fadeWallpaper(previous, settings.value.fit, image.transition))
    })
    const visibilityAnimation = createWallpaperVisibilityAnimation()
    onCleanup(visibilityAnimation.clear)
    createEffect(() => {
      const fade = visibility.fade()
      if (fade) visibilityAnimation.fade(fade.show, fade.duration)
      else visibilityAnimation.clear()
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
          const refreshed = await catalog.refresh({ signal: ctx.signal })
          if (refreshed) report("refresh", ctx.t("folders.title"), [])
          return refreshed
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
