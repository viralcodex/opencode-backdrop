import type { Wallpaper } from "./contract"
import { imageBytes } from "./image"
import { initial, type UploadedWallpaper, type WallpaperPreferences } from "./preferences"

export type WallpaperChoice = typeof Wallpaper.Type & { readonly image?: string }
type SavedImages = Pick<WallpaperPreferences, "images">

export function sameWallpaper(left: WallpaperChoice | undefined, right: WallpaperChoice | undefined) {
  return left?.id === right?.id && left?.version === right?.version && left?.image === right?.image
}

export function selectedWallpaper(settings: Pick<WallpaperPreferences, "preset">, images: readonly WallpaperChoice[]) {
  return images.find((image) => image.id === settings.preset)
}

export function uploadedWallpapers(settings: SavedImages): readonly UploadedWallpaper[] {
  return settings.images
}

export function wallpaperCatalog(images: readonly (typeof Wallpaper.Type)[] = [], settings: SavedImages = initial, previous: readonly WallpaperChoice[] = []): WallpaperChoice[] {
  const saved = new Map(previous.map((image) => [image.id, image]))
  return [
    ...images,
    ...uploadedWallpapers(settings).map((upload) => {
      const title = wallpaperName(upload.name)
      const cached = saved.get(upload.id)
      return cached?.image === upload.image && cached.title === title
        ? cached : { id: upload.id, title, version: "custom", image: upload.image }
    }),
  ]
}

export function canRemoveWallpaper(choice: Pick<WallpaperChoice, "id">) {
  return choice.id === "custom" || choice.id.startsWith("upload:")
}

export function removeWallpaper(draft: { enabled: boolean; preset: string; images: readonly UploadedWallpaper[] }, choice: WallpaperChoice, images: readonly WallpaperChoice[]) {
  if (!canRemoveWallpaper(choice)) return
  draft.images = draft.images.filter((image) => image.id !== choice.id)
  if (draft.preset !== choice.id) return
  const next = images[images.findIndex((image) => image.id === choice.id) + 1] ?? images.find((image) => image.id !== choice.id)
  draft.preset = next?.id ?? initial.preset
  if (!next) draft.enabled = false
}

export function changeWallpaper(draft: { enabled: boolean; preset: string }, choice: string) {
  draft.enabled = choice !== "off"
  if (choice !== "off") draft.preset = choice
}

export function setWallpaperEnabled(draft: { enabled: boolean; preset: string }, enabled: boolean, images: readonly WallpaperChoice[]) {
  changeWallpaper(draft, enabled ? selectedWallpaper(draft, images)?.id ?? images[0]?.id ?? "off" : "off")
}

export function wallpaperTitle(image: WallpaperChoice, t: (key: string) => string) {
  if (canRemoveWallpaper(image)) return image.title || t("image.custom")
  return image.title
}

export function checkWallpaperDuplicate(upload: { name: string; image?: string }, settings: SavedImages, images: readonly WallpaperChoice[]) {
  const key = filenameKey(upload.name)
  const bytes = imageBytes(upload.image ?? "")
  for (const saved of uploadedWallpapers(settings)) {
    if (saved.name && filenameKey(saved.name) === key) throw new Error("image.duplicateName")
    if (bytes && bytes === imageBytes(saved.image)) throw new Error("image.duplicateImage")
  }
  for (const image of images) {
    const filename = wallpaperFilename(image.id)
    if (filename && filenameKey(filename) === key) throw new Error("image.duplicateName")
  }
}

function wallpaperFilename(id: string) {
  if (!id.startsWith("file:")) return ""
  const path = id.slice(5)
  return decodeURIComponent(path)
}

function filenameKey(name: string) {
  return wallpaperName(name).normalize("NFC").toLowerCase()
}

function wallpaperName(name: string) {
  const filename = (name.split(/[\\/]/).at(-1) ?? name).trim()
  return filename.replace(/\.(?:png|jpe?g|webp|svg)$/i, "") || filename
}
