import { wallpaperAppearance, type WallpaperPreferences } from "./preferences"

export const wallpaperPanels = '[data-slot="home-panel"], [data-slot="session-chat-panel"] > .bg-v2-background-bg-base, [data-component="new-session"]'

export const wallpaperHeaders = `
  [data-slot="home-panel"] .sticky.bg-v2-background-bg-base,
  [data-slot="session-chat-panel"] [data-session-title] > .bg-v2-background-bg-base,
  [data-slot="session-chat-panel"] [data-slot="session-location-bar"],
  [data-slot="session-chat-panel"] [data-component="collapsed-tool-group"] > [data-component="collapsible"] > [data-slot="collapsible-trigger"][aria-expanded="true"],
  [data-slot="session-chat-panel"] :is([data-component="edit-tool"], [data-component="write-tool"], [data-component="apply-patch-tool"]) > [data-component="collapsible"] > [data-slot="collapsible-trigger"]:is([aria-expanded="true"], [data-locked])
`

// Only the image layer is filtered. The tint is composited afterwards, and neither
// layer can fade, filter, or intercept the interface above it.
export function wallpaperLayers(selectors: string) {
  const target = `:is(${selectors})`
  return `
    ${target}::before,
    ${target}::after {
      content: "";
      position: absolute;
      inset: 0;
      width: auto;
      height: auto;
      pointer-events: none;
      background-clip: padding-box;
      mask-image: none;
      backdrop-filter: none;
    }

    ${target}::before {
      z-index: -100;
      background-image: var(--wallpaper-image, none);
      background-size: var(--wallpaper-background-size, var(--wallpaper-fit, cover));
      background-position: var(--wallpaper-background-position, center);
      background-repeat: no-repeat;
      background-color: var(--v2-background-bg-base);
      filter: var(--wallpaper-filter, none);
    }

    ${target}::after {
      z-index: -99;
      background: var(--wallpaper-tint, transparent);
    }
  `
}

// Included only with a decoded, enabled wallpaper. No opaque reading columns and
// no global theme-token changes: cards, syntax colors and floating menus stay intact.
export const wallpaperSurfaces = `
  :is(${wallpaperPanels}) {
    position: relative;
    isolation: isolate;
    --wallpaper-secondary: color-mix(in srgb, var(--v2-text-text-base) 88%, var(--v2-background-bg-base));
    --wallpaper-text-shadow: 0 1px 2px var(--v2-background-bg-base), 0 0 4px var(--v2-background-bg-base);
  }

  :is(${wallpaperPanels}) [data-wallpaper-backed] {
    isolation: isolate;
    background: transparent;
  }

  [data-slot="session-chat-panel"] [data-session-title] > .bg-v2-background-bg-base,
  [data-slot="session-chat-panel"] [data-slot="session-location-bar"] {
    position: relative;
  }

  /* Old page-colored fades would leave bands over the image. The aligned header
     copies conceal scrolling content without blurring or repainting a solid strip. */
  [data-slot="session-chat-panel"] .session-header-fade {
    background: none;
  }

  [data-slot="home-panel"] [data-home-row] {
    --home-row-background: transparent;
  }

  [data-slot="home-panel"] [data-home-row]:is(:hover, :focus-within, :has([data-menu="true"])) {
    --home-row-background: color-mix(in srgb, var(--v2-background-bg-layer-01) 65%, transparent);
  }

  [data-slot="home-panel"] [data-home-row][data-selected] {
    --home-row-background: color-mix(in srgb, var(--v2-background-bg-layer-03) 80%, transparent);
  }

  :is([data-slot="home-panel"], [data-component="new-session"]) :is(.text-v2-text-text-muted, .text-v2-text-text-faint),
  [data-component="new-session"] [data-slot="new-session-location-path"],
  [data-slot="session-chat-panel"] [data-slot="session-timeline-scroll"] :is(.text-v2-text-text-muted, .text-v2-text-text-faint, [data-slot="basic-tool-tool-subtitle"]:not(.webfetch-link), [data-slot="basic-tool-tool-arg"], [data-slot="context-tool-group-usage"], [data-slot="context-tool-group-matches"], [data-slot="execute-tool-call-args"], [data-slot="text-part-meta"], [data-component="reasoning-part"] [data-component="markdown"]) {
    color: var(--wallpaper-secondary);
  }

  [data-slot="home-panel"] :is(aside, section),
  [data-component="new-session"] [data-slot="new-session-composer"],
  [data-slot="session-chat-panel"] [data-slot="session-timeline-scroll"] {
    text-shadow: var(--wallpaper-text-shadow);
  }

  :is([data-slot="home-panel"], [data-component="new-session"]) :is(.text-v2-icon-icon-muted, .text-v2-icon-icon-faint),
  [data-slot="home-panel"] button.text-v2-text-text-faint > [data-slot="icon-svg"] {
    color: var(--wallpaper-secondary);
  }

  [data-slot="home-panel"] [data-component="home-session-search"] input::placeholder {
    color: var(--wallpaper-secondary);
  }

  [data-slot="home-panel"] button:is(:hover, :focus-visible, [data-selected]) {
    color: var(--v2-text-text-base);
  }

  /* Counter-shadow paths fill the lower interiors of the letters. Keep those
     transparent instead of turning them into gray rectangles. Only the inner
     paint group changes; outer groups still control the lodger's animations. */
  [data-component="new-session"] [data-component="new-session-wordmark"] {
    --icon-base: var(--v2-text-text-base);
    --icon-strong-base: var(--v2-text-text-base);
    --icon-weak-base: transparent;
  }

  [data-component="new-session"] [data-slot="wordmark-flat"] > svg:first-child > g > g {
    opacity: 0.65;
    filter: drop-shadow(0 1px 2px var(--v2-background-bg-base));
  }

  /* The game's back pins and paddle use z-index -10 and -5. Keep the wallpaper
     below them, and outline only the moving shapes rather than shading the arena. */
  [data-component="new-session"] :is([data-slot="new-session-pins"], [data-slot="new-session-pins-popped"]) {
    filter: drop-shadow(0 1px 2px var(--v2-background-bg-base));
  }

  [data-component="new-session"] [data-slot="brick-breaker-paddle"] {
    box-shadow: 0 0 0 1px var(--wallpaper-secondary), 0 1px 4px var(--v2-background-bg-base);
  }

  [data-component="new-session"] [data-slot="brick-breaker-hud"] :is(.bg-v2-border-border-base, .bg-v2-icon-icon-faint) {
    background-color: var(--wallpaper-secondary);
  }
`

// Static rules are registered separately from the image variables so dragging a
// slider does not reparse the complete stylesheet on every input event.
export const wallpaperCanvasStyle = wallpaperSurfaces + wallpaperLayers(`${wallpaperPanels}, :is(${wallpaperPanels}) [data-wallpaper-backed]`)

export function wallpaperBackground(settings: WallpaperPreferences, image: string) {
  const visible = settings.enabled && !!image
  const { tint, brightness } = wallpaperAppearance(settings)
  return {
    "--wallpaper-image": visible ? `url(${JSON.stringify(image)})` : "none",
    "--wallpaper-fit": settings.fit,
    "--wallpaper-tint": visible ? `color-mix(in srgb, var(--v2-background-bg-base) ${tint}%, transparent)` : "transparent",
    "--wallpaper-filter": visible ? `brightness(${brightness}%) contrast(85%) saturate(90%)` : "none",
  }
}

export function wallpaperVariableStyle(settings: WallpaperPreferences, image: string) {
  if (!settings.enabled || !image) return ""
  const declarations = Object.entries(wallpaperBackground(settings, image))
    .map(([property, value]) => `${property}: ${value};`).join("\n  ")
  return `${wallpaperPanels} {\n  ${declarations}\n}`
}
