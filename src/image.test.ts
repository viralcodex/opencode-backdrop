import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { checkImage, wallpaperBlob } from "./image"
import { Preferences, initial } from "./preferences"
import { wallpaperVariableStyle } from "./style"

describe("local wallpaper images", () => {
  test("accepts supported uploads at the size limit and rejects invalid types or sizes", () => {
    for (const type of ["image/png", "image/jpeg", "image/webp"]) {
      expect(() => checkImage({ type, size: 8 * 1024 * 1024 })).not.toThrow()
    }
    expect(() => checkImage({ type: "image/svg+xml", size: 10 })).toThrow("image.typeError")
    expect(() => checkImage({ type: "image/png", size: 0 })).toThrow("image.sizeError")
    expect(() => checkImage({ type: "image/png", size: 8 * 1024 * 1024 + 1 })).toThrow("image.sizeError")
  })

  test("rejects non-local and malformed raster data at persistence and blob boundaries", () => {
    for (const image of [
      "https://example.com/wallpaper.png",
      'data:image/png;base64,abc");}body{color:red}',
      "data:image/png;base64,a",
      "data:image/png;base64,====",
      "data:image/png;base64,",
    ]) {
      expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, images: [{ id: "upload:test", name: "test.png", image }] })).toThrow()
      expect(() => wallpaperBlob(image)).toThrow("image.decodeError")
    }
  })

  test("enforces both encoded and decoded preference size limits", () => {
    const image = `data:image/jpeg;base64,${Buffer.alloc(8 * 1024 * 1024).toString("base64")}`
    expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, preset: "upload:test", images: [{ id: "upload:test", name: "test.jpg", image }] })).not.toThrow()
    expect(() =>
      Schema.encodeUnknownSync(Preferences)({ ...initial, images: [{ id: "upload:test", name: "test.jpg", image: image.slice(0, -4) + "AAAAAAAA" }] }),
    ).toThrow()
    const oversizedPng = `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString("base64")}`
    expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, images: [{ id: "upload:test", name: "test.png", image: oversizedPng }] })).toThrow()
  })

  test("renders a large folder image through a short blob URL without changing its bytes", async () => {
    const data = Buffer.alloc(8 * 1024 * 1024, 31)
    const image = `data:image/png;base64,${data.toString("base64")}`
    const blob = wallpaperBlob(image)
    const url = URL.createObjectURL(blob)
    try {
      const css = wallpaperVariableStyle({ ...initial, enabled: true, preset: "file:large.png" }, url)
      expect(css).toContain(`url(${JSON.stringify(url)})`)
      expect(css.length).toBeLessThan(16 * 1024)
      expect(css).not.toContain(image)
      expect(Buffer.from(await blob.arrayBuffer())).toEqual(data)
    } finally {
      URL.revokeObjectURL(url)
    }
  })

  test("decodes local SVG data without accepting it as an uploaded preference", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>'
    for (const image of [`data:image/svg+xml,${encodeURIComponent(svg)}`, `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`]) {
      expect(() => Schema.encodeUnknownSync(Preferences)({ ...initial, images: [{ id: "upload:test", name: "test.svg", image }] })).toThrow()
      expect(await wallpaperBlob(image).text()).toBe(svg)
    }
    expect(() => wallpaperBlob("data:image/svg+xml,%")).toThrow("image.decodeError")
  })
})
