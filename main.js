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
var PLUGIN_DISPLAY_NAME = "Write Tweet Thread";
var STALE_RIBBON_LABELS = ["Open Tweet Storm Composer", `Open ${PLUGIN_DISPLAY_NAME}`];
var CHUNK_LIMIT = 280;
var IDEAL_MIN_LENGTH = 250;
var SYNC_RELEASE_DELAY = 350;
var ChirrThreadView = class extends import_obsidian.ItemView {
  constructor(leaf) {
    super(leaf);
    __publicField(this, "sidebarContainer");
    __publicField(this, "previewList");
    __publicField(this, "chunks", []);
    __publicField(this, "cards", []);
    __publicField(this, "activeChunkIndex", -1);
    __publicField(this, "sourceFilePath", null);
    __publicField(this, "lastMarkdownView", null);
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
    return `${PLUGIN_DISPLAY_NAME} Preview`;
  }
  getIcon() {
    return "message-square";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("chirr-sidebar-container");
    this.sidebarContainer = container;
    const toolbar = this.sidebarContainer.createDiv({ cls: "chirr-sidebar-toolbar" });
    const copyAllButton = toolbar.createEl("button", {
      cls: "chirr-copy-all-button",
      text: "Copy all",
      attr: {
        type: "button",
        "aria-label": "Copy all tweets as plain text"
      }
    });
    copyAllButton.title = "Copy all tweets as plain text";
    (0, import_obsidian.setIcon)(copyAllButton, "copy");
    copyAllButton.addEventListener("click", async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await this.copyAllTweetText();
    });
    this.previewList = this.sidebarContainer.createDiv({ cls: "chirr-preview-list" });
    this.registerDomEvent(this.sidebarContainer, "scroll", () => this.handleSidebarScroll(), { passive: true });
    this.registerDomEvent(this.sidebarContainer, "copy", (event) => this.copySelectedTweetText(event));
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
    this.sourceFilePath = file.path;
    const sourceView = this.findMarkdownViewForFile(file.path);
    if (sourceView) this.lastMarkdownView = sourceView;
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
      const isOverLimit = charCount > CHUNK_LIMIT || chunk.isAutoSplitOverflow;
      const counterSignal = isOverLimit ? "\u{1F534}" : this.getCounterSignal(charCount);
      const card = this.previewList.createDiv({ cls: "chirr-card" });
      card.dataset.chunkIndex = String(index);
      if (isOverLimit) card.addClass("chirr-card-error");
      if (index === this.activeChunkIndex) card.addClass("chirr-card-active");
      this.cards.push(card);
      const header = card.createDiv({ cls: "chirr-card-header" });
      header.createSpan({ text: `${index + 1} / ${this.chunks.length}` });
      const actions = header.createDiv({ cls: "chirr-card-actions" });
      actions.createSpan({
        cls: `chirr-counter ${isOverLimit ? "over-limit" : ""}`,
        text: `${counterSignal} ${charCount}/${CHUNK_LIMIT}`
      });
      const copyButton = actions.createEl("button", {
        cls: "chirr-copy-button",
        attr: {
          type: "button",
          "aria-label": `Copy tweet ${index + 1}`
        }
      });
      copyButton.title = `Copy tweet ${index + 1}`;
      (0, import_obsidian.setIcon)(copyButton, "copy");
      copyButton.addEventListener("click", async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await this.copyTweetText(tweetText);
      });
      card.createDiv({ cls: "chirr-card-body", text: tweetText });
      card.addEventListener("click", () => {
        if (this.hasSelectionInside(card)) return;
        void this.syncEditorToChunk(index).catch((error) => {
          console.error(`${PLUGIN_DISPLAY_NAME} failed to navigate to tweet source`, error);
        });
      });
    });
    if (!this.chunks[this.activeChunkIndex]) {
      this.activeChunkIndex = -1;
    }
  }
  getCounterSignal(charCount) {
    if (charCount > CHUNK_LIMIT) return "\u{1F534}";
    if (charCount >= IDEAL_MIN_LENGTH) return "\u{1F7E2}";
    return "\u{1F7E1}";
  }
  parseChunks(text) {
    const chunks = [];
    const lineStarts = this.getLineStarts(text);
    const delimiter = /\[\.\.\.\]/g;
    const contentStart = this.getContentStartAfterProperties(text);
    let segmentStart = contentStart;
    let match;
    delimiter.lastIndex = contentStart;
    const addSegment = (start, end) => {
      const trimmedStart = this.skipWhitespaceForward(text, start, end);
      const trimmedEnd = this.skipWhitespaceBackward(text, trimmedStart, end);
      if (trimmedStart >= trimmedEnd) return;
      const segmentText = text.slice(trimmedStart, trimmedEnd);
      const isAutoSplitOverflow = this.toTweetText(segmentText).length > CHUNK_LIMIT;
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
          toLine,
          isAutoSplitOverflow
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
  getContentStartAfterProperties(text) {
    const openingEnd = this.endOfLine(text, 0);
    if (openingEnd < 0) return 0;
    const openingContentEnd = openingEnd - this.lineBreakLengthAt(text, openingEnd);
    if (text.slice(0, openingContentEnd).trim() !== "---") return 0;
    let lineStart = openingEnd;
    while (lineStart < text.length) {
      const lineEnd = this.endOfLine(text, lineStart);
      const contentEnd = lineEnd < 0 ? text.length : lineEnd - this.lineBreakLengthAt(text, lineEnd);
      if (text.slice(lineStart, contentEnd).trim() === "---") {
        return lineEnd < 0 ? text.length : lineEnd;
      }
      if (lineEnd < 0) break;
      lineStart = lineEnd;
    }
    return 0;
  }
  endOfLine(text, start) {
    const newlineIndex = text.indexOf("\n", start);
    return newlineIndex < 0 ? -1 : newlineIndex + 1;
  }
  lineBreakLengthAt(text, endOfLine) {
    return endOfLine > 1 && text[endOfLine - 2] === "\r" ? 2 : 1;
  }
  hasSelectionInside(element) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.toString()) return false;
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    return !!(anchorNode && focusNode && element.contains(anchorNode) && element.contains(focusNode));
  }
  copySelectedTweetText(event) {
    var _a;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;
    const anchorBody = this.closestTweetBody(selection.anchorNode);
    const focusBody = this.closestTweetBody(selection.focusNode);
    if (!anchorBody || anchorBody !== focusBody) return;
    const selectedText = this.getSelectedTextWithin(anchorBody, selection.getRangeAt(0));
    if (!selectedText) return;
    event.preventDefault();
    (_a = event.clipboardData) == null ? void 0 : _a.setData("text/plain", selectedText);
  }
  async copyTweetText(text) {
    await this.copyTextToClipboard(text, "Tweet copied", "Tweet copy failed");
  }
  async copyAllTweetText() {
    const text = this.getAllTweetText();
    if (!text) {
      new import_obsidian.Notice("No tweets to copy");
      return;
    }
    await this.copyTextToClipboard(text, "All tweets copied", "Copy all tweets failed");
  }
  getAllTweetText() {
    return this.chunks.map((chunk) => this.toTweetText(chunk.text)).filter((text) => text.length > 0).join("\n\n");
  }
  async copyTextToClipboard(text, successMessage, failureMessage) {
    try {
      await navigator.clipboard.writeText(text);
      new import_obsidian.Notice(successMessage);
    } catch (_error) {
      if (this.copyTextWithFallback(text)) {
        new import_obsidian.Notice(successMessage);
      } else {
        new import_obsidian.Notice(failureMessage);
      }
    }
  }
  copyTextWithFallback(text) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }
  closestTweetBody(node) {
    const element = node instanceof HTMLElement ? node : node == null ? void 0 : node.parentElement;
    return element == null ? void 0 : element.closest(".chirr-card-body");
  }
  getSelectedTextWithin(element, range) {
    var _a;
    const text = (_a = element.textContent) != null ? _a : "";
    const selectedRange = range.cloneRange();
    const beforeStart = range.cloneRange();
    const beforeEnd = range.cloneRange();
    beforeStart.selectNodeContents(element);
    beforeStart.setEnd(selectedRange.startContainer, selectedRange.startOffset);
    beforeEnd.selectNodeContents(element);
    beforeEnd.setEnd(selectedRange.endContainer, selectedRange.endOffset);
    return text.slice(beforeStart.toString().length, beforeEnd.toString().length);
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
    return text.replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, _target, alias) => alias).replace(/\[\[([^\]]+)\]\]/g, (_match, target) => target.split("#")[0]).replace(/^[ \t]*-{3,}[ \t]*$(?:\r?\n)?/gm, "").replace(/\*\*/g, "").replace(/(^|\s)\^[A-Za-z0-9_-]+\b/g, "$1").trim();
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
    if (activeView == null ? void 0 : activeView.file) {
      this.sourceFilePath = activeView.file.path;
      this.lastMarkdownView = activeView;
      return activeView;
    }
    if (this.sourceFilePath) {
      const sourceView = this.findMarkdownViewForFile(this.sourceFilePath);
      if (sourceView) {
        this.lastMarkdownView = sourceView;
        return sourceView;
      }
    }
    if (this.lastMarkdownView && this.getLeafForMarkdownView(this.lastMarkdownView)) {
      return this.lastMarkdownView;
    }
    this.lastMarkdownView = null;
    return null;
  }
  getActiveEditor() {
    var _a, _b;
    return (_b = (_a = this.getActiveEditorView()) == null ? void 0 : _a.editor) != null ? _b : null;
  }
  findMarkdownViewForFile(path) {
    var _a;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof import_obsidian.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === path) {
        return leaf.view;
      }
    }
    return null;
  }
  getLeafForMarkdownView(view) {
    const leaf = this.app.workspace.getLeavesOfType("markdown").find((leaf2) => leaf2.view === view);
    return leaf != null ? leaf : null;
  }
  async getOrOpenSourceMarkdownView(openIfMissing) {
    const existingView = this.getActiveEditorView();
    if (existingView) return existingView;
    if (!openIfMissing) return null;
    if (!this.sourceFilePath) return null;
    const file = this.app.vault.getFileByPath(this.sourceFilePath);
    if (!file) return null;
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.openFile(file);
    return leaf.view instanceof import_obsidian.MarkdownView ? leaf.view : null;
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
      void this.syncEditorToChunk(closestIndex, false).catch((error) => {
        console.error(`${PLUGIN_DISPLAY_NAME} failed to sync editor to tweet card`, error);
      });
    }
  }
  async syncEditorToChunk(index, focusEditor = true) {
    const editorView = await this.getOrOpenSourceMarkdownView(focusEditor);
    const editor = editorView == null ? void 0 : editorView.editor;
    const chunk = this.chunks[index];
    if (!editor || !chunk) return;
    this.activateChunk(index, false, "sidebar");
    if (focusEditor && editorView) {
      const leaf = this.getLeafForMarkdownView(editorView);
      if (leaf) await this.app.workspace.revealLeaf(leaf);
    }
    const pos = typeof editor.offsetToPos === "function" ? editor.offsetToPos(chunk.fromOffset) : { line: chunk.fromLine, ch: 0 };
    const endPos = typeof editor.offsetToPos === "function" ? editor.offsetToPos(chunk.toOffset) : pos;
    if (focusEditor && typeof editor.setCursor === "function") {
      editor.setCursor(pos);
    }
    if (typeof editor.scrollIntoView === "function") {
      editor.scrollIntoView({ from: pos, to: endPos }, true);
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
    const statusBarItem = this.addStatusBarItem();
    statusBarItem.setText(PLUGIN_DISPLAY_NAME);
    statusBarItem.title = `${PLUGIN_DISPLAY_NAME} is loaded`;
    this.removeStaleRibbonIcons();
    this.addRibbonIcon("message-square", `Open ${PLUGIN_DISPLAY_NAME}`, () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-chirr-live-preview",
      name: PLUGIN_DISPLAY_NAME,
      callback: () => {
        this.activateView();
      }
    });
    this.app.workspace.onLayoutReady(() => {
      this.ensureView(false);
    });
  }
  async ensureView(reveal) {
    try {
      const { workspace } = this.app;
      const leaves = workspace.getLeavesOfType(VIEW_TYPE_CHIRR);
      let leaf = leaves[0];
      await Promise.all(leaves.slice(1).map((extraLeaf) => extraLeaf.detach()));
      if (!leaf) {
        leaf = workspace.getRightLeaf(false) || workspace.getLeaf(true);
        await leaf.setViewState({ type: VIEW_TYPE_CHIRR, active: reveal });
      }
      if (reveal) {
        workspace.revealLeaf(leaf);
      }
    } catch (error) {
      console.error(`${PLUGIN_DISPLAY_NAME} failed to open`, error);
      new import_obsidian.Notice(`${PLUGIN_DISPLAY_NAME} failed to open. Check the developer console.`);
    }
  }
  removeStaleRibbonIcons() {
    document.querySelectorAll(".side-dock-ribbon-action").forEach((element) => {
      var _a;
      if (STALE_RIBBON_LABELS.includes((_a = element.getAttribute("aria-label")) != null ? _a : "")) {
        element.remove();
      }
    });
  }
  async activateView() {
    await this.ensureView(true);
  }
};
