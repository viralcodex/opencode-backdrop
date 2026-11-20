import { Effect, Option, Schema, SchemaGetter } from "effect"
import { StoredImage } from "./image"

export const appearanceControls = {
  tint: { min: 0, max: 100, initial: 80 },
  brightness: { min: 25, max: 150, initial: 100 },
} as const

export const appearanceKeys = ["tint", "brightness"] as const

export const slideshowControls = { min: 5, max: 86400, duration: 60, transition: "fade" } as const
export const wallpaperFadeDuration = 800
export type WallpaperTransition = "none" | "fade"

const UploadedImage = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^(?:custom|upload:.+)$/)),
  name: Schema.String.check(Schema.isMinLength(1)),
  image: StoredImage.check(Schema.isMinLength(1)),
})

export type UploadedWallpaper = typeof UploadedImage.Type

const fields = {
  enabled: Schema.Boolean,
  preset: Schema.String,
  images: Schema.Array(UploadedImage).check(Schema.makeFilter((images) =>
    new Set(images.map((image) => image.id)).size === images.length,
  )),
  tint: Schema.Int.check(Schema.isBetween({ minimum: appearanceControls.tint.min, maximum: appearanceControls.tint.max })),
  brightness: Schema.Int.check(Schema.isBetween({ minimum: appearanceControls.brightness.min, maximum: appearanceControls.brightness.max })),
  fit: Schema.Literals(["cover", "contain"]),
  slideshow: Schema.Boolean,
  duration: Schema.Int.check(Schema.isBetween({ minimum: slideshowControls.min, maximum: slideshowControls.max })),
  transition: Schema.Literals(["none", "fade"]),
}

const SavedPreferences = Schema.Struct({
  ...fields,
  images: Schema.optional(fields.images),
  tint: Schema.optional(fields.tint),
  brightness: Schema.optional(fields.brightness),
  slideshow: Schema.optional(fields.slideshow),
  duration: Schema.optional(fields.duration),
  transition: Schema.optional(fields.transition),
  image: Schema.optional(StoredImage),
  imageName: Schema.optional(Schema.String),
  strength: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 5, maximum: 45 }))),
  hidden: Schema.optional(Schema.Array(Schema.String)),
})

export const Preferences = SavedPreferences.pipe(Schema.decodeTo(Schema.Struct(fields), {
  decode: SchemaGetter.transform((saved) => ({
    enabled: saved.enabled,
    preset: saved.preset,
    fit: saved.fit,
    images: saved.image && !saved.images?.some((image) => image.id === "custom")
      ? [{ id: "custom", name: saved.imageName || "Wallpaper", image: saved.image }, ...(saved.images ?? [])]
      : saved.images ?? [],
    tint: saved.tint ?? (saved.strength === undefined ? appearanceControls.tint.initial : 100 - saved.strength),
    brightness: saved.brightness ?? appearanceControls.brightness.initial,
    slideshow: saved.slideshow ?? false,
    duration: saved.duration ?? slideshowControls.duration,
    transition: saved.transition ?? slideshowControls.transition,
  })),
  encode: SchemaGetter.transform((settings) => settings),
}))

export type WallpaperPreferences = typeof Preferences.Type

export const initial: WallpaperPreferences = {
  enabled: false,
  preset: "",
  images: [],
  tint: appearanceControls.tint.initial,
  brightness: appearanceControls.brightness.initial,
  fit: "cover",
  slideshow: false,
  duration: slideshowControls.duration,
  transition: slideshowControls.transition,
}

function recover<S extends Schema.Constraint>(schema: S, value: S["Type"]) {
  const defaulted = Schema.withDecodingDefaultType<S>(Effect.succeed(value))(schema)
  return defaulted.pipe(Schema.catchDecoding<typeof defaulted>(() => Effect.succeed(Option.some(value))))
}

export const StoredPreferences = Schema.Struct({
  enabled: recover(fields.enabled, initial.enabled),
  preset: recover(fields.preset, initial.preset),
  fit: recover(fields.fit, initial.fit),
  images: recover(SavedPreferences.fields.images, undefined),
  tint: recover(SavedPreferences.fields.tint, undefined),
  brightness: recover(SavedPreferences.fields.brightness, undefined),
  slideshow: recover(SavedPreferences.fields.slideshow, undefined),
  duration: recover(SavedPreferences.fields.duration, undefined),
  transition: recover(SavedPreferences.fields.transition, undefined),
  image: recover(SavedPreferences.fields.image, undefined),
  imageName: recover(SavedPreferences.fields.imageName, undefined),
  strength: recover(SavedPreferences.fields.strength, undefined),
}).pipe(Schema.decodeTo(Preferences))

export function wallpaperAppearance(settings: Pick<WallpaperPreferences, "tint" | "brightness">) {
  return {
    tint: settings.tint,
    brightness: settings.brightness,
  }
}
