import { App, Plugin, ItemView, WorkspaceLeaf, TFile } from 'obsidian';

const VIEW_TYPE_CHIRR = "chirr-thread-view";

class ChirrThreadView extends ItemView {
    previewList: HTMLElement;

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

        this.previewList = container.createDiv({ cls: "chirr-preview-list" });

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
            })
        );

        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            this.updateChunksFromFile(activeFile);
        }
    }

    async updateChunksFromFile(file: TFile) {
        const content = await this.app.vault.read(file);
        this.renderChunks(content);
    }

    renderChunks(text: string) {
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
                cls: `chirr-counter ${isOverLimit ? 'over-limit' : ''}`, 
                text: `${charCount}/280` 
            });

            card.createDiv({ cls: "chirr-card-body", text: chunk });
        });
    }

    parseChunks(text: string): string[] {
        // Splits by explicit [...] triggers first
        let rawSegments = text.split(/\[\.\.\.\]/);
        let finalChunks: string[] = [];

        rawSegments.forEach(segment => {
            segment = segment.trim();
            if (!segment) return;

            // Enforces strict 280-character word-aware splitting per segment
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