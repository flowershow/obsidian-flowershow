# 💐 Publish with Flowershow (Obsidian Plugin)

Publish your Obsidian vault online easily, quickly and for free directly from your Obsidian vault using [Flowershow](https://flowershow.app).

## Getting Started

Here is how you can publish your Obsidian vault with Flowershow:

**STEP 1: Install the Flowershow Plugin**

1. Open Obsidian.
2. Go to Settings > Community Plugins.
3. Search for "Flowershow" and click Install.
4. Enable the plugin once installed.

**STEP 2: Sign Up for Flowershow Cloud**

1. Sign up for a free account at https://cloud.flowershow.app/login.

**STEP 3: Generate a Personal Access Token**

1. Go to your Flowershow dashboard at https://cloud.flowershow.app/tokens.
2. Create a new Personal Access Token (PAT).
3. Copy the token (it starts with `fs_pat_`).

**STEP 4: Configure the Plugin & Publish**

1. Go back to Obsidian and open the Flowershow plugin settings.
2. Enter your Flowershow PAT token and choose a site name.
3. Use "Flowershow" commands or click on the Flowershow icon in the ribbon and select the notes to publish — and that's it!

**That's it! Your notes are now ready to be shared with the world! 💐**

Full docs at https://flowershow.app/docs/

### Publication Status Panel

The Flowershow icon in your ribbon opens the Publication Status panel, which shows:

- **Changed**: Published files that have been edited locally.
- **New**: New files in your Obsidian vault that have not yet been published.
- **Deleted**: Files that have been deleted from your Obsidian vault but are still published on Flowershow.
- **Unchanged (select to unpublish)**: All unchanged and published files.

### Plugin Settings

#### Flowershow Authentication

- **Personal Access Token**: Your Flowershow PAT token (starts with `fs_pat_`). Generate one at https://cloud.flowershow.app/tokens.
- **Site Name**: The name for your Flowershow site.

#### Publishing Settings

- **Exclude Patterns**: Regex patterns to exclude files and folders from being published.
  - Example: `^private/` excludes the private directory.

#### Configuration Files

Both `custom.css` and `config.json` files can be edited locally and published with the plugin:

- [`custom.css`](https://flowershow.app/docs/custom-css) - Customize your site's styling
- [`config.json`](https://flowershow.app/docs/config-file) - Configure site-wide settings

### Available Commands

- `Flowershow: Publish single note (with embeds)` - Publishes the current note with its embeds. This will publish the current note and any embedded content, but generally won't publish linked notes.
- `Flowershow: Publish all` - Publishes all files in your vault by comparing your local vault with your Flowershow site, taking into account exclude settings. Unlike single note publishing, this doesn't process embeds but rather synchronizes the entire vault content with Flowershow.

### Excalidraw Support

To publish Excalidraw drawings with Flowershow, configure the Excalidraw plugin to:

1. Export drawings as SVG/PNG files
2. Use exported files in note links

In Excalidraw plugin settings:

1. Go to "Embedding Excalidraw into your Notes and Exporting"
2. Go to "Export settings"
3. Go to "Auto-export settings"
4. Enable "Auto-export SVG" or "Auto-export PNG"
5. Enable "Keep the .SVG and/or .PNG filenames in sync..." (if you want)
6. Go to the top of the main section and in "Type of file to insert into the document" select "SVG" or "PNG"

This ensures your drawings will be properly published and displayed on your Flowershow site.

---

## Development

### Setup

1. Clone the repository and install dependencies:

```sh
git clone https://github.com/flowershow/obsidian-flowershow
cd obsidian-flowershow
npm install
```

2. Symlink the plugin folder into your test vault's plugins directory:

```sh
mkdir -p /path/to/your-vault/.obsidian/plugins
ln -s /path/to/obsidian-flowershow /path/to/your-vault/.obsidian/plugins/flowershow
```

3. Build the plugin:

```sh
npm run build
```

4. In Obsidian, open your test vault, go to **Settings → Community plugins**, and enable **Flowershow**.

### Dev mode (rebuild on save)

Run the dev server to automatically rebuild whenever you edit source files:

```sh
npm run dev
```

You'll still need to manually reload the plugin in Obsidian after each rebuild (**Settings → Community plugins → disable then re-enable Flowershow**), unless you set up hot reloading below.

### Hot reloading (auto-reload in Obsidian)

The [Hot Reload](https://github.com/pjeby/hot-reload) plugin detects when `main.js` changes and automatically reloads your plugin — no manual Obsidian restart needed.

1. Install the Hot Reload plugin into your test vault:

```sh
mkdir -p /path/to/your-vault/.obsidian/plugins/hot-reload
curl -L https://github.com/pjeby/hot-reload/releases/latest/download/main.js \
  -o /path/to/your-vault/.obsidian/plugins/hot-reload/main.js
curl -L https://github.com/pjeby/hot-reload/releases/latest/download/manifest.json \
  -o /path/to/your-vault/.obsidian/plugins/hot-reload/manifest.json
```

2. In Obsidian, go to **Settings → Community plugins** and enable **Hot Reload**.

3. Create a `.hotreload` marker file in this plugin's folder so Hot Reload watches it:

```sh
touch /path/to/obsidian-flowershow/.hotreload
```

Now run `npm run dev` and any change you save will be rebuilt and reloaded in Obsidian automatically.

## Shoutout

Big thanks to [Ole Eskild Steensen](https://github.com/oleeskild) for [his obsidian-digital-garden plugin](https://github.com/oleeskild/obsidian-digital-garden/tree/main) which inspired us and we got to build on.
