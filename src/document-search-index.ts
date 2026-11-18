import { createHash, randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { App, FileSystemAdapter, TFile } from 'obsidian';

const VERSION = 1;
const DAY = 24 * 60 * 60 * 1000;
const PASSAGE_LENGTH = 1800;
const STOP = new Set('a an about and are at be can could did do does for from had has have how i in is it me my of on or our please show find tell the their them these this to us was we were what when where which who with would you your'.split(' '));

interface Passage {
	start: number;
	end: number;
	heading: string;
	terms: string[];
}

interface IndexedNote {
	path: string;
	mtime: number;
	size: number;
	hash: string;
	titleTerms: string[];
	passages: Passage[];
}

interface Posting {
	note: IndexedNote;
	passage: Passage;
}

export interface SearchCandidate {
	path: string;
	content: string;
}

export interface SearchIndexStorage {
	read(): Promise<string | undefined>;
	write(value: string): Promise<void>;
}

function hash(value: string): string {
	return createHash('sha256').update(value).digest('hex');
}

export function localSearchIndexStorage(app: App, suffix = ''): SearchIndexStorage | undefined {
	const adapter = app.vault.adapter;
	if (!(adapter instanceof FileSystemAdapter)) return;
	const directory = join(homedir(), '.cache', 'obsidean-meeting');
	const path = join(directory, `${hash(adapter.getBasePath())}${suffix}.json`);
	return {
		async read() {
			try {
				return await fs.readFile(path, 'utf8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
				return undefined;
			}
		},
		async write(value) {
			await fs.mkdir(directory, { recursive: true, mode: 0o700 });
			const temporary = `${path}.${randomUUID()}.tmp`;
			try {
				await fs.writeFile(temporary, value, { mode: 0o600, flag: 'wx' });
				await fs.rename(temporary, path);
			} finally {
				await fs.rm(temporary, { force: true });
			}
		},
	};
}

export function terms(text: string): string[] {
	const words = text.normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+(?:-[\p{L}\p{N}]+)*/gu) ?? [];
	return [...new Set(words.flatMap(word => {
		const variants = word.includes('-') ? [word, ...word.split('-')] : [word];
		return variants.flatMap(term => {
			if (STOP.has(term)) return [];
			const stem = term.length >= 6 ? term.replace(/(?:ing|ed|s)$/u, '') : term;
			return stem === term ? [term] : [term, stem];
		});
	}))];
}

function describeNote(path: string, mtime: number, size: number, text: string, digest: string): IndexedNote {
	const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
	const metadata = frontmatter.match(/^(?:aliases?|tags):[^\r\n]*(?:\r?\n[ \t]*-[^\r\n]*)*/gim) ?? [];
	const titleTerms = terms(`${path.replace(/\.md$/i, '')}\n${metadata.join('\n')}`);
	const passages: Passage[] = [];
	let heading = '';
	let start = 0;
	while (start < text.length || passages.length === 0) {
		const limit = Math.min(start + PASSAGE_LENGTH, text.length);
		let end = limit;
		if (limit < text.length) {
			const boundary = text.lastIndexOf('\n', limit - 1) + 1;
			if (boundary > start + PASSAGE_LENGTH / 2) end = boundary;
		}
		const body = text.slice(start, end);
		const headings = [...body.matchAll(/^#{1,6}\s+([^\r\n]+)/gm)];
		const label = (headings[0]?.[1] ?? heading).slice(0, 180);
		passages.push({ start, end, heading: label, terms: terms(`${label}\n${body}`) });
		heading = headings[headings.length - 1]?.[1] ?? heading;
		start = end;
		if (end === text.length) break;
	}
	return { path, mtime, size, hash: digest, titleTerms, passages };
}

function isIndexedNote(value: unknown): value is IndexedNote {
	if (!value || typeof value !== 'object') return false;
	const note = value as Partial<IndexedNote>;
	const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every(term => typeof term === 'string');
	return typeof note.path === 'string' && typeof note.mtime === 'number' && typeof note.size === 'number'
		&& typeof note.hash === 'string' && strings(note.titleTerms) && Array.isArray(note.passages)
		&& note.passages.length > 0 && note.passages.every(passage => passage
			&& Number.isSafeInteger(passage.start) && passage.start >= 0
			&& Number.isSafeInteger(passage.end) && passage.end >= passage.start
			&& typeof passage.heading === 'string' && strings(passage.terms));
}

const yieldToEditor = () => new Promise<void>(resolve => setTimeout(resolve, 0));

export class DocumentSearchIndex {
	private notes = new Map<string, IndexedNote>();
	private postings = new Map<string, Set<Posting>>();
	private notePostings = new Map<string, Posting[]>();
	private dirty = new Set<string>();
	private loaded = false;
	private stopped = false;
	private auditedAt = 0;
	private pending?: Promise<void>;
	private timer?: ReturnType<typeof setTimeout>;
	private changed = false;
	revision = 0;

	constructor(private app: App, private storage = localSearchIndexStorage(app)) {}

	markChanged(...paths: string[]) {
		if (this.stopped) return;
		this.revision++;
		for (const path of paths) {
			if (/\.md$/i.test(path)) this.dirty.add(path);
		}
		if (!this.dirty.size) return;
		clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			void this.refresh().catch(error => console.warn('Document search index refresh failed:', error));
		}, 750);
	}

	refresh(rebuild = false, onProgress?: (checked: number, total: number) => void, signal?: AbortSignal): Promise<void> {
		if (this.pending && rebuild) {
			return this.pending.then(
				() => this.refresh(true, onProgress, signal),
				() => this.refresh(true, onProgress, signal),
			);
		}
		this.pending ??= this.reconcile(rebuild, onProgress, signal).finally(() => { this.pending = undefined; });
		return this.pending.then(() => {
			if (this.dirty.size && !this.stopped && !signal?.aborted) return this.refresh();
		});
	}

	stop() {
		this.stopped = true;
		clearTimeout(this.timer);
	}

	private async reconcile(rebuild: boolean, onProgress?: (checked: number, total: number) => void, signal?: AbortSignal) {
		if (this.stopped || signal?.aborted) return;
		if (!this.loaded) {
			this.loaded = true;
			if (!rebuild) await this.load();
		}
		if (rebuild) {
			this.notes.clear();
			this.postings.clear();
			this.notePostings.clear();
			this.revision++;
			this.changed = true;
		}

		const audit = rebuild || (this.auditedAt > 0 && Date.now() - this.auditedAt >= DAY);
		const files = this.app.vault.getMarkdownFiles();
		const paths = new Set(files.map(file => file.path));
		for (const path of this.notes.keys()) {
			if (!paths.has(path)) this.replace(path);
		}
		const forced = this.dirty;
		this.dirty = new Set();
		try {
			let checked = 0;
			for (const file of files) {
				if (this.stopped) return;
				if (signal?.aborted) throw new Error('Index rebuild cancelled.');
				const { path, stat: { mtime, size } } = file;
				const previous = this.notes.get(path);
				if (audit || forced.has(path) || !previous || previous.mtime !== mtime || previous.size !== size) {
					let text: string;
					try {
						text = await this.app.vault.cachedRead(file);
					} catch (error) {
						if (this.app.vault.getAbstractFileByPath(path) !== file) continue;
						throw error;
					}
					if (this.stopped) return;
					if (!this.isCurrent(file, path, mtime, size)) {
						this.dirty.add(path);
					} else {
						const digest = hash(text);
						const next = previous?.hash === digest && !rebuild
							? { ...previous, mtime, size }
							: describeNote(path, mtime, size, text, digest);
						if (!previous || previous.hash !== digest || previous.mtime !== mtime || previous.size !== size) {
							this.replace(path, next);
						}
					}
				}
				checked++;
				onProgress?.(checked, files.length);
				if (checked % 32 === 0 && (audit || rebuild || !this.auditedAt || onProgress)) await yieldToEditor();
			}
			if (audit || !this.auditedAt) {
				this.auditedAt = Date.now();
				this.changed = true;
			}
			if (!this.stopped && this.changed && this.storage) {
				try {
					await this.storage.write(JSON.stringify({
						version: VERSION, auditedAt: this.auditedAt, notes: [...this.notes.values()],
					}));
					this.changed = false;
				} catch (error) {
					console.warn('Could not save document search index:', error);
				}
			}
		} catch (error) {
			for (const path of forced) this.dirty.add(path);
			throw error;
		}
	}

	private async load() {
		try {
			const raw = await this.storage?.read();
			if (!raw || this.stopped) return;
			const parsed: unknown = JSON.parse(raw);
			const cache = parsed as { version?: unknown; auditedAt?: unknown; notes?: unknown };
			if (!cache || cache.version !== VERSION || typeof cache.auditedAt !== 'number'
				|| !Array.isArray(cache.notes) || !cache.notes.every(isIndexedNote)
				|| new Set(cache.notes.map(note => note.path)).size !== cache.notes.length) {
				throw new Error('Unsupported or corrupt index');
			}
			this.auditedAt = cache.auditedAt;
			for (let i = 0; i < cache.notes.length && !this.stopped; i++) {
				const note = cache.notes[i];
				this.replace(note.path, note);
				if (i % 32 === 31) await yieldToEditor();
			}
			this.changed = false;
		} catch (error) {
			console.warn('Rebuilding document search index after cache load failure:', error);
			this.auditedAt = 0;
			this.notes.clear();
			this.postings.clear();
			this.notePostings.clear();
			this.changed = true;
		}
	}

	private replace(path: string, note?: IndexedNote) {
		const previous = this.notes.get(path);
		if (previous) {
			for (const posting of this.notePostings.get(path) ?? []) {
				for (const term of new Set([...posting.passage.terms, ...previous.titleTerms])) {
					const entries = this.postings.get(term)!;
					entries.delete(posting);
					if (!entries.size) this.postings.delete(term);
				}
			}
			this.notes.delete(path);
			this.notePostings.delete(path);
		}
		if (note) {
			this.notes.set(path, note);
			const postings = note.passages.map(passage => ({ note, passage }));
			this.notePostings.set(path, postings);
			for (const posting of postings) {
				for (const term of new Set([...posting.passage.terms, ...note.titleTerms])) {
					const entries = this.postings.get(term) ?? new Set<Posting>();
					entries.add(posting);
					this.postings.set(term, entries);
				}
			}
		}
		this.revision++;
		this.changed = true;
	}

	private isCurrent(file: TFile, path: string, mtime: number, size: number) {
		return this.app.vault.getAbstractFileByPath(path) === file && file.stat.mtime === mtime && file.stat.size === size;
	}

	private rank(query: string) {
		const scores = new Map<Posting, number>();
		const queryTerms = terms(query).slice(0, 64);
		for (const term of queryTerms) {
			const postings = this.postings.get(term);
			if (!postings) continue;
			const weight = 1 / Math.log2(postings.size + 2);
			for (const posting of postings) {
				const boost = posting.note.titleTerms.includes(term) ? 2 : 1;
				const headingBoost = posting.passage.heading.toLowerCase().includes(term) ? 0.5 : 0;
				scores.set(posting, (scores.get(posting) ?? 0) + weight * (boost + headingBoost));
			}
		}
		const best = new Map<string, { posting: Posting; score: number }>();
		for (const [posting, score] of scores) {
			const previous = best.get(posting.note.path);
			if (!previous || score > previous.score
				|| (score === previous.score && posting.passage.start < previous.posting.passage.start)) {
				best.set(posting.note.path, { posting, score });
			}
		}
		return [...best.values()].sort((a, b) => b.score - a.score
			|| a.posting.note.path.localeCompare(b.posting.note.path));
	}

	prioritizedPaths(query: string): string[] {
		return this.rank(query).map(({ posting }) => posting.note.path);
	}

	async candidates(query: string, limit: number, signal?: AbortSignal): Promise<SearchCandidate[]> {
		const results: SearchCandidate[] = [];
		for (const { posting: { note, passage } } of this.rank(query)) {
			if (signal?.aborted || results.length >= limit) break;
			const file = this.app.vault.getAbstractFileByPath(note.path);
			if (!(file instanceof TFile) || !this.isCurrent(file, note.path, note.mtime, note.size)) continue;
			let text: string;
			try {
				text = await this.app.vault.cachedRead(file);
			} catch (error) {
				if (!this.isCurrent(file, note.path, note.mtime, note.size)) continue;
				throw error;
			}
			if (!this.isCurrent(file, note.path, note.mtime, note.size) || hash(text) !== note.hash) {
				this.markChanged(note.path);
				continue;
			}
			const body = text.slice(passage.start, passage.end);
			const content = `${passage.heading ? `${passage.heading}\n` : ''}${body}`;
			results.push({ path: note.path, content });
		}
		return results;
	}
}
