import type { Toasts } from "@opencode/plugin/gui"

export function createWallpaperErrorReporter(toast: Pick<Toasts, "show">) {
  const reported = new Map<string, Set<string>>()
  const report = (source: string, title: string, errors: readonly string[]) => {
    const seen = reported.get(source) ?? new Set<string>()
    const current = new Set(errors.filter(Boolean))
    const fresh = [...current].filter((error) => !seen.has(error))
    if (current.size) reported.set(source, current)
    else reported.delete(source)
    if (!fresh.length) return
    toast.show({
      variant: "error",
      icon: "outline-photo",
      title,
      description: fresh.join("\n\n"),
    })
  }
  return Object.assign(report, {
    retain(sources: readonly string[]) {
      const active = new Set(sources)
      for (const source of reported.keys()) if (!active.has(source)) reported.delete(source)
    },
  })
}
