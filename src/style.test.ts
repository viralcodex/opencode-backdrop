import { expect, test } from "bun:test"
import { initial } from "./preferences"
import { wallpaperPanels, wallpaperStyle } from "./style"

test("scopes wallpaper variables to panels and withdraws styles when disabled or unavailable", () => {
  const settings = { ...initial, enabled: true, tint: 55, fit: "contain" as const }
  const css = wallpaperStyle(settings, "blob:wallpaper")
  expect(css).toContain(`${wallpaperPanels} {`)
  expect(css).toContain('--wallpaper-image: url("blob:wallpaper")')
  expect(css).toContain("--wallpaper-fit: contain")
  expect(wallpaperStyle({ ...settings, enabled: false }, "blob:wallpaper")).toBe("")
  expect(wallpaperStyle(settings, "")).toBe("")
})
