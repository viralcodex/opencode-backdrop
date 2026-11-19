import type { Command, Context, Persisted } from "@opencode/plugin/gui"
import { changeWallpaper, wallpaperTitle, type WallpaperChoice } from "./model"
import type { WallpaperPreferences } from "./preferences"

export function wallpaperCommand(
  ctx: Pick<Context, "t" | "signal"> & {
    stores: {
      preferences: Pick<Persisted<WallpaperPreferences, WallpaperPreferences>, "value" | "update">
    }
    dialogs: Pick<Context["dialogs"], "select">
    layout: Pick<Context["layout"], "settings">
  },
  images: () => readonly WallpaperChoice[],
  refresh: () => Promise<boolean>,
  selected?: () => WallpaperChoice | undefined,
  select?: (choice: string) => void,
): Command {
  return {
    id: "choose",
    title: ctx.t("picker.title"),
    description: ctx.t("picker.description"),
    keywords: "wallpaper background image",
    slash: { name: "wallpaper" },
    async run() {
      if (ctx.signal.aborted) return
      await refresh()
      if (ctx.signal.aborted) return
      const preferences = ctx.stores.preferences
      const choice = await ctx.dialogs.select<typeof preferences.value.preset | "off" | "settings">({
        title: ctx.t("picker.title"),
        placeholder: ctx.t("picker.search"),
        current: preferences.value.enabled ? selected?.()?.id ?? preferences.value.preset : "off",
        options: [
          ...images().map((preset) => ({
            title: wallpaperTitle(preset, ctx.t),
            value: preset.id,
          })),
          { title: ctx.t("picker.off"), value: "off" },
          { title: ctx.t("picker.settings"), value: "settings" },
        ],
      })
      if (!choice || ctx.signal.aborted) return
      if (choice === "settings") {
        ctx.layout.settings("wallpaper")
        return
      }
      if (select) select(choice)
      else preferences.update((draft) => { changeWallpaper(draft, choice) })
    },
  }
}
