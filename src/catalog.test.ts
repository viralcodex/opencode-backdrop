import { afterEach, expect, jest, test } from "bun:test"
import { mkdir, mkdtemp, realpath, rm, symlink, truncate } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCatalog, wallpaperFolder, wallpaperFolderLabel } from "./catalog"
import { selectedWallpaper, wallpaperCatalog } from "./model"
import { initial } from "./preferences"

const directories: string[] = []
const catalogs: ReturnType<typeof createCatalog>[] = []
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>'
const pixel = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIOsAAAAASUVORK5CYII=", "base64")

afterEach(async () => {
  catalogs.splice(0).forEach((catalog) => catalog.dispose())
  jest.useRealTimers()
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

test("discovers nested additions without reading or publishing full image contents", async () => {
  const directory = await fixture()
  const folder = path.join(directory, "images")
  const catalog = tracked(folder)
  expect(catalog.state().ready).toBe(false)
  await catalog.refresh()
  expect(catalog.state().ready).toBe(true)
  expect(catalog.state().images).toEqual([])
  await mkdir(path.join(folder, "nested"), { recursive: true })
  await mkdir(path.join(directory, "wallpapers"))
  await Bun.write(path.join(folder, "nested", "ocean.SVG"), svg)
  await Bun.write(path.join(folder, "example.svg"), svg)
  await Bun.write(path.join(directory, "wallpapers", "outside.svg"), svg)
  await Bun.write(path.join(folder, "ignored.txt"), svg)
  await catalog.refresh()
  expect(catalog.state().error).toBe("")
  expect(catalog.state().images.map((image) => image.title).sort()).toEqual(["example", path.join("nested", "ocean")])
  expect(JSON.stringify(catalog.state())).not.toContain("data:image")
  const images = catalog.state().images
  await catalog.refresh()
  expect(catalog.state().images).toBe(images)
})

test("loads selected bytes on demand and retains selection through edits, removal and restoration", async () => {
  const directory = await fixture()
  const file = path.join(directory, "ocean.svg")
  await Bun.write(file, svg)
  const catalog = tracked(directory)
  await catalog.refresh()
  const settings = { ...initial, preset: `file:${encodeURIComponent(file)}` }
  const selected = () => selectedWallpaper(settings, wallpaperCatalog(catalog.state().images))
  const original = selected()!
  expect(await catalog.read(original)).toContain(Buffer.from(svg).toString("base64"))
  await Bun.write(file, svg.replace("red", "blue"))
  await expect(catalog.read(original)).rejects.toThrow("changed")
  await catalog.refresh()
  await expect(catalog.read(original)).rejects.toThrow("changed")
  expect(await catalog.read(selected()!)).toContain(Buffer.from(svg.replace("red", "blue")).toString("base64"))
  await rm(file)
  await catalog.refresh()
  expect(selected()).toBeUndefined()
  await expect(catalog.read(original)).rejects.toThrow("missing")
  await Bun.write(file, svg)
  await catalog.refresh()
  expect(await catalog.read(selected()!)).toContain(Buffer.from(svg).toString("base64"))
})

test("keeps the catalog small for an 8 MiB image and excludes empty or oversized files", async () => {
  const directory = await fixture()
  await Bun.write(path.join(directory, "pixel.png"), pixel)
  await truncate(path.join(directory, "pixel.png"), 8 * 1024 * 1024)
  await Bun.write(path.join(directory, "empty.svg"), "")
  await Bun.write(path.join(directory, "large.svg"), svg)
  await truncate(path.join(directory, "large.svg"), 8 * 1024 * 1024 + 1)
  const catalog = tracked(directory)
  await catalog.refresh()
  expect(catalog.state().images.map((image) => image.title)).toEqual(["pixel"])
  expect(Buffer.byteLength(JSON.stringify(catalog.state()))).toBeLessThan(4096)
  expect(catalog.state().error).toBe("empty.svg: image.sizeError\nlarge.svg: image.sizeError")
  const image = catalog.state().images[0]!
  expect(Buffer.from((await catalog.read(image)).split(",")[1]!, "base64").length).toBe(8 * 1024 * 1024)
  await Promise.all(["empty.svg", "large.svg"].map((name) => rm(path.join(directory, name))))
  await catalog.refresh()
  expect(catalog.state().error).toBe("")
})

test("uses canonical file identities when the selected folder is an alias", async () => {
  const directory = await fixture()
  const nested = path.join(directory, "nested")
  const alias = path.join(directory, "alias")
  await mkdir(nested)
  await symlink(nested, alias)
  await Bun.write(path.join(nested, "wall.svg"), svg)
  const catalog = tracked(alias)
  await catalog.refresh()
  expect(catalog.state().images).toHaveLength(1)
  expect(catalog.state().images[0]?.title).toBe("wall")
  expect(catalog.state().images[0]?.id).toBe(`file:${encodeURIComponent(path.join(nested, "wall.svg"))}`)
})

test("keeps files with the same stem and different extensions distinct", async () => {
  const directory = await fixture()
  await Bun.write(path.join(directory, "example.svg"), svg)
  await Bun.write(path.join(directory, "example.png"), pixel)
  const catalog = tracked(directory)
  await catalog.refresh()
  const images = wallpaperCatalog(catalog.state().images)
  expect(images.map((image) => image.id).sort()).toEqual(["png", "svg"].map((extension) => `file:${encodeURIComponent(path.join(directory, `example.${extension}`))}`))
})

test("refreshes from the timer without a manual refresh", async () => {
  jest.useFakeTimers()
  const directory = await fixture()
  const updated = Promise.withResolvers<void>()
  const catalog = createCatalog(directory, () => {
    if (catalog.state().images.length) updated.resolve()
  })
  catalogs.push(catalog)
  await catalog.refresh()
  await Bun.write(path.join(directory, "new.svg"), svg)
  jest.advanceTimersByTime(2000)
  await updated.promise
  expect(catalog.state().images.map((image) => image.title)).toEqual(["new"])
})

test("removes its timer on disposal and refuses further scans", async () => {
  jest.useFakeTimers()
  const timers = jest.getTimerCount()
  const catalog = tracked("/unused-wallpaper-folder")
  catalog.dispose()
  expect(jest.getTimerCount()).toBe(timers)
  jest.advanceTimersByTime(2000)
  expect(await catalog.refresh()).toBe(false)
})

test("reports folder failures without repeatedly publishing an unchanged error", async () => {
  const directory = await fixture()
  const file = path.join(directory, "file.svg")
  await Bun.write(file, svg)
  let updates = 0
  const catalog = createCatalog(file, () => { updates++ })
  catalogs.push(catalog)
  await catalog.refresh()
  expect(catalog.state().error).toContain(file)
  await catalog.refresh()
  expect(updates).toBe(1)
})

test("uses one absolute folder, including the first legacy configured path", async () => {
  const directory = await fixture()
  expect(() => wallpaperFolder("relative")).toThrow("absolute path")
  expect(() => wallpaperFolder([false])).toThrow()
  expect(() => wallpaperFolder([])).toThrow()
  expect(wallpaperFolder(undefined)).toBe("")
  expect(wallpaperFolder(`${directory}/`)).toBe(directory)
  expect(wallpaperFolder([directory, path.join(directory, "other")])).toBe(directory)
  const home = os.homedir()
  expect(wallpaperFolderLabel(path.join(home, "Desktop", "wallpapers"))).toBe(`~${path.sep}Desktop${path.sep}wallpapers`)
  expect(wallpaperFolderLabel(home)).toBe("~")
  expect(wallpaperFolderLabel(path.join(home, "..", "other-user"))).toBe(path.join(home, "..", "other-user"))
  expect(wallpaperFolderLabel("")).toBe("")
})

test("rejects reads after cancellation or disposal", async () => {
  const directory = await fixture()
  await Bun.write(path.join(directory, "image.svg"), svg)
  const catalog = tracked(directory)
  await catalog.refresh()
  const image = catalog.state().images[0]!
  const cancelled = AbortSignal.abort()
  await expect(catalog.read(image, cancelled)).rejects.toThrow()
  catalog.dispose()
  await expect(catalog.read(image)).rejects.toThrow()
})

test("no folder means an empty catalog without filesystem polling or errors", async () => {
  jest.useFakeTimers()
  const timers = jest.getTimerCount()
  const catalog = tracked(wallpaperFolder(undefined))
  expect(await catalog.refresh()).toBe(true)
  expect(catalog.state()).toEqual({ folder: "", ready: true, images: [], error: "" })
  expect(jest.getTimerCount()).toBe(timers)
})

function tracked(folder: string) {
  const catalog = createCatalog(folder, () => {})
  catalogs.push(catalog)
  return catalog
}

async function fixture() {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), "opencode-wallpaper-test-")))
  directories.push(directory)
  return directory
}
