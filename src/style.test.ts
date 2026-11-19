import { expect, test } from "bun:test"
import { initial } from "./preferences"
import { wallpaperPanels, wallpaperVariableStyle } from "./style"

test("scopes wallpaper variables to panels and withdraws styles when disabled or unavailable", () => {
  const settings = { ...initial, enabled: true, tint: 55, fit: "contain" as const }
  const css = wallpaperVariableStyle(settings, "blob:wallpaper")
  expect(css).toContain(`${wallpaperPanels} {`)
  expect(css).toContain('--wallpaper-image: url("blob:wallpaper")')
  expect(css).toContain("--wallpaper-fit: contain")
  expect(wallpaperVariableStyle({ ...settings, enabled: false }, "blob:wallpaper")).toBe("")
  expect(wallpaperVariableStyle(settings, "")).toBe("")
})
