import { batch, createMemo, createSignal, createUniqueId, For, onMount, Show, type Accessor } from "solid-js"
import { usePlugin, type SelectOptions } from "@opencode/plugin/gui"

export function WallpaperPicker(props: {
  options: SelectOptions<string>
  enabled: Accessor<boolean>
  onToggle: (enabled: boolean) => void
  onSelect: (choice: string) => void
}) {
  const ctx = usePlugin()
  const [query, setQuery] = createSignal("")
  const [active, setActive] = createSignal(Math.max(0, props.options.options.findIndex((option) => option.value === props.options.current)))
  const id = createUniqueId()
  let search!: HTMLInputElement
  let list!: HTMLDivElement
  const rows = createMemo(() => {
    const text = query().trim().toLocaleLowerCase()
    if (!text) return props.options.options
    return props.options.options.filter((option) => {
      let matched = 0
      for (const character of option.title.toLocaleLowerCase()) {
        if (character === text[matched]) matched++
      }
      return matched === text.length
    })
  })
  const row = () => document.getElementById(`${id}-${active()}`)
  onMount(() => { search.focus(); row()?.scrollIntoView({ block: "nearest" }) })

  function navigate(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    if (event.key === "Enter" && event.target === search) {
      event.preventDefault()
      const selected = rows()[active()]
      if (selected) props.onSelect(selected.value)
      return
    }
    if (!rows().length || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return
    event.preventDefault()
    setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + rows().length) % rows().length)
    row()?.scrollIntoView({ block: "nearest" })
    if (list.contains(document.activeElement)) row()?.focus()
  }

  return <ctx.ui.Dialog title={props.options.title} size="large" footer={
    <div class="opencode-wallpaper-picker-footer">
      <ctx.ui.Button
        disabled={!props.enabled() && !props.options.options.length}
        onClick={() => props.onToggle(!props.enabled())}
      >{ctx.t(props.enabled() ? "picker.disable" : "picker.enable")}</ctx.ui.Button>
      <ctx.ui.Button onClick={() => props.onSelect("settings")}>{ctx.t("picker.settings")}</ctx.ui.Button>
    </div>
  }>
    <div class="opencode-wallpaper-picker" onKeyDown={navigate}>
      <input
        ref={search}
        type="search"
        role="combobox"
        class="opencode-wallpaper-picker-search"
        aria-label={ctx.t("picker.search")}
        aria-controls={`${id}-list`}
        aria-expanded={true}
        aria-autocomplete="list"
        aria-activedescendant={rows().length ? `${id}-${active()}` : undefined}
        placeholder={props.options.placeholder}
        value={query()}
        onInput={(event) => {
          batch(() => { setQuery(event.currentTarget.value); setActive(0) })
          list.scrollTop = 0
        }}
      />
      <div ref={list} id={`${id}-list`} class="opencode-wallpaper-picker-list" data-scrollable role="listbox" aria-label={props.options.title}>
        <For each={rows()}>{(option, index) => <button
          id={`${id}-${index()}`}
          type="button"
          role="option"
          class="opencode-wallpaper-picker-choice"
          tabIndex={-1}
          aria-selected={active() === index()}
          onPointerMove={() => setActive(index())}
          onFocus={() => setActive(index())}
          onClick={() => props.onSelect(option.value)}
        ><span dir="auto">{option.title}</span></button>}</For>
        <Show when={!rows().length}><div role="status" class="opencode-wallpaper-picker-empty">{ctx.t("palette.empty")}</div></Show>
      </div>
    </div>
  </ctx.ui.Dialog>
}
