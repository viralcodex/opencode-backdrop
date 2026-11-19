import type { Command, Context } from "@opencode/plugin/gui"
import { wallpaperTitle, type WallpaperChoice } from "./model"

export function wallpaperCommand(
  ctx: Pick<Context, "t" | "signal"> & {
    dialogs: Pick<Context["dialogs"], "select">
    layout: Pick<Context["layout"], "settings">
  },
  images: () => readonly WallpaperChoice[],
  refresh: () => Promise<boolean>,
  current: () => string,
  select: (choice: string) => void,
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
      const choice = await ctx.dialogs.select<string>({
        title: ctx.t("picker.title"),
        placeholder: ctx.t("picker.search"),
        current: current(),
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
      select(choice)
    },
  }
}
