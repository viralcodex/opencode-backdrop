import type { Command, Context, SelectOptions } from "@opencode/plugin/gui"
import { wallpaperTitle, type WallpaperChoice } from "./model"

export function wallpaperCommand(
  ctx: Pick<Context, "t" | "signal"> & {
    layout: Pick<Context["layout"], "settings">
  },
  images: () => readonly WallpaperChoice[],
  refresh: () => Promise<boolean>,
  current: () => string,
  select: (choice: string) => void,
  open: (options: SelectOptions<string>, choose: (choice: string) => void) => void,
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
      open({
        title: ctx.t("picker.title"),
        placeholder: ctx.t("picker.search"),
        current: current(),
        options: images().map((preset) => ({ title: wallpaperTitle(preset, ctx.t), value: preset.id })),
      }, (choice) => {
        if (ctx.signal.aborted) return
        if (choice === "settings") {
          ctx.layout.settings("wallpaper")
          return
        }
        select(choice)
      })
    },
  }
}
