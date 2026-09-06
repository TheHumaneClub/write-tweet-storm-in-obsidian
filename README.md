# Obsidian Chirr Thread Preview

Transforms any Markdown note into a live, side-by-side thread composer styled after Chirr App, making it easy to write and format social media threads directly inside Obsidian.

## Features

* **Live Slicing:** Automatically wraps text into word-aware 280-character chunks.
* **Explicit Triggers:** Forces a split to the next tweet card instantly whenever `[...]` is typed.
* **Character Counters:** Displays real-time character count badges (`145/280`) on each card header, highlighting errors when limits are exceeded.

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