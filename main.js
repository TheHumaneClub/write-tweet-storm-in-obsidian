var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// main.ts
var main_exports = {};
__export(main_exports, {
  default: () => ChirrLivePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE_CHIRR = "chirr-thread-view";
var ChirrThreadView = class extends import_obsidian.ItemView {
  constructor(leaf) {
    super(leaf);
    __publicField(this, "previewList");
  }
  getViewType() {
    return VIEW_TYPE_CHIRR;
  }
  getDisplayText() {
    return "Chirr Thread Live Preview";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("chirr-sidebar-container");
    this.previewList = container.createDiv({ cls: "chirr-preview-list" });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        const activeFile2 = this.app.workspace.getActiveFile();
        if (activeFile2 && file.path === activeFile2.path) {
          this.updateChunksFromFile(activeFile2);
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const activeFile2 = this.app.workspace.getActiveFile();
        if (activeFile2) {
          this.updateChunksFromFile(activeFile2);
        }
      })
    );
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.updateChunksFromFile(activeFile);
    }
  }
  async updateChunksFromFile(file) {
    const content = await this.app.vault.read(file);
    this.renderChunks(content);
  }
  renderChunks(text) {
    if (!this.previewList) return;
    this.previewList.empty();
    const chunks = this.parseChunks(text);
    chunks.forEach((chunk, index) => {
      const charCount = chunk.length;
      const isOverLimit = charCount > 280;
      const card = this.previewList.createDiv({ cls: "chirr-card" });
      if (isOverLimit) card.addClass("chirr-card-error");
      const header = card.createDiv({ cls: "chirr-card-header" });
      header.createSpan({ text: `${index + 1}/` });
      header.createSpan({
        cls: `chirr-counter ${isOverLimit ? "over-limit" : ""}`,
        text: `${charCount}/280`
      });
      card.createDiv({ cls: "chirr-card-body", text: chunk });
    });
  }
  parseChunks(text) {
    let rawSegments = text.split(/\[\.\.\.\]/);
    let finalChunks = [];
    rawSegments.forEach((segment) => {
      segment = segment.trim();
      if (!segment) return;
      if (segment.length <= 280) {
        finalChunks.push(segment);
      } else {
        let words = segment.split(" ");
        let currentChunk = "";
        for (const word of words) {
          if ((currentChunk + " " + word).trim().length <= 280) {
            currentChunk = currentChunk ? currentChunk + " " + word : word;
          } else {
            if (currentChunk) finalChunks.push(currentChunk);
            currentChunk = word;
          }
        }
        if (currentChunk) finalChunks.push(currentChunk);
      }
    });
    return finalChunks;
  }
  async onClose() {
  }
};
var ChirrLivePlugin = class extends import_obsidian.Plugin {
  async onload() {
    this.registerView(
      VIEW_TYPE_CHIRR,
      (leaf) => new ChirrThreadView(leaf)
    );
    this.addCommand({
      id: "open-chirr-live-preview",
      name: "Tweet Storm Composer",
      callback: () => {
        this.activateView();
      }
    });
  }
  async activateView() {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_CHIRR)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false) || workspace.getLeaf(true);
      await leaf.setViewState({ type: VIEW_TYPE_CHIRR, active: true });
    }
    workspace.revealLeaf(leaf);
  }
};
