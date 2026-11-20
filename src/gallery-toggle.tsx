export function WallpaperGalleryToggle(props: {
  expanded: boolean
  controls: string
  label: string
  onToggle: () => void
}) {
  return <button
    type="button"
    class="opencode-wallpaper-gallery-toggle-button"
    aria-expanded={props.expanded}
    aria-controls={props.controls}
    onClick={props.onToggle}
  >{props.label}</button>
}
