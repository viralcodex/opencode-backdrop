import { createMemo, createRenderEffect, createSignal, createUniqueId, For, on, onCleanup, onMount, Show, type Accessor } from "solid-js"
import { usePlugin } from "@opencode/plugin/gui"
import type definition from "./gui"
import { canRemoveWallpaper, changeWallpaper, checkWallpaperDuplicate, removeWallpaper, selectedWallpaper, wallpaperTitle, type WallpaperChoice } from "./model"
import { uploadImage } from "./image"
import { appearanceControls, appearanceKeys, slideshowControls, wallpaperAppearance, type WallpaperTransition } from "./preferences"
import type { ThumbnailCache } from "./thumbnail-cache"
import { WallpaperThumbnail } from "./thumbnail"

export function WallpaperSettings(props: {
  images: Accessor<readonly WallpaperChoice[]>
  selected: Accessor<WallpaperChoice | undefined>
  select: (choice: string) => void
  thumbnails: ThumbnailCache
  folder: Accessor<string>
  changeFolder: (folder: string, signal: AbortSignal) => Promise<boolean>
}) {
  const ctx = usePlugin<typeof definition>()
  const settings = ctx.stores.preferences
  const [request, setRequest] = createSignal<AbortController>()
  const [folderRequest, setFolderRequest] = createSignal<AbortController>()
  const [expanded, setExpanded] = createSignal(false)
  const [columns, setColumns] = createSignal(1)
  const galleryId = createUniqueId()
  let gallery!: HTMLDivElement
  let fileInput!: HTMLInputElement
  const selected = createMemo(() => selectedWallpaper(settings.value, props.images()))
  const appearance = createMemo(() => wallpaperAppearance(settings.value))
  const limit = () => columns() * 2 - 1
  const visibleImages = createMemo(() => expanded() ? props.images() : props.images().slice(0, limit()))
  onMount(() => {
    const measure = () => {
      const tracks = getComputedStyle(gallery).gridTemplateColumns
      setColumns(tracks === "none" ? 1 : tracks.trim().split(/\s+/).length)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(gallery)
    measure()
    onCleanup(() => observer.disconnect())
  })
  const cancelUpload = () => { request()?.abort(); setRequest(undefined) }
  onCleanup(() => { cancelUpload(); folderRequest()?.abort() })
  createRenderEffect(on(() => [settings.value.enabled, settings.value.preset, settings.value.image], cancelUpload, { defer: true }))

  function select(choice: string) {
    cancelUpload()
    props.select(choice)
  }

  async function upload(file: File) {
    cancelUpload()
    const controller = new AbortController()
    setRequest(controller)
    const signal = AbortSignal.any([controller.signal, ctx.signal])
    try {
      checkWallpaperDuplicate({ name: file.name }, settings.value, props.images())
      const source = await uploadImage(file, signal)
      if (signal.aborted) return
      checkWallpaperDuplicate({ name: file.name, image: source }, settings.value, props.images())
      settings.update((draft) => {
        const id = `upload:${Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) => byte.toString(16).padStart(2, "0")).join("")}`
        draft.images = [...(draft.images ?? []), { id, name: file.name, image: source }]
        changeWallpaper(draft, id)
      })
    } catch (error) {
      if (signal.aborted) return
      const message = error instanceof Error && error.message.startsWith("image.") ? ctx.t(error.message) : ctx.t("image.readError")
      ctx.toast.show({ variant: "error", title: ctx.t("title"), description: message })
    } finally {
      if (request() === controller) setRequest(undefined)
    }
  }

  async function chooseFolder() {
    if (!ctx.desktop || folderRequest()) return
    const controller = new AbortController()
    setFolderRequest(controller)
    const signal = AbortSignal.any([controller.signal, ctx.signal])
    try {
      const [folder] = await ctx.desktop.pick({ directory: true, title: ctx.t("folders.choose") })
      if (!folder || signal.aborted) return
      cancelUpload()
      await props.changeFolder(folder, signal)
    } catch (error) {
      if (!signal.aborted) ctx.toast.show({ variant: "error", title: ctx.t("folders.changeError"), description: String(error) })
    } finally {
      if (folderRequest() === controller) setFolderRequest(undefined)
    }
  }

  return (
    <ctx.ui.SettingsLayout title={ctx.t("title")} description={ctx.t("description")}>
      <div class="opencode-wallpaper-settings">
        <ctx.ui.SettingsSection>
          <ctx.ui.SettingsRow
            id="wallpaper-enabled"
            title={ctx.t("enabled.title")}
          >
            <ctx.ui.Switch
              label={ctx.t("enabled.title")}
              hideLabel
              checked={settings.value.enabled}
              disabled={!settings.value.enabled && !props.images().length}
              onChange={(value) => select(value ? selected()?.id ?? props.images()[0]?.id ?? "off" : "off")}
            />
          </ctx.ui.SettingsRow>
          <Show when={ctx.desktop}>
            <ctx.ui.SettingsRow
              id="wallpaper-folders"
              title={ctx.t("folders.title")}
              description={
                <div class="opencode-wallpaper-folder">
                  <span>{ctx.t("folders.description")}</span>
                  <code>{props.folder()}</code>
                </div>
              }
            >
              <ctx.ui.Button busy={!!folderRequest()} disabled={!!folderRequest()} onClick={() => void chooseFolder()}>
                {ctx.t("folders.choose")}
              </ctx.ui.Button>
            </ctx.ui.SettingsRow>
          </Show>
          <ctx.ui.SettingsRow id="wallpaper-preset" title={
            <div class="opencode-wallpaper-gallery-heading">
              <span>{ctx.t("preset.title")}</span>
              <ctx.ui.Select<"cover" | "contain">
                label={ctx.t("fit.title")}
                value={settings.value.fit}
                options={[
                  { value: "cover", label: ctx.t("fit.cover") },
                  { value: "contain", label: ctx.t("fit.contain") },
                ]}
                onChange={(value) => settings.update((draft) => { draft.fit = value })}
              />
            </div>
          }>
            <div ref={gallery} id={galleryId} class="opencode-wallpaper-gallery">
              <For each={visibleImages()}>
                {(preset) => (
                  <div class="opencode-wallpaper-tile">
                    <button
                      type="button"
                      class="opencode-wallpaper-choice"
                      aria-pressed={props.selected()?.id === preset.id}
                      onClick={() => select(preset.id)}
                    >
                      <WallpaperThumbnail choice={preset} cache={props.thumbnails} t={ctx.t} />
                      <span>{wallpaperTitle(preset, ctx.t)}</span>
                    </button>
                    <Show when={canRemoveWallpaper(preset)}>
                      <button
                        type="button"
                        class="opencode-wallpaper-remove"
                        aria-label={`${ctx.t("image.remove")}: ${wallpaperTitle(preset, ctx.t)}`}
                        title={`${ctx.t("image.remove")}: ${wallpaperTitle(preset, ctx.t)}`}
                        onClick={() => {
                          cancelUpload()
                          settings.update((draft) => { removeWallpaper(draft, preset, props.images()) })
                        }}
                      >
                        X
                      </button>
                    </Show>
                  </div>
                )}
              </For>
              <button
                type="button"
                class="opencode-wallpaper-add"
                aria-label={ctx.t(request() ? "image.loading" : "image.choose")}
                aria-busy={!!request()}
                disabled={!!request()}
                onClick={() => fileInput.click()}
              >
                <span class="opencode-wallpaper-add-icon" aria-hidden="true">+</span>
              </button>
            </div>
            <Show when={expanded() || props.images().length > limit()}>
              <div class="opencode-wallpaper-gallery-toggle">
                <ctx.ui.Button
                  aria-expanded={expanded()}
                  aria-controls={galleryId}
                  onClick={() => setExpanded((value) => !value)}
                >
                  {ctx.t(expanded() ? "gallery.showLess" : "gallery.showMore")}
                </ctx.ui.Button>
              </div>
            </Show>
            <input
              ref={fileInput}
              class="opencode-wallpaper-file-input"
              type="file"
              hidden
              accept="image/png,image/jpeg,image/webp"
              aria-label={ctx.t("image.choose")}
              disabled={!!request()}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                event.currentTarget.value = ""
                if (file) void upload(file)
              }}
            />
          </ctx.ui.SettingsRow>
          <ctx.ui.SettingsRow
            id="wallpaper-slideshow"
            title={ctx.t("slideshow.title")}
            description={ctx.t("slideshow.description")}
          >
            <ctx.ui.Switch
              label={ctx.t("slideshow.title")}
              hideLabel
              checked={!!settings.value.slideshow}
              disabled={!settings.value.slideshow && props.images().length < 2}
              onChange={(value) => settings.update((draft) => { draft.slideshow = value })}
            />
          </ctx.ui.SettingsRow>
          <ctx.ui.SettingsRow
            id="wallpaper-transition"
            title={ctx.t("transition.title")}
            description={ctx.t("transition.description")}
          >
            <ctx.ui.Select<WallpaperTransition>
              label={ctx.t("transition.title")}
              value={settings.value.transition ?? slideshowControls.transition}
              disabled={!settings.value.slideshow}
              options={[
                { value: "none", label: ctx.t("transition.none") },
                { value: "fade", label: ctx.t("transition.fade") },
              ]}
              onChange={(value) => settings.update((draft) => { draft.transition = value })}
            />
          </ctx.ui.SettingsRow>
          <ctx.ui.SettingsRow
            id="wallpaper-duration"
            title={ctx.t("duration.title")}
            description={ctx.t("duration.description")}
          >
            <label class="opencode-wallpaper-duration">
              <input
                type="number"
                min={slideshowControls.min}
                max={slideshowControls.max}
                step="1"
                value={settings.value.duration ?? slideshowControls.duration}
                disabled={!settings.value.slideshow}
                aria-label={ctx.t("duration.title")}
                onChange={(event) => {
                  const input = event.currentTarget
                  const value = input.valueAsNumber
                  if (Number.isInteger(value) && value >= slideshowControls.min && value <= slideshowControls.max) {
                    settings.update((draft) => { draft.duration = value })
                  } else input.value = String(settings.value.duration ?? slideshowControls.duration)
                }}
              />
              <span>{ctx.t("duration.seconds")}</span>
            </label>
          </ctx.ui.SettingsRow>
          <For each={appearanceKeys}>
            {(key) => <ctx.ui.SettingsRow
              id={`wallpaper-${key}`}
              title={ctx.t(`${key}.title`)}
              description={ctx.t(`${key}.description`)}
            >
              <label class="opencode-wallpaper-range">
                <input
                  type="range"
                  min={appearanceControls[key].min}
                  max={appearanceControls[key].max}
                  step="1"
                  value={appearance()[key]}
                  aria-label={ctx.t(`${key}.title`)}
                  onInput={(event) => settings.update((draft) => { draft[key] = event.currentTarget.valueAsNumber })}
                />
                <output>{appearance()[key]}%</output>
              </label>
            </ctx.ui.SettingsRow>}
          </For>
        </ctx.ui.SettingsSection>
      </div>
    </ctx.ui.SettingsLayout>
  )
}
