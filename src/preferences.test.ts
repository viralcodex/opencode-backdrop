import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Preferences, StoredPreferences, initial, slideshowControls, wallpaperAppearance } from "./preferences"
import { wallpaperBackground } from "./style"

test("starts with wallpaper off and no selection while retaining unknown selections from old saves", () => {
  expect(Schema.decodeUnknownSync(Preferences)(initial)).toMatchObject({ enabled: false, preset: "", images: [] })
  const saved = { ...initial, enabled: true, preset: "legacy-selection" }
  expect(Schema.decodeUnknownSync(Preferences)(saved)).toEqual(saved)
})

test("migrates the single legacy upload once and encodes only the canonical image list", () => {
  const image = "data:image/png;base64,YWJj"
  const saved = { enabled: true, preset: "custom", image, imageName: "old.png", strength: 20, fit: "contain" }
  const settings = Schema.decodeUnknownSync(Preferences)(saved)
  expect(settings.images).toEqual([{ id: "custom", name: "old.png", image }])
  const encoded = Schema.encodeSync(Preferences)(settings)
  expect(encoded).not.toHaveProperty("image")
  expect(encoded).not.toHaveProperty("imageName")
  expect(Schema.decodeUnknownSync(Preferences)(encoded)).toEqual(settings)
  expect(Schema.decodeUnknownSync(StoredPreferences)({ ...saved, hidden: ["custom"] }).images).toEqual(settings.images)
})

test("rejects duplicate upload identities", () => {
  const upload = { id: "upload:one", name: "one.png", image: "data:image/png;base64,YWJj" }
  expect(() => Schema.decodeUnknownSync(Preferences)({ ...initial, images: [upload, upload] })).toThrow()
})

test("recovers unrelated persisted fields without dropping legacy or current uploads", () => {
  const image = "data:image/png;base64,YWJj"
  const uploaded = { id: "upload:one", name: "one.png", image }
  for (const changed of [{ tint: 101 }, { brightness: "bad" }, { fit: undefined }, { duration: 0 }, { strength: "bad" }]) {
    const saved = { enabled: true, preset: "custom", image, imageName: "old.png", images: [uploaded], strength: 20, fit: "contain", ...changed }
    const settings = Schema.decodeUnknownSync(StoredPreferences)(saved)
    expect(settings.images).toEqual([{ id: "custom", name: "old.png", image }, uploaded])
    expect(settings.enabled).toBe(true)
    expect(settings.preset).toBe("custom")
    const encoded = Schema.encodeSync(StoredPreferences)(settings)
    expect(encoded).not.toHaveProperty("image")
    expect(Schema.decodeUnknownSync(StoredPreferences)(encoded).images).toEqual(settings.images)
  }
})

describe("wallpaper slideshow preferences", () => {
  test("persists slideshow options at both display-time limits", () => {
    for (const [transition, duration] of [["none", slideshowControls.min], ["fade", slideshowControls.max]] as const) {
      const saved = { ...initial, slideshow: true, duration, transition }
      expect(Schema.decodeUnknownSync(Preferences)(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    }
  })

  test("rejects invalid display times and unknown transitions on writes", () => {
    for (const duration of [0, 4, 86401, 5.5, NaN, Infinity, "60"]) {
      expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, duration })).toThrow()
    }
    expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, transition: "spin" })).toThrow()
  })
})

describe("wallpaper tint and brightness", () => {
  test("migrates old strength to canonical tint and writes no legacy fields", () => {
    for (const strength of [5, 20, 45]) {
      const settings = Schema.decodeUnknownSync(Preferences)({ enabled: true, preset: "", image: "", strength, fit: "cover", hidden: ["file:old"] })
      expect(wallpaperAppearance(settings).tint).toBe(100 - strength)
      expect(wallpaperBackground(settings, "blob:wallpaper")["--wallpaper-filter"]).toContain("brightness(100%)")
      expect(settings.tint).toBe(100 - strength)
      expect(settings.brightness).toBe(100)
      const encoded = Schema.encodeSync(Preferences)(settings)
      expect(encoded).not.toHaveProperty("strength")
      expect(encoded).not.toHaveProperty("hidden")
      expect(encoded).not.toHaveProperty("image")
      expect(Schema.decodeUnknownSync(Preferences)(encoded)).toEqual(settings)
    }
  })

  test("persists independent tint and brightness, including zero tint", () => {
    const settings = Schema.decodeUnknownSync(Preferences)({ ...initial, enabled: true, tint: 0, brightness: 150 })
    const saved = Schema.decodeUnknownSync(Preferences)(JSON.parse(JSON.stringify(settings)))
    expect(wallpaperAppearance(saved).tint).toBe(0)
    expect(wallpaperBackground(saved, "blob:wallpaper")).toEqual({
      "--wallpaper-image": 'url("blob:wallpaper")',
      "--wallpaper-fit": "cover",
      "--wallpaper-tint": "color-mix(in srgb, var(--v2-background-bg-base) 0%, transparent)",
      "--wallpaper-filter": "brightness(150%) contrast(85%) saturate(90%)",
    })
    expect(wallpaperBackground({ ...saved, enabled: false }, "blob:wallpaper")["--wallpaper-image"]).toBe("none")
    expect(wallpaperBackground({ ...saved, enabled: false }, "blob:wallpaper")["--wallpaper-filter"]).toBe("none")
    expect(wallpaperBackground(saved, "")["--wallpaper-tint"]).toBe("transparent")
    expect(wallpaperBackground(saved, "")["--wallpaper-filter"]).toBe("none")
  })

  test.each([
    ["tint", -1], ["tint", 101], ["tint", 25.5],
    ["brightness", 24], ["brightness", 151], ["brightness", 100.5],
  ])("rejects invalid %s value %s on writes", (property, value) => {
    expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, [property]: value })).toThrow()
  })
})
