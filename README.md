# Obsidian Chirr Thread Preview

Write social threads from Obsidian notes with a live Chirr-style preview, word-aware 280-character slicing, real-time counters, and `[...]` split markers.

This plugin turns the active Markdown note into a side-by-side thread composer so you can draft, revise, and preview social posts without leaving Obsidian.

## Features

* **Live Preview:** Shows the active note as a Chirr-style thread beside your Markdown.
* **Word-Aware Slicing:** Automatically wraps text into 280-character chunks without splitting words when possible.
* **Manual Split Markers:** Starts a new thread card wherever you type `[...]`.
* **Character Counters:** Displays real-time count badges (`145/280`) on each card and highlights posts over the limit.

## Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest GitHub Release.
2. Create a folder named `chirr-thread-preview` inside your vault's plugin directory: `<your-vault>/.obsidian/plugins/`.
3. Place the downloaded files inside that folder.
4. Open Obsidian, go to **Settings > Community plugins**, enable community plugins if prompted, and toggle on **Chirr Thread Preview**.

## Development Environment Setup

To set up the workspace for local modification or contribution:

1. Clone this repository locally.
2. Open your terminal inside the repository folder.
3. Run the following command to install required dependencies:
```bash
npm install --save-dev obsidian esbuild

```

## Updating main.js

Because Obsidian executes JavaScript rather than TypeScript, any changes made to `main.ts` must be compiled into `main.js` using esbuild:

1. Run the compilation command in your project directory:
```bash
npx esbuild main.ts --bundle --platform=node --target=es2018 --format=cjs --external:obsidian --outfile=main.js

```

2. Ensure the newly updated `main.js` file is copied to your Obsidian vault plugin folder to see the changes reflected in real time.
