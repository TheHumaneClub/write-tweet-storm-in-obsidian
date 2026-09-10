import { Plugin, ItemView, WorkspaceLeaf, TFile, MarkdownView, EditorPosition } from 'obsidian';

const VIEW_TYPE_CHIRR = "chirr-thread-view";
const CHUNK_LIMIT = 280;
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
        return "Chirr Thread Live Preview";
    }

    async onOpen() {
        const container = this.containerEl.children[1];
        container.empty();
        container.addClass("chirr-sidebar-container");
        this.sidebarContainer = container as HTMLElement;

        this.previewList = this.sidebarContainer.createDiv({ cls: "chirr-preview-list" });
        this.registerDomEvent(this.sidebarContainer, "scroll", () => this.handleSidebarScroll(), { passive: true });

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

            const card = this.previewList.createDiv({ cls: "chirr-card" });
            card.dataset.chunkIndex = String(index);
            if (isOverLimit) card.addClass("chirr-card-error");
            if (index === this.activeChunkIndex) card.addClass("chirr-card-active");
            this.cards.push(card);

            const header = card.createDiv({ cls: "chirr-card-header" });
            header.createSpan({ text: `${index + 1}/` });
            
            header.createSpan({ 
                cls: `chirr-counter ${isOverLimit ? 'over-limit' : ''}`, 
                text: `${charCount}/${CHUNK_LIMIT}` 
            });

            card.createDiv({ cls: "chirr-card-body", text: tweetText });
            card.addEventListener("click", () => this.syncEditorToChunk(index));
        });

        if (!this.chunks[this.activeChunkIndex]) {
            this.activeChunkIndex = -1;
        }
    }

    parseChunks(text: string): TweetChunk[] {
        const chunks: TweetChunk[] = [];
        const lineStarts = this.getLineStarts(text);
        const delimiter = /\[\.\.\.\]/g;
        let segmentStart = 0;
        let match: RegExpExecArray | null;

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
}
