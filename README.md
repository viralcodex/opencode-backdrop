# OpenCode Backdrop

<p>Use your own wallpapers in OpenCode Desktop. Supports OpenCode 2.2.x from 2.2.6 and 2.3.x from 2.3.2 through the GUI plugin API.</p>
<img width="3020" height="1910" alt="image" src="https://github.com/user-attachments/assets/8d1626f2-7048-496c-8aa9-7745f19e1531" />

## Install

```sh
opencode plugin add 'github:viralcodex/opencode-backdrop#v0.2.0'
```

This installs the plugin globally. Alternatively, add it to your global `opencode.json` or `opencode.jsonc`, keeping any existing plugins. Do not add it to `cli.json`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["github:viralcodex/opencode-backdrop#v0.2.0"],
}
```

## Use

1. Open **Settings > Wallpapers**.
2. Choose **Change folder** to use a local folder, or **+** to upload an image.
3. Select an image and adjust tint, brightness and fit.

Wallpaper starts off with an empty gallery. Images and preferences stay local, and images are not sent to models. Files must be non-empty and no larger than 8 MiB.

- Folder images support PNG, JPEG, WebP and SVG, including subfolders. Changes appear automatically.
- Uploads support PNG, JPEG and WebP.
- The gallery shows at most two rows, including the **+** tile. Use **Show more** to see all images, or **Show less** to collapse it.
- More tint improves text contrast. **Fill background** crops the image; **Show whole image** keeps it fully visible.
- Use `/wallpaper` in chat to switch images or turn wallpaper off. Escape cancels the picker.
- Turn **Show wallpaper** off to restore the app's backgrounds without losing your choices.
- Turn **Wallpaper slideshow** on to cycle through all gallery images in order. Choose **None** or **Fade** in the transition dropdown and set **Display time** in seconds, from 5 to 86400. The default is 60 seconds. Slideshow needs at least two images, and fades respect reduced-motion settings.

To remove an upload, hover or focus its tile and click **X**. Remove folder images by moving or deleting their source files.

## Optional folder configuration

You can set an initial folder with an absolute path instead of choosing one in Settings:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    {
      "package": "github:viralcodex/opencode-backdrop#v0.2.0",
      "options": { "folder": "/absolute/path/to/wallpapers" },
    },
  ],
}
```

The folder chosen in Settings takes precedence over this option.

## Development

```sh
bun run check
bun run test:styles
bun run test:storage /path/to/opencode
```

`check` includes native Node filesystem-watcher tests and rebuilds the GUI bundle. `test:styles` runs that bundle's setup, wallpaper switching, stylesheet cleanup, and gallery-toggle checks in headless Chrome; set `CHROME_BIN` if Chrome is installed elsewhere. `test:storage` checks migration against an OpenCode checkout's actual persistence decoder. Pass the checkout path or set `OPENCODE_CHECKOUT`.
