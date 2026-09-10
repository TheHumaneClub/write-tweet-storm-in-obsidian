import { Plugin, ItemView, WorkspaceLeaf, TFile, MarkdownView, EditorPosition, Notice, setIcon } from 'obsidian';

const VIEW_TYPE_CHIRR = "chirr-thread-view";
const PLUGIN_DISPLAY_NAME = "Write Tweet Thread";
const STALE_RIBBON_LABELS = ["Open Tweet Storm Composer", `Open ${PLUGIN_DISPLAY_NAME}`];
const CHUNK_LIMIT = 280;
const IDEAL_MIN_LENGTH = 250;
const SYNC_RELEASE_DELAY = 350;

type SyncSource = "editor" | "sidebar" | null;

interface TweetChunk {
    text: string;
    index: number;
    fromOffset: number;
    toOffset: number;
    fromLine: number;
    toLine: number;
}

class ChirrThreadView extends ItemView {
    sidebarContainer: HTMLElement;
    previewList: HTMLElement;
    chunks: TweetChunk[] = [];
    cards: HTMLElement[] = [];
    activeChunkIndex = -1;
    syncSource: SyncSource = null;
    syncReleaseTimer: number | null = null;
    boundEditorScrollEls = new WeakSet<Element>();
    editorScrollDebounce: number | null = null;
    sidebarScrollDebounce: number | null = null;

    constructor(leaf: WorkspaceLeaf) {
        super(leaf);
    }

    getViewType(): string {
        return VIEW_TYPE_CHIRR;
    }

    getDisplayText(): string {
        return `${PLUGIN_DISPLAY_NAME} Preview`;
    }

    getIcon(): string {
        return "message-square";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("chirr-sidebar-container");
        this.sidebarContainer = container as HTMLElement;

        const toolbar = this.sidebarContainer.createDiv({ cls: "chirr-sidebar-toolbar" });
        const copyAllButton = toolbar.createEl("button", {
            cls: "chirr-copy-all-button",
            text: "Copy all",
            attr: {
                type: "button",
                "aria-label": "Copy all tweets as plain text",
            },
        });
        copyAllButton.title = "Copy all tweets as plain text";
        setIcon(copyAllButton, "copy");
        copyAllButton.addEventListener("click", async (event) => {
            event.preventDefault();
            event.stopPropagation();
            await this.copyAllTweetText();
        });

        this.previewList = this.sidebarContainer.createDiv({ cls: "chirr-preview-list" });
        this.registerDomEvent(this.sidebarContainer, "scroll", () => this.handleSidebarScroll(), { passive: true });
        this.registerDomEvent(this.sidebarContainer, "copy", (event: ClipboardEvent) => this.copySelectedTweetText(event));

        // Listen for live modifications in the vault
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile && file.path === activeFile.path) {
                    this.updateChunksFromFile(activeFile);
                }
            })
        );

        this.registerEvent(
            this.app.workspace.on("active-leaf-change", () => {
                const activeFile = this.app.workspace.getActiveFile();
                if (activeFile) {
                    this.updateChunksFromFile(activeFile);
                }
                this.bindActiveEditor();
            })
        );
        this.registerEvent(
            this.app.workspace.on("editor-change", (editor, info) => {
                const activeFile = this.app.workspace.getActiveFile();
                if (!activeFile || info.file?.path !== activeFile.path) return;

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

    async updateChunksFromFile(file: TFile) {
        const content = await this.app.vault.read(file);
        this.renderChunks(content);
    }

    renderChunks(text: string) {
        if (!this.previewList) return;
        this.previewList.empty();
        this.cards = [];

        this.chunks = this.parseChunks(text);

        this.chunks.forEach((chunk, index) => {
            const tweetText = this.toTweetText(chunk.text);
            const charCount = tweetText.length;
            const isOverLimit = charCount > CHUNK_LIMIT;
            const counterSignal = this.getCounterSignal(charCount);

            const card = this.previewList.createDiv({ cls: "chirr-card" });
            card.dataset.chunkIndex = String(index);
            if (isOverLimit) card.addClass("chirr-card-error");
            if (index === this.activeChunkIndex) card.addClass("chirr-card-active");
            this.cards.push(card);

            const header = card.createDiv({ cls: "chirr-card-header" });
            header.createSpan({ text: `${index + 1} / ${this.chunks.length}` });

            const actions = header.createDiv({ cls: "chirr-card-actions" });
            actions.createSpan({
                cls: `chirr-counter ${isOverLimit ? 'over-limit' : ''}`, 
                text: `${counterSignal} ${charCount}/${CHUNK_LIMIT}` 
            });
            const copyButton = actions.createEl("button", {
                cls: "chirr-copy-button",
                attr: {
                    type: "button",
                    "aria-label": `Copy tweet ${index + 1}`,
                },
            });
            copyButton.title = `Copy tweet ${index + 1}`;
            setIcon(copyButton, "copy");
            copyButton.addEventListener("click", async (event) => {
                event.preventDefault();
                event.stopPropagation();
                await this.copyTweetText(tweetText);
            });

            card.createDiv({ cls: "chirr-card-body", text: tweetText });
            card.addEventListener("click", () => {
                if (this.hasSelectionInside(card)) return;
                this.syncEditorToChunk(index);
            });
        });

        if (!this.chunks[this.activeChunkIndex]) {
            this.activeChunkIndex = -1;
        }
    }

    getCounterSignal(charCount: number): string {
        if (charCount > CHUNK_LIMIT) return "🔴";
        if (charCount >= IDEAL_MIN_LENGTH) return "🟢";
        return "🟡";
    }

    parseChunks(text: string): TweetChunk[] {
        const chunks: TweetChunk[] = [];
        const lineStarts = this.getLineStarts(text);
        const delimiter = /\[\.\.\.\]/g;
        const contentStart = this.getContentStartAfterProperties(text);
        let segmentStart = contentStart;
        let match: RegExpExecArray | null;
        delimiter.lastIndex = contentStart;

        const addSegment = (start: number, end: number) => {
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
                    toLine,
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

    getContentStartAfterProperties(text: string): number {
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

    endOfLine(text: string, start: number): number {
        const newlineIndex = text.indexOf("\n", start);
        return newlineIndex < 0 ? -1 : newlineIndex + 1;
    }

    lineBreakLengthAt(text: string, endOfLine: number): number {
        return endOfLine > 1 && text[endOfLine - 2] === "\r" ? 2 : 1;
    }

    hasSelectionInside(element: HTMLElement): boolean {
        const selection = window.getSelection();
        if (!selection || selection.isCollapsed || !selection.toString()) return false;

        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        return !!(
            anchorNode &&
            focusNode &&
            element.contains(anchorNode) &&
            element.contains(focusNode)
        );
    }

    copySelectedTweetText(event: ClipboardEvent) {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return;

        const anchorBody = this.closestTweetBody(selection.anchorNode);
        const focusBody = this.closestTweetBody(selection.focusNode);
        if (!anchorBody || anchorBody !== focusBody) return;

        const selectedText = this.getSelectedTextWithin(anchorBody, selection.getRangeAt(0));
        if (!selectedText) return;

        event.preventDefault();
        event.clipboardData?.setData("text/plain", selectedText);
    }

    async copyTweetText(text: string) {
        await this.copyTextToClipboard(text, "Tweet copied", "Tweet copy failed");
    }

    async copyAllTweetText() {
        const text = this.getAllTweetText();
        if (!text) {
            new Notice("No tweets to copy");
            return;
        }

        await this.copyTextToClipboard(text, "All tweets copied", "Copy all tweets failed");
    }

    getAllTweetText(): string {
        return this.chunks
            .map((chunk) => this.toTweetText(chunk.text))
            .filter((text) => text.length > 0)
            .join("\n\n");
    }

    async copyTextToClipboard(text: string, successMessage: string, failureMessage: string) {
        try {
            await navigator.clipboard.writeText(text);
            new Notice(successMessage);
        } catch (_error) {
            if (this.copyTextWithFallback(text)) {
                new Notice(successMessage);
            } else {
                new Notice(failureMessage);
            }
        }
    }

    copyTextWithFallback(text: string): boolean {
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

    closestTweetBody(node: Node | null): HTMLElement | null {
        const element = node instanceof HTMLElement ? node : node?.parentElement;
        return element?.closest(".chirr-card-body") as HTMLElement | null;
    }

    getSelectedTextWithin(element: HTMLElement, range: Range): string {
        const text = element.textContent ?? "";
        const selectedRange = range.cloneRange();
        const beforeStart = range.cloneRange();
        const beforeEnd = range.cloneRange();

        beforeStart.selectNodeContents(element);
        beforeStart.setEnd(selectedRange.startContainer, selectedRange.startOffset);
        beforeEnd.selectNodeContents(element);
        beforeEnd.setEnd(selectedRange.endContainer, selectedRange.endOffset);

        return text.slice(beforeStart.toString().length, beforeEnd.toString().length);
    }

    splitSegmentByLimit(text: string, start: number, end: number): Array<{ fromOffset: number; toOffset: number }> {
        const ranges: Array<{ fromOffset: number; toOffset: number }> = [];
        let chunkStart = start;
        let chunkText = "";
        const tokenPattern = /\[\[[^\]]+\]\]|\S+/g;
        tokenPattern.lastIndex = start;
        let token: RegExpExecArray | null;

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

    toTweetText(text: string): string {
        return text
            .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_match, _target, alias) => alias)
            .replace(/\[\[([^\]]+)\]\]/g, (_match, target) => target.split("#")[0])
            .replace(/^[ \t]*-{3,}[ \t]*$(?:\r?\n)?/gm, "")
            .replace(/\*\*/g, "")
            .replace(/(^|\s)\^[A-Za-z0-9_-]+\b/g, "$1")
            .trim();
    }

    getLineStarts(text: string): number[] {
        const starts = [0];
        for (let i = 0; i < text.length; i++) {
            if (text[i] === "\n") starts.push(i + 1);
        }
        return starts;
    }

    offsetToLine(lineStarts: number[], offset: number): number {
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

    skipWhitespaceForward(text: string, start: number, end: number): number {
        while (start < end && /\s/.test(text[start])) start++;
        return start;
    }

    skipWhitespaceBackward(text: string, start: number, end: number): number {
        while (end > start && /\s/.test(text[end - 1])) end--;
        return end;
    }

    bindActiveEditor() {
        const editorView = this.getActiveEditorView();
        const scrollEl = (editorView?.editor as any)?.cm?.scrollDOM as HTMLElement | undefined;
        if (!scrollEl || this.boundEditorScrollEls.has(scrollEl)) return;

        this.boundEditorScrollEls.add(scrollEl);
        this.registerDomEvent(scrollEl, "scroll", () => this.handleEditorScroll(), { passive: true });
        this.registerDomEvent(scrollEl, "click", () => window.setTimeout(() => this.syncSidebarToCursor(), 0));
        this.registerDomEvent(scrollEl, "keyup", () => this.syncSidebarToCursor());
    }

    getActiveEditorView(): MarkdownView | null {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        return activeView ?? null;
    }

    getActiveEditor(): any | null {
        return this.getActiveEditorView()?.editor ?? null;
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
        const editor = this.getActiveEditor();
        const editorView = this.getActiveEditorView();
        const cm = (editorView?.editor as any)?.cm;
        if (!editor || !cm?.coordsAtPos || !cm?.posAtCoords || typeof editor.offsetToPos !== "function") {
            this.syncSidebarToCursor();
            return;
        }

        const scrollRect = cm.scrollDOM.getBoundingClientRect();
        const middleCoords = {
            x: scrollRect.left + scrollRect.width / 2,
            y: scrollRect.top + scrollRect.height / 2,
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
            const distance = Math.abs((rect.top + rect.height / 2) - center);
            if (distance < closestDistance) {
                closestDistance = distance;
                closestIndex = index;
            }
        });

        if (closestIndex >= 0) {
            this.syncEditorToChunk(closestIndex, false);
        }
    }

    syncEditorToChunk(index: number, focusEditor = true) {
        const editor = this.getActiveEditor();
        const chunk = this.chunks[index];
        if (!editor || !chunk) return;

        this.activateChunk(index, false, "sidebar");

        const pos: EditorPosition = { line: chunk.fromLine, ch: 0 };
        if (focusEditor && typeof editor.setCursor === "function") {
            editor.setCursor(pos);
        }

        if (typeof editor.scrollIntoView === "function") {
            editor.scrollIntoView({ from: pos, to: pos }, true);
        }
    }

    activateChunk(index: number, scrollSidebar: boolean, source: SyncSource) {
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
            this.withSyncSource(source, () => {});
        }
    }

    withSyncSource(source: SyncSource, action: () => void) {
        this.syncSource = source;
        action();
        if (this.syncReleaseTimer !== null) window.clearTimeout(this.syncReleaseTimer);
        this.syncReleaseTimer = window.setTimeout(() => {
            this.syncSource = null;
        }, SYNC_RELEASE_DELAY);
    }

    findChunkIndexByOffset(offset: number, line: number): number {
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

    async onClose() {}
}

export default class ChirrLivePlugin extends Plugin {
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

    async ensureView(reveal: boolean) {
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
            new Notice(`${PLUGIN_DISPLAY_NAME} failed to open. Check the developer console.`);
        }
    }

    removeStaleRibbonIcons() {
        document.querySelectorAll(".side-dock-ribbon-action").forEach((element) => {
            if (STALE_RIBBON_LABELS.includes(element.getAttribute("aria-label") ?? "")) {
                element.remove();
            }
        });
    }

    async activateView() {
        await this.ensureView(true);
    }
}
