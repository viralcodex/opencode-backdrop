import { wallpaperHeaderGeometry } from "./backdrop"
import type { WallpaperFrame } from "./render"
import { wallpaperHeaders, wallpaperPanels } from "./style"

export const wallpaperTransitionStyle = `
  .opencode-wallpaper-outgoing {
    position: absolute;
    inset: 0;
    z-index: -101;
    pointer-events: none;
    background-repeat: no-repeat;
    background-color: var(--v2-background-bg-base);
    background-clip: padding-box;
    border-radius: inherit;
    filter: var(--wallpaper-filter, none);
  }
`

// Keep tint and the interface still. Only the incoming image pseudo-element fades.
export function fadeWallpaper(previous: WallpaperFrame, fit: "cover" | "contain", duration: number) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return () => {}
  const layers: { element: HTMLElement; layer: HTMLDivElement; animation: Animation }[] = []
  let frame = 0
  const update = () => {
    frame = 0
    for (const { element, layer } of layers) {
      const panel = element.matches(wallpaperPanels) ? undefined : element.closest<HTMLElement>(wallpaperPanels)
      if (!panel) {
        layer.style.backgroundSize = fit
        layer.style.backgroundPosition = "center"
        continue
      }
      const geometry = wallpaperHeaderGeometry(panel.getBoundingClientRect(), element.getBoundingClientRect(), previous, fit)
      layer.style.backgroundSize = geometry["--wallpaper-background-size"]
      layer.style.backgroundPosition = geometry["--wallpaper-background-position"]
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update) }
  for (const element of document.querySelectorAll<HTMLElement>(`${wallpaperPanels}, ${wallpaperHeaders}`)) {
    const layer = document.createElement("div")
    layer.className = "opencode-wallpaper-outgoing"
    layer.setAttribute("aria-hidden", "true")
    layer.style.backgroundImage = `url(${JSON.stringify(previous.url)})`
    element.append(layer)
    const animation = element.animate([{ opacity: 0 }, { opacity: 1 }], {
      duration, easing: "ease-in-out", pseudoElement: "::before",
    })
    layers.push({ element, layer, animation })
  }
  update()
  document.addEventListener("scroll", schedule, { capture: true, passive: true })
  window.addEventListener("resize", schedule, { passive: true })
  return () => {
    cancelAnimationFrame(frame)
    document.removeEventListener("scroll", schedule, true)
    window.removeEventListener("resize", schedule)
    for (const { layer, animation } of layers) {
      animation.cancel()
      layer.remove()
    }
  }
}
