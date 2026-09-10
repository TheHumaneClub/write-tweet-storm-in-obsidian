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
var CHUNK_LIMIT = 280;
var SYNC_RELEASE_DELAY = 350;
var ChirrThreadView = class extends import_obsidian.ItemView {
  constructor(leaf) {
    super(leaf);
    __publicField(this, "sidebarContainer");
    __publicField(this, "previewList");
    __publicField(this, "chunks", []);
    __publicField(this, "cards", []);
    __publicField(this, "activeChunkIndex", -1);
    __publicField(this, "syncSource", null);
    __publicField(this, "syncReleaseTimer", null);
    __publicField(this, "boundEditorScrollEls", /* @__PURE__ */ new WeakSet());
    __publicField(this, "editorScrollDebounce", null);
    __publicField(this, "sidebarScrollDebounce", null);
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
    this.sidebarContainer = container;
    this.previewList = this.sidebarContainer.createDiv({ cls: "chirr-preview-list" });
    this.registerDomEvent(this.sidebarContainer, "scroll", () => this.handleSidebarScroll(), { passive: true });
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
        this.bindActiveEditor();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", (editor, info) => {
        var _a;
        const activeFile2 = this.app.workspace.getActiveFile();
        if (!activeFile2 || ((_a = info.file) == null ? void 0 : _a.path) !== activeFile2.path) return;
        this.renderChunks(editor.getValue());
        this.bindActiveEditor();
        this.syncSidebarToCursor();
      })
    );
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile) {
      this.updateChunksFromFile(activeFile);
    }
    this.bindActiveEditor();
  }
  async updateChunksFromFile(file) {
    const content = await this.app.vault.read(file);
    this.renderChunks(content);
  }
  renderChunks(text) {
    if (!this.previewList) return;
    this.previewList.empty();
    this.cards = [];
    this.chunks = this.parseChunks(text);
    this.chunks.forEach((chunk, index) => {
      const tweetText = this.toTweetText(chunk.text);
      const charCount = tweetText.length;
      const isOverLimit = charCount > CHUNK_LIMIT;
      const card = this.previewList.createDiv({ cls: "chirr-card" });
      card.dataset.chunkIndex = String(index);
      if (isOverLimit) card.addClass("chirr-card-error");
      if (index === this.activeChunkIndex) card.addClass("chirr-card-active");
      this.cards.push(card);
      const header = card.createDiv({ cls: "chirr-card-header" });
      header.createSpan({ text: `${index + 1}/` });
      header.createSpan({
        cls: `chirr-counter ${isOverLimit ? "over-limit" : ""}`,
        text: `${charCount}/${CHUNK_LIMIT}`
      });
      card.createDiv({ cls: "chirr-card-body", text: tweetText });
      card.addEventListener("click", () => this.syncEditorToChunk(index));
    });
    if (!this.chunks[this.activeChunkIndex]) {
      this.activeChunkIndex = -1;
    }
  }
  parseChunks(text) {
    const chunks = [];
    const lineStarts = this.getLineStarts(text);
    const delimiter = /\[\.\.\.\]/g;
    let segmentStart = 0;
    let match;
    const addSegment = (start, end) => {
      const trimmedStart = this.skipWhitespaceForward(text, start, end);
      const trimmedEnd = this.skipWhitespaceBackward(text, trimmedStart, end);
      if (trimmedStart >= trimmedEnd) return;
      for (const range of this.splitSegmentByLimit(text, trimmedStart, trimmedEnd)) {
        const chunkText = text.slice(range.fromOffset, range.toOffset).trim();
        if (!chunkText) continue;
        const fromLine = this.offsetToLine(lineStarts, range.fromOffset);
        const toLine = this.offsetToLine(lineStarts, Math.max(range.fromOffset, range.toOffset - 1));
        chunks.push({
          text: chunkText,
          index: chunks.length,
          fromOffset: range.fromOffset,
          toOffset: range.toOffset,
          fromLine,
          toLine
        });
      }
    };
    while ((match = delimiter.exec(text)) !== null) {
      addSegment(segmentStart, match.index);
      segmentStart = match.index + match[0].length;
    }
    addSegment(segmentStart, text.length);
    return chunks;
  }
  splitSegmentByLimit(text, start, end) {
    const ranges = [];
    let chunkStart = start;
    let chunkText = "";
    const tokenPattern = /\[\[[^\]]+\]\]|\S+/g;
    tokenPattern.lastIndex = start;
    let token;
    while ((token = tokenPattern.exec(text)) !== null && token.index < end) {
      const tokenStart = token.index;
      const tokenEnd = Math.min(token.index + token[0].length, end);
      const prospective = chunkText ? `${chunkText} ${token[0]}` : token[0];
      if (chunkText && this.toTweetText(prospective).length > CHUNK_LIMIT) {
        ranges.push({ fromOffset: chunkStart, toOffset: this.skipWhitespaceBackward(text, chunkStart, tokenStart) });
        chunkStart = tokenStart;
        chunkText = token[0];
      } else {
        if (!chunkText) chunkStart = tokenStart;
        chunkText = prospective;
      }
      if (tokenEnd >= end) break;
    }
    if (chunkText) {
      ranges.push({ fromOffset: chunkStart, toOffset: this.skipWhitespaceBackward(text, chunkStart, end) });
    }
    return ranges;
  }
  toTweetText(text) {
    return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, _target, alias) => alias).replace(/\[\[([^\]]+)\]\]/g, (_match, target) => target.split("#")[0]).replace(/(^|\s)\^[A-Za-z0-9_-]+\b/g, "$1").trim();
  }
  getLineStarts(text) {
    const starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "\n") starts.push(i + 1);
    }
    return starts;
  }
  offsetToLine(lineStarts, offset) {
    let low = 0;
    let high = lineStarts.length - 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (lineStarts[mid] <= offset) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return Math.max(0, high);
  }
  skipWhitespaceForward(text, start, end) {
    while (start < end && /\s/.test(text[start])) start++;
    return start;
  }
  skipWhitespaceBackward(text, start, end) {
    while (end > start && /\s/.test(text[end - 1])) end--;
    return end;
  }
  bindActiveEditor() {
    var _a, _b;
    const editorView = this.getActiveEditorView();
    const scrollEl = (_b = (_a = editorView == null ? void 0 : editorView.editor) == null ? void 0 : _a.cm) == null ? void 0 : _b.scrollDOM;
    if (!scrollEl || this.boundEditorScrollEls.has(scrollEl)) return;
    this.boundEditorScrollEls.add(scrollEl);
    this.registerDomEvent(scrollEl, "scroll", () => this.handleEditorScroll(), { passive: true });
    this.registerDomEvent(scrollEl, "click", () => window.setTimeout(() => this.syncSidebarToCursor(), 0));
    this.registerDomEvent(scrollEl, "keyup", () => this.syncSidebarToCursor());
  }
  getActiveEditorView() {
    const activeView = this.app.workspace.getActiveViewOfType(import_obsidian.MarkdownView);
    return activeView != null ? activeView : null;
  }
  getActiveEditor() {
    var _a, _b;
    return (_b = (_a = this.getActiveEditorView()) == null ? void 0 : _a.editor) != null ? _b : null;
  }
  handleEditorScroll() {
    if (this.syncSource === "sidebar") return;
    if (this.editorScrollDebounce !== null) window.clearTimeout(this.editorScrollDebounce);
    this.editorScrollDebounce = window.setTimeout(() => {
      this.syncSidebarToEditorViewport();
    }, 80);
  }
  handleSidebarScroll() {
    if (this.syncSource === "editor") return;
    if (this.sidebarScrollDebounce !== null) window.clearTimeout(this.sidebarScrollDebounce);
    this.sidebarScrollDebounce = window.setTimeout(() => {
      this.syncEditorToCenteredCard();
    }, 120);
  }
  syncSidebarToCursor() {
    const editor = this.getActiveEditor();
    if (!editor || typeof editor.posToOffset !== "function") return;
    const cursor = editor.getCursor();
    const offset = editor.posToOffset(cursor);
    const chunkIndex = this.findChunkIndexByOffset(offset, cursor.line);
    this.activateChunk(chunkIndex, true, "editor");
  }
  syncSidebarToEditorViewport() {
    var _a;
    const editor = this.getActiveEditor();
    const editorView = this.getActiveEditorView();
    const cm = (_a = editorView == null ? void 0 : editorView.editor) == null ? void 0 : _a.cm;
    if (!editor || !(cm == null ? void 0 : cm.coordsAtPos) || !(cm == null ? void 0 : cm.posAtCoords) || typeof editor.offsetToPos !== "function") {
      this.syncSidebarToCursor();
      return;
    }
    const scrollRect = cm.scrollDOM.getBoundingClientRect();
    const middleCoords = {
      x: scrollRect.left + scrollRect.width / 2,
      y: scrollRect.top + scrollRect.height / 2
    };
    const offset = cm.posAtCoords(middleCoords);
    if (typeof offset !== "number") {
      this.syncSidebarToCursor();
      return;
    }
    const pos = editor.offsetToPos(offset);
    const chunkIndex = this.findChunkIndexByOffset(offset, pos.line);
    this.activateChunk(chunkIndex, true, "editor");
  }
  syncEditorToCenteredCard() {
    if (!this.cards.length || !this.sidebarContainer) return;
    const containerRect = this.sidebarContainer.getBoundingClientRect();
    const center = containerRect.top + containerRect.height / 2;
    let closestIndex = -1;
    let closestDistance = Number.POSITIVE_INFINITY;
    this.cards.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return;
      const distance = Math.abs(rect.top + rect.height / 2 - center);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });
    if (closestIndex >= 0) {
      this.syncEditorToChunk(closestIndex, false);
    }
  }
  syncEditorToChunk(index, focusEditor = true) {
    const editor = this.getActiveEditor();
    const chunk = this.chunks[index];
    if (!editor || !chunk) return;
    this.activateChunk(index, false, "sidebar");
    const pos = { line: chunk.fromLine, ch: 0 };
    if (focusEditor && typeof editor.setCursor === "function") {
      editor.setCursor(pos);
    }
    if (typeof editor.scrollIntoView === "function") {
      editor.scrollIntoView({ from: pos, to: pos }, true);
    }
  }
  activateChunk(index, scrollSidebar, source) {
    if (index < 0 || !this.chunks[index]) return;
    if (this.activeChunkIndex !== index) {
      const previous = this.cards[this.activeChunkIndex];
      if (previous) previous.removeClass("chirr-card-active");
      this.activeChunkIndex = index;
      const next = this.cards[this.activeChunkIndex];
      if (next) next.addClass("chirr-card-active");
    }
    if (scrollSidebar) {
      const card = this.cards[index];
      if (card) {
        this.withSyncSource(source, () => {
          card.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    } else {
      this.withSyncSource(source, () => {
      });
    }
  }
  withSyncSource(source, action) {
    this.syncSource = source;
    action();
    if (this.syncReleaseTimer !== null) window.clearTimeout(this.syncReleaseTimer);
    this.syncReleaseTimer = window.setTimeout(() => {
      this.syncSource = null;
    }, SYNC_RELEASE_DELAY);
  }
  findChunkIndexByOffset(offset, line) {
    const offsetMatch = this.chunks.findIndex((chunk) => offset >= chunk.fromOffset && offset <= chunk.toOffset);
    if (offsetMatch >= 0) return offsetMatch;
    const lineMatch = this.chunks.findIndex((chunk) => line >= chunk.fromLine && line <= chunk.toLine);
    if (lineMatch >= 0) return lineMatch;
    let nearest = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    this.chunks.forEach((chunk, index) => {
      const distance = Math.min(Math.abs(offset - chunk.fromOffset), Math.abs(offset - chunk.toOffset));
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = index;
      }
    });
    return nearest;
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
