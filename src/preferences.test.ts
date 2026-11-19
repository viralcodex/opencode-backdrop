import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Preferences, initial, slideshowControls, wallpaperAppearance } from "./preferences"
import { wallpaperBackground } from "./style"

test("starts with wallpaper off and no selection while retaining unknown selections from old saves", () => {
  expect(Schema.decodeUnknownSync(Preferences)(initial)).toMatchObject({ enabled: false, preset: "", image: "" })
  const saved = { ...initial, enabled: true, preset: "legacy-selection" }
  expect(Schema.decodeUnknownSync(Preferences)(saved)).toEqual(saved)
})

describe("wallpaper slideshow preferences", () => {
  test("persists slideshow options at both display-time limits", () => {
    for (const [transition, duration] of [["none", slideshowControls.min], ["fade", slideshowControls.max]] as const) {
      const saved = { ...initial, slideshow: true, duration, transition }
      expect(Schema.decodeUnknownSync(Preferences)(JSON.parse(JSON.stringify(saved)))).toEqual(saved)
    }
  })

  test("rejects invalid display times and unknown transitions", () => {
    for (const duration of [0, 4, 86401, 5.5, NaN, Infinity, "60"]) {
      expect(() => Schema.decodeUnknownSync(Preferences)({ ...initial, duration })).toThrow()
    }
    expect(() => Schema.decodeUnknownSync(Preferences)({ ...initial, transition: "spin" })).toThrow()
  })
})

describe("wallpaper tint and brightness", () => {
  test("preserves old strength settings as tint and defaults brightness without rewriting preferences", () => {
    for (const strength of [5, 20, 45]) {
      const settings = Schema.decodeUnknownSync(Preferences)({ ...initial, enabled: true, strength })
      expect(wallpaperAppearance(settings).tint).toBe(100 - strength)
      expect(wallpaperBackground(settings, "blob:wallpaper")["--wallpaper-filter"]).toContain("brightness(100%)")
      expect(settings.tint).toBeUndefined()
      expect(settings.brightness).toBeUndefined()
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
  ])("rejects invalid %s value %s", (property, value) => {
    expect(() => Schema.decodeUnknownSync(Preferences)({ ...initial, [property]: value })).toThrow()
  })
})
