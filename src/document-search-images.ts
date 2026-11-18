import { createHash } from 'crypto';
import { App, TFile } from 'obsidian';
import { localSearchIndexStorage, SearchIndexStorage, terms } from './document-search-index';

const IMAGE_EXTENSION = /^(png|jpe?g|gif|webp)$/i;
const VERSION = 1;
const CAPTION_LIMIT = 800;

interface Caption {
	hash: string;
	text: string;
}

export class DocumentSearchImages {
	private references?: Map<TFile, Set<string>>;
	private fingerprints = new Map<TFile, { stamp: string; hash: string }>();
	private captions = new Map<string, Caption>();
	private loaded?: Promise<void>;
	private lastAttempted?: TFile;

	constructor(
		private app: App,
		private storage: SearchIndexStorage | null | undefined = localSearchIndexStorage(app, '-screenshots'),
	) {}

	invalidateReferences() {
		this.references = undefined;
	}

	invalidateFile(file: TFile) {
		this.fingerprints.delete(file);
	}

	embedded(): ReadonlyMap<TFile, ReadonlySet<string>> {
		if (!this.references) {
			const references = new Map<TFile, Set<string>>();
			for (const note of this.app.vault.getMarkdownFiles()) {
				for (const embed of this.app.metadataCache.getFileCache(note)?.embeds ?? []) {
					const image = this.app.metadataCache.getFirstLinkpathDest(embed.link, note.path);
					if (!(image instanceof TFile) || !IMAGE_EXTENSION.test(image.extension)
						|| this.app.vault.getAbstractFileByPath(image.path) !== image) continue;
					const parents = references.get(image) ?? new Set<string>();
					parents.add(note.path);
					references.set(image, parents);
				}
			}
			this.references = references;
		}
		return this.references;
	}

	private async load() {
		try {
			const raw = await this.storage?.read();
			if (raw === undefined) return;
			const data = JSON.parse(raw);
			if (data?.version !== VERSION || !Array.isArray(data.captions)) throw new Error('Invalid screenshot cache format.');
			for (const entry of data.captions) {
				if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1]?.hash === 'string'
					&& /^[a-f0-9]{64}$/.test(entry[1].hash) && typeof entry[1].text === 'string') {
					this.captions.set(entry[0], { hash: entry[1].hash, text: entry[1].text.slice(0, CAPTION_LIMIT) });
				}
			}
		} catch (error) {
			console.warn('Could not load screenshot search cache:', error);
		}
	}

	private async fingerprint(file: TFile, force = false): Promise<string | undefined> {
		const path = file.path;
		const stamp = () => `${file.stat.ctime}:${file.stat.mtime}:${file.stat.size}`;
		if (this.app.vault.getAbstractFileByPath(path) !== file) return;
		const before = stamp();
		const cached = this.fingerprints.get(file);
		if (!force && cached?.stamp === before) return cached.hash;
		const bytes = await this.app.vault.readBinary(file);
		if (file.path !== path || stamp() !== before || this.app.vault.getAbstractFileByPath(path) !== file) return;
		const hash = createHash('sha256').update(Buffer.from(bytes)).digest('hex');
		this.fingerprints.set(file, { stamp: before, hash });
		return hash;
	}

	async prioritize(query: string, signal?: AbortSignal): Promise<TFile[]> {
		const images = [...this.embedded().keys()];
		await (this.loaded ??= this.load());
		const queryTerms = new Set(terms(query));
		const ranked = [];
		for (const image of images) {
			if (signal?.aborted) break;
			const caption = this.captions.get(image.path);
			let score = 0;
			if (caption) {
				try {
					if (await this.fingerprint(image) === caption.hash) {
						score = terms(caption.text).filter(term => queryTerms.has(term)).length;
					}
				} catch (error) {
					console.warn('Could not verify a cached screenshot description:', error);
				}
			}
			ranked.push({ image, score });
		}
		return ranked.sort((a, b) => b.score - a.score).map(({ image }) => image);
	}

	async enrichOne(describe: (image: TFile) => Promise<string>, signal: AbortSignal) {
		await (this.loaded ??= this.load());
		const images = [...this.embedded().keys()];
		const resume = this.lastAttempted ? images.indexOf(this.lastAttempted) + 1 : 0;
		for (const image of [...images.slice(resume), ...images.slice(0, resume)]) {
			if (signal.aborted) return;
			const path = image.path;
			let hash: string | undefined;
			try {
				hash = await this.fingerprint(image);
			} catch (error) {
				console.warn('Could not read a screenshot for background enrichment:', error);
				continue;
			}
			if (signal.aborted) return;
			if (!hash || image.path !== path || !this.embedded().has(image) || this.captions.get(path)?.hash === hash) continue;
			this.lastAttempted = image;
			const text = (await describe(image)).trim().slice(0, CAPTION_LIMIT);
			if (!text) throw new Error('GitHub Copilot CLI returned an empty screenshot description.');
			if (signal.aborted || await this.fingerprint(image, true) !== hash || signal.aborted
				|| image.path !== path || !this.embedded().has(image)) return;
			const paths = new Set([...this.embedded().keys()].map(file => file.path));
			const captions = new Map([...this.captions].filter(([key]) => paths.has(key)));
			captions.set(path, { hash, text });
			await this.storage?.write(JSON.stringify({ version: VERSION, captions: [...captions] }));
			this.captions = captions;
			return;
		}
	}
}
