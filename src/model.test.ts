import { describe, expect, test } from "bun:test"
import type { Mutable, SelectOptions } from "@opencode/plugin/gui"
import { Schema } from "effect"
import { wallpaperCommand } from "./command"
import { canRemoveWallpaper, changeWallpaper, checkWallpaperDuplicate, removeWallpaper, selectedWallpaper, wallpaperCatalog, wallpaperTitle, type WallpaperChoice } from "./model"
import { Preferences, initial } from "./preferences"

const customImage = "data:image/png;base64,aGVsbG8="

test("resolves only the selected upload or folder image", () => {
  const settings = Schema.decodeUnknownSync(Preferences)({ ...initial, enabled: true, preset: "custom", image: customImage })
  const file = { id: "file:example.png", title: "example", version: "1" }
  const images = wallpaperCatalog([file], settings)
  expect(selectedWallpaper(settings, images)?.image).toBe(customImage)
  const selected = { ...settings, preset: file.id }
  expect(selectedWallpaper(selected, images)).toBe(file)
})

describe("removing wallpapers", () => {
  const file = { id: "file:example.png", title: "example", version: "1" }

  test("refuses to remove a folder image whether selected or not", () => {
    const choices = wallpaperCatalog([file], { image: customImage })
    for (const selected of [file.id, "custom"]) {
      const settings = Schema.decodeUnknownSync(Preferences)({ ...initial, preset: selected, image: customImage, strength: 37, fit: "contain" })
      const before = structuredClone(settings)
      removeWallpaper(settings, file, choices)
      expect(settings).toEqual(before)
    }
  })

  test("restores previously hidden folder images in the gallery and picker", async () => {
    const settings = Schema.decodeUnknownSync(Preferences)({ ...initial, image: customImage, hidden: [file.id, "custom"] })
    const images = () => wallpaperCatalog([file], settings)
    const world = picker(undefined, { preferences: settings, images })
    await world.command.run()
    expect(world.requests[0]?.options.map((option) => option.value)).toEqual([file.id, "custom", "off", "settings"])
  })

  test("removes an unselected uploaded image without changing the active folder wallpaper", async () => {
    const settings = { ...initial, enabled: true, preset: file.id, image: customImage, strength: 37, fit: "contain" as const }
    const choices = wallpaperCatalog([file], settings)
    removeWallpaper(settings, choices.at(-1)!, choices)
    const saved = Schema.decodeUnknownSync(Preferences)(JSON.parse(JSON.stringify(settings)))
    expect(saved).toEqual({ ...initial, enabled: true, preset: file.id, strength: 37, fit: "contain" })
    const world = picker(undefined, { preferences: saved, images: () => wallpaperCatalog([{ ...file, version: "2" }], saved, choices) })
    await world.command.run()
    expect(world.requests[0]?.options.some((option) => option.value === "custom")).toBe(false)
    expect(world.requests[0]?.options.some((option) => option.value === file.id)).toBe(true)
  })

  test("removing the active uploaded image selects the first remaining wallpaper and allows another upload", () => {
    const settings = { ...initial, enabled: true, preset: "custom", image: customImage, imageName: "saved.png", strength: 37, fit: "contain" as const }
    const choices = wallpaperCatalog([file], settings)
    removeWallpaper(settings, choices.at(-1)!, choices)
    const saved = Schema.decodeUnknownSync(Preferences)(JSON.parse(JSON.stringify(settings)))
    expect(saved).toEqual({ ...initial, enabled: true, preset: file.id, strength: 37, fit: "contain" })
    expect(() => checkWallpaperDuplicate({ name: "saved.png", image: customImage }, saved, wallpaperCatalog([file]))).not.toThrow()
  })

  test("turns off the background if the uploaded image is the only provided choice", () => {
    const settings = { ...initial, enabled: true, preset: "custom", image: customImage }
    const choices = wallpaperCatalog([], settings).filter(canRemoveWallpaper)
    removeWallpaper(settings, choices[0], choices)
    expect(settings).toEqual({ ...initial, enabled: false })
  })

  test("removing the saved selection while wallpaper is off keeps it off", () => {
    const settings = { ...initial, enabled: false, preset: "custom", image: customImage }
    const choices = wallpaperCatalog([file], settings)
    removeWallpaper(settings, choices.at(-1)!, choices)
    expect(settings).toEqual({ ...initial, enabled: false, preset: file.id })
  })
})

describe("custom uploads", () => {
  test("keeps the legacy upload alongside multiple saved images and removes them independently", () => {
    const settings = Schema.decodeUnknownSync(Preferences)({ ...initial, preset: "upload:first", image: customImage, imageName: "legacy.png", images: [
      { id: "upload:first", name: "first.png", image: "data:image/png;base64,YWxwaGE=" },
      { id: "upload:second", name: "second.webp", image: "data:image/webp;base64,YmV0YQ==" },
    ] })
    const choices = wallpaperCatalog([], settings)
    expect(choices.filter(canRemoveWallpaper).map((image) => wallpaperTitle(image, (key) => key))).toEqual(["legacy", "first", "second"])
    removeWallpaper(settings, choices.find((image) => image.id === "upload:first")!, choices)
    expect(settings.preset).toBe("upload:second")
    expect(settings.image).toBe(customImage)
    expect(settings.images?.map((image) => image.id)).toEqual(["upload:second"])
    const remaining = wallpaperCatalog([], settings)
    removeWallpaper(settings, remaining.find((image) => image.id === "upload:second")!, remaining)
    expect(settings.image).toBe(customImage)
    expect(settings.images).toEqual([])
  })

  test("checks duplicates across every upload and treats extensions as display-name differences only", () => {
    const settings = { ...initial, images: [
      { id: "upload:first", name: "first.png", image: customImage },
      { id: "upload:second", name: "second.webp", image: "data:image/webp;base64,YmV0YQ==" },
    ] }
    expect(() => checkWallpaperDuplicate({ name: "FIRST.jpg" }, settings, wallpaperCatalog([], settings))).toThrow("image.duplicateName")
    expect(() => checkWallpaperDuplicate({ name: "renamed.png", image: "data:image/png;base64,YmV0YQ==" }, settings, [])).toThrow("image.duplicateImage")
  })

  test("shows the saved filename in the gallery and picker across refreshes", async () => {
    const settings = { ...initial, image: customImage, imageName: "My wallpaper.png" }
    const choices = wallpaperCatalog([], settings)
    expect(wallpaperTitle(choices.at(-1)!, (key) => key)).toBe("My wallpaper")
    expect(wallpaperCatalog([], settings, choices).at(-1)).toBe(choices.at(-1))
    const world = picker(undefined, { preferences: settings })
    await world.command.run()
    expect(world.requests[0]?.options.find((option) => option.value === "custom")?.title).toBe("My wallpaper")
  })

  test.each([
    ["saved.png", "saved.png"],
    [" SAVED.PNG ", "saved.png"],
    ["Café.png", "Cafe\u0301.PNG"],
  ])("rejects filename %s matching saved filename %s", (name, imageName) => {
    expect(() => checkWallpaperDuplicate({ name }, { image: customImage, imageName }, [])).toThrow("image.duplicateName")
  })

  test("rejects matching folder filenames across nested and Windows paths", () => {
    const images = ["/images/nested/example.PNG", "C:\\images\\nested\\example.PNG"].map((file) => ({ id: `file:${encodeURIComponent(file)}`, title: "nested/example", version: "1" }))
    for (const image of images) {
      expect(() => checkWallpaperDuplicate({ name: "example.png" }, initial, [image])).toThrow("image.duplicateName")
    }
  })

  test("rejects repeated custom-image bytes with a new name or MIME label, including legacy saves", () => {
    const settings = { ...initial, image: customImage }
    for (const source of [customImage, customImage.replace("image/png", "image/jpeg")]) {
      expect(() => checkWallpaperDuplicate({ name: "renamed.png", image: source }, settings, [])).toThrow("image.duplicateImage")
    }
    expect(() => checkWallpaperDuplicate({ name: "different.png", image: "data:image/png;base64,b3RoZXI=" }, settings, [])).not.toThrow()
  })
})

describe("wallpaper slash picker", () => {
  test("offers current choices without an empty custom image and leaves preferences unchanged on cancel", async () => {
    const world = picker(undefined)
    await world.command.run()
    expect(world.requests[0]?.current).toBe("off")
    expect(world.requests[0]?.options.map((option) => option.value)).toEqual([
      "off",
      "settings",
    ])
    expect(world.value).toEqual(world.before)
  })

  test.each([
    ["file:example.png", false, "file:example.png", true],
    ["custom", false, "custom", true],
    ["off", true, "file:example.png", false],
  ] as const)("choosing %s preserves the saved image, fit and strength", async (choice, enabled, preset, shown) => {
    const world = picker(choice, { preferences: { enabled, preset: "file:example.png", image: customImage }, images: () => wallpaperCatalog([{ id: "file:example.png", title: "example", version: "1" }], { image: customImage }) })
    await world.command.run()
    expect(world.requests[0]?.current).toBe(enabled ? "file:example.png" : "off")
    expect(world.value).toEqual({ ...world.before, enabled: shown, preset })
    expect(world.pages).toEqual([])
  })

  test("opens full settings only when requested, without changing the wallpaper", async () => {
    const world = picker("settings")
    await world.command.run()
    expect(world.pages).toEqual(["wallpaper"])
    expect(world.value).toEqual(world.before)
  })

  test("refreshes the live catalog before opening and selects a newly discovered file", async () => {
    const images: WallpaperChoice[] = []
    const world = picker("file:example.png", {
      preferences: { enabled: false },
      images: () => wallpaperCatalog(images),
      refresh: async () => {
        images.push({ id: "file:example.png", title: "example", version: "new" })
        return true
      },
    })
    await world.command.run()
    expect(world.requests[0]?.options.find((option) => option.value === "file:example.png")?.title).toBe("example")
    expect(world.value).toEqual({ ...world.before, preset: "file:example.png", enabled: true })
  })

  test("keeps saved uploads, off and settings accessible when the folder refresh fails", async () => {
    const world = picker("off", { preferences: { image: customImage }, refresh: async () => false })
    await world.command.run()
    expect(world.requests[0]?.options.map((option) => option.value)).toEqual([
      "custom", "off", "settings",
    ])
    expect(world.value).toEqual({ ...world.before, enabled: false })
  })

  test.each(["before refresh", "during refresh", "during dialog"] as const)("cancellation %s prevents selection changes", async (stage) => {
    const controller = new AbortController()
    let refreshes = 0
    if (stage === "before refresh") controller.abort()
    const world = picker("settings", {
      signal: controller.signal,
      refresh: async () => {
        refreshes++
        if (stage === "during refresh") controller.abort()
        return true
      },
      onSelect: () => { if (stage === "during dialog") controller.abort() },
    })
    await world.command.run()
    expect(refreshes).toBe(stage === "before refresh" ? 0 : 1)
    expect(world.requests).toHaveLength(stage === "during dialog" ? 1 : 0)
    expect(world.value).toEqual(world.before)
  })
})

function picker(choice: string | undefined, config: {
  preferences?: Partial<typeof initial>
  refresh?: () => Promise<boolean>
  signal?: AbortSignal
  onSelect?: () => void
  images?: () => readonly WallpaperChoice[]
} = {}) {
  const value: Mutable<typeof initial> = { ...initial, strength: 37, fit: "contain", ...config.preferences, hidden: config.preferences?.hidden?.slice(), images: config.preferences?.images?.map((image) => ({ ...image })) }
  const before = structuredClone(value)
  const requests: SelectOptions<unknown>[] = []
  const pages: (string | undefined)[] = []
  const command = wallpaperCommand({
    t: (key) => key,
    signal: config.signal ?? new AbortController().signal,
    dialogs: {
      async select<T>(options: SelectOptions<T>) {
        requests.push(options)
        config.onSelect?.()
        return options.options.find((option) => option.value === choice)?.value
      },
    },
    layout: { settings: (page) => { pages.push(page) } },
  }, config.images ?? (() => wallpaperCatalog([], value)), config.refresh ?? (async () => true),
  () => value.enabled ? value.preset : "off", (selected) => changeWallpaper(value, selected))
  return { command, value, before, requests, pages }
}
