import { App, TFile } from 'obsidian';
import { DocumentSearchIndex } from '../document-search-index';

function fixture() {
	const notes = new Map<TFile, string>();
	const add = (path: string, text: string) => {
		const file = Object.assign(new TFile(), { path, extension: 'md', stat: { ctime: 1, mtime: 1, size: text.length } });
		notes.set(file, text);
		return file;
	};
	const app = {
		vault: {
			getMarkdownFiles: () => [...notes.keys()],
			getAbstractFileByPath: (path: string) => [...notes.keys()].find(file => file.path === path) ?? null,
			cachedRead: jest.fn(async (file: TFile) => notes.get(file)!),
		},
	};
	let saved: string | undefined;
	const storage = {
		read: jest.fn(async () => saved),
		write: jest.fn(async (value: string) => { saved = value; }),
	};
	return { add, notes, app, storage, newIndex: () => new DocumentSearchIndex(app as unknown as App, storage) };
}

test('persists postings across restarts without rereading unchanged notes; retrieves evidence from late in a note', async () => {
	const { add, app, newIndex, storage } = fixture();
	const long = add('Archive/Long.md', `${'unrelated\n'.repeat(700)}# Decisions\nApproved Juniper for SIC rollout.`);
	add('Other/Garden.md', 'Rotate tomatoes');
	const first = newIndex();
	await first.refresh();
	expect(storage.write).toHaveBeenCalledTimes(1);
	first.stop();
	app.vault.cachedRead.mockClear();
	const restarted = newIndex();
	await restarted.refresh();
	expect(app.vault.cachedRead).not.toHaveBeenCalled();
	expect(await restarted.candidates('When did we approve Juniper for SIC?', 30)).toEqual([
		{ path: long.path, content: expect.stringContaining('Approved Juniper for SIC rollout.') },
	]);
	expect(app.vault.cachedRead).toHaveBeenCalledTimes(1);
	restarted.stop();
});

test('updates changed, created, renamed and deleted notes without rereading unrelated files', async () => {
	const { add, app, notes, newIndex } = fixture();
	const edited = add('Notes/Release.md', 'Orion');
	const renamed = add('Clippings/Old.md', 'release plan');
	const deleted = add('Archive/Deleted.md', 'Orion');
	add('Unchanged.md', 'noop');
	const index = newIndex();
	await index.refresh();
	app.vault.cachedRead.mockClear();
	notes.set(edited, 'Atlas');
	const oldPath = renamed.path;
	renamed.path = 'Clippings/New.md';
	notes.delete(deleted);
	const created = add('Notes/New.md', 'Pluto');
	index.markChanged(edited.path, renamed.path, oldPath, deleted.path, created.path);
	await index.refresh();
	expect(app.vault.cachedRead.mock.calls.map(([file]) => file)).toEqual([edited, renamed, created]);
	expect(await index.candidates('Orion', 5)).toEqual([]);
	expect(await index.candidates('Atlas', 5)).toEqual([{ path: edited.path, content: 'Atlas' }]);
	expect((await index.candidates('release', 5)).map(match => match.path)).toEqual([edited.path, renamed.path]);
	index.stop();
});

test('rebuilds corrupt cache and audits changes with unchanged file metadata when due', async () => {
	const { add, notes, newIndex, storage } = fixture();
	const file = add('Daily Notes/2026-03-15.md', 'Orion');
	storage.read.mockResolvedValueOnce('{"version":1,"notes":[null]}');
	const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
	const now = jest.spyOn(Date, 'now').mockReturnValue(1000);
	const index = newIndex();
	try {
		await index.refresh();
		expect(warn).toHaveBeenCalled();
		notes.set(file, 'Atlas');
		now.mockReturnValue(1000 + 24 * 60 * 60 * 1000);
		await index.refresh();
		expect(await index.candidates('Orion', 5)).toEqual([]);
		expect(await index.candidates('Atlas', 5)).toEqual([{ path: file.path, content: 'Atlas' }]);
	} finally {
		index.stop();
		now.mockRestore();
		warn.mockRestore();
	}
});

test('refresh reconciles edits that arrive during an asynchronous read before returning', async () => {
	const { add, notes, app, newIndex } = fixture();
	const file = add('Notes/Release.md', 'Orion');
	const index = newIndex();
	app.vault.cachedRead.mockImplementationOnce(async () => {
		notes.set(file, 'Atlas');
		index.markChanged(file.path);
		return 'Orion';
	});
	await index.refresh();
	expect(await index.candidates('Atlas', 5)).toEqual([{ path: file.path, content: 'Atlas' }]);
	index.stop();
});
