import assert from "node:assert/strict"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { build } from "vite"
import solid from "vite-plugin-solid"
import { chromium } from "playwright-core"

const root = fileURLToPath(new URL("..", import.meta.url))
const entry = path.join(root, "script/virtual-style-test.tsx")
const guiCode = await Bun.file(path.join(root, "dist/gui-experimental.cjs")).text()
const source = `
import settingsCSS from ${JSON.stringify(path.join(root, "src/settings.css?inline"))}
import { createWallpaperStyles, wallpaperCanvasStyle, wallpaperVariableStyle } from ${JSON.stringify(path.join(root, "src/style.ts"))}
import { wallpaperTransitionStyle } from ${JSON.stringify(path.join(root, "src/transition.ts"))}
import { initial } from ${JSON.stringify(path.join(root, "src/preferences.ts"))}
import { WallpaperGalleryToggle } from ${JSON.stringify(path.join(root, "src/gallery-toggle.tsx"))}
import { createSignal } from 'solid-js'
import { render } from 'solid-js/web'
import { createRoot, getOwner, runWithOwner } from 'solid-js'
import { createStore, produce } from 'solid-js/store'

const assert = (condition, message) => { if (!condition) throw new Error(message) }
const report = (result) => { document.body.dataset.result = btoa(JSON.stringify(result)) }
const waitForStyles = (condition, stage) => new Promise((resolve, reject) => {
  if (condition()) { resolve(); return }
  const observer = new MutationObserver(() => {
    if (!condition()) return
    observer.disconnect()
    clearTimeout(timer)
    resolve()
  })
  const timer = setTimeout(() => {
    observer.disconnect()
    reject(new Error('Built GUI setup did not update its styles during ' + stage))
  }, 2500)
  observer.observe(document.head, { childList: true, characterData: true, subtree: true })
})
async function check() {
  const row = document.querySelector('[data-action="wallpaper-preset"]')
  const section = document.querySelector('.opencode-wallpaper-gallery-section')
  const choice = document.querySelector('.opencode-wallpaper-picker-choice')
  const panel = document.querySelector('[data-slot="home-panel"]')
  const [expanded, setExpanded] = createSignal(false)
  const disposeToggle = render(() => <WallpaperGalleryToggle
    expanded={expanded()}
    controls="wallpaper-test-gallery"
    label={expanded() ? "Show less" : "Show more"}
    onToggle={() => setExpanded(value => !value)}
  />, document.querySelector('.opencode-wallpaper-gallery-toggle'))
  const toggle = document.querySelector('.opencode-wallpaper-gallery-toggle-button')
  assert(toggle.getAttribute('aria-expanded') === 'false', 'Gallery toggle must expose its collapsed state')
  assert(document.getElementById(toggle.getAttribute('aria-controls')), 'Gallery toggle must identify its controlled gallery')
  toggle.click()
  assert(toggle.getAttribute('aria-expanded') === 'true' && toggle.textContent === 'Show less', 'Expanded state and action label must update after clicking')
  const styles = createWallpaperStyles(settingsCSS, wallpaperCanvasStyle + wallpaperTransitionStyle)
  assert(document.head.querySelectorAll('[data-wallpaper-style]').length === 3, 'Styles must attach to document.head')
  assert(getComputedStyle(choice).display === 'block', 'Picker choices must not run together inline')
  assert(getComputedStyle(row).flexDirection === 'column', 'Gallery row must stack the heading and controls')
  assert(getComputedStyle(section).display === 'grid', 'Gallery section CSS must apply')
  assert(section.getBoundingClientRect().width >= row.getBoundingClientRect().width - 1, 'Gallery must use the full settings row width')
  assert(getComputedStyle(document.querySelector('.opencode-wallpaper-gallery-toggle')).display === 'flex', 'Gallery toggle CSS must apply')
  const data = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIOsAAAAASUVORK5CYII='), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([data], { type: 'image/png' }))
  const image = new Image()
  image.src = url
  await image.decode()
  styles.update(wallpaperVariableStyle({ ...initial, enabled: true, tint: 40 }, url))
  assert(getComputedStyle(panel, '::before').backgroundImage.includes(url), 'Decoded wallpaper must reach the painted pseudo-element')
  assert(getComputedStyle(panel, '::before').content === '""', 'Wallpaper canvas rules must be active')
  styles.update('')
  assert(getComputedStyle(panel, '::before').content === 'none', 'Turning wallpaper off must disable the canvas')
  styles.dispose()
  disposeToggle()
  URL.revokeObjectURL(url)
  assert(document.head.querySelectorAll('[data-wallpaper-style]').length === 0, 'All plugin styles must be removed on disposal')
  assert(getComputedStyle(choice).display !== 'block', 'Disposal must restore native picker styling')

  const shared = new Map([
    ['@opencode/plugin/gui', await import('@opencode/plugin/gui')],
    ['effect', await import('effect')],
    ['solid-js', await import('solid-js')],
    ['solid-js/web', await import('solid-js/web')],
    ['solid-js/store', await import('solid-js/store')],
  ])
  const module = { exports: {} }
  new Function('module', 'exports', 'require', ${JSON.stringify(guiCode)})(module, module.exports, name => {
    if (shared.has(name)) return shared.get(name)
    if (name.startsWith('node:')) return {}
    throw new Error('Unexpected GUI runtime module: ' + name)
  })
  const [preferences, update] = createStore({ ...initial, enabled: true, preset: 'file:first' })
  const scope = createRoot(dispose => ({ dispose, owner: getOwner() }))
  const choices = ['first', 'second'].map(title => ({ id: 'file:' + title, title, version: '1' }))
  let reads = 0
  const ctx = {
    signal: new AbortController().signal,
    desktop: {},
    stores: { preferences: { value: preferences, update: mutate => update(produce(mutate)) } },
    main: () => ({ state: () => ({ folder: '', ready: true, images: choices, error: '' }), read: async () => {
      reads++
      return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aIOsAAAAASUVORK5CYII='
    } }),
    t: key => key,
    toast: { show: () => ({ dismiss() {} }) },
    add: () => () => {},
  }
  const rules = () => document.head.querySelector('[data-wallpaper-style="image"]')?.textContent ?? ''
  try {
    runWithOwner(scope.owner, () => module.exports.default.setup(ctx))
    await waitForStyles(() => rules().includes('--wallpaper-image: url('), 'initial loading')
    assert(reads === 1, 'Built GUI setup must read its selected wallpaper')
    assert(getComputedStyle(choice).display === 'block', 'Built GUI setup must attach picker CSS')
    assert(getComputedStyle(panel, '::before').backgroundImage.startsWith('url("blob:'), 'Built GUI setup must paint its decoded image')
    const first = rules()
    update('preset', 'file:second')
    await waitForStyles(() => rules().includes('--wallpaper-image: url(') && rules() !== first, 'image replacement')
    assert(reads === 2, 'Built GUI setup must read a replacement wallpaper')
    update('enabled', false)
    await waitForStyles(() => rules() === '', 'disabling')
    assert(getComputedStyle(panel, '::before').content === 'none', 'Built GUI setup must withdraw the wallpaper when disabled')
    update('enabled', true)
    await waitForStyles(() => rules().includes('--wallpaper-image: url('), 're-enabling')
  } finally {
    scope.dispose()
  }
  assert(document.head.querySelectorAll('[data-wallpaper-style]').length === 0, 'Built GUI setup must remove all owned styles on cleanup')
  report({ pass: true, galleryWidth: section.getBoundingClientRect().width, imageDecoded: image.naturalWidth > 0 })
}
check().catch(error => report({ pass: false, message: error.message }))
`

const result = await build({
  configFile: false,
  logLevel: "error",
  plugins: [solid(), { name: "wallpaper-style-test", resolveId: (id) => id === entry ? entry : undefined, load: (id) => id === entry ? source : undefined }],
  build: { write: false, lib: { entry, formats: ["iife"], name: "WallpaperStyleTest" }, rollupOptions: { output: { inlineDynamicImports: true } } },
})
const bundle = Array.isArray(result) ? result[0] : result
assert(bundle && "output" in bundle)
const chunk = bundle.output.find((output) => output.type === "chunk")
assert(chunk?.type === "chunk")
const temporary = path.join(tmpdir(), "opencode")
await mkdir(temporary, { recursive: true })
const directory = await mkdtemp(path.join(temporary, "wallpaper-style-test-"))
try {
  const html = path.join(directory, "index.html")
  await Bun.write(html, `<!doctype html><html><head><style>
    body { --v2-background-bg-base: #222; --v2-text-text-base: #eee; }
    [data-action="wallpaper-preset"] { display: flex; width: 672px; }
    [data-slot="settings-row-copy"] { flex: 1; }
    [data-slot="settings-row-control"] { display: flex; justify-content: flex-end; }
    [data-slot="home-panel"] { width: 672px; height: 400px; }
  </style></head><body>
    <div class="opencode-wallpaper-settings"><div data-action="wallpaper-preset">
      <div data-slot="settings-row-copy">Choose a wallpaper</div>
      <div data-slot="settings-row-control"><div class="opencode-wallpaper-gallery-section">
        <div id="wallpaper-test-gallery" class="opencode-wallpaper-gallery"><button>Aurora</button><button>Mountains</button><button>+</button></div>
        <div class="opencode-wallpaper-gallery-toggle"></div>
      </div></div>
    </div></div>
    <div class="opencode-wallpaper-picker"><div class="opencode-wallpaper-picker-list">
      <button class="opencode-wallpaper-picker-choice">Aurora</button><button class="opencode-wallpaper-picker-choice">Mountains</button>
    </div></div><div data-slot="home-panel"></div>
    <script>${chunk.code.replaceAll("</script", "<\\/script")}</script>
  </body></html>`)
  const configured = process.env.CHROME_BIN ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "chromium")
  const chrome = path.isAbsolute(configured) ? configured : Bun.which(configured)
  assert(chrome, "Set CHROME_BIN to an installed Chrome or Chromium executable.")
  const browser = await chromium.launchPersistentContext(path.join(directory, "profile"), {
    executablePath: chrome,
    headless: true,
    chromiumSandbox: true,
  })
  try {
    const page = await browser.newPage()
    await page.goto(pathToFileURL(html).href)
    await page.waitForFunction(() => document.body.hasAttribute("data-result"), undefined, { timeout: 10000 })
    const encoded = await page.locator("body").getAttribute("data-result")
    assert(encoded, "Chrome did not report the stylesheet test result")
    const report = JSON.parse(Buffer.from(encoded, "base64").toString()) as { pass: boolean; message?: string }
    assert(report.pass, report.message ?? "Rendered stylesheet check failed")
  } finally {
    await browser.close()
  }
  console.log("Browser checks passed: built GUI setup, image reads, wallpaper switching, on/off, gallery layout, disclosure accessibility, and cleanup.")
} finally {
  await rm(directory, { recursive: true, force: true })
}
