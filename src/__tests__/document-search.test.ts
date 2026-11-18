import { App, FileSystemAdapter, TFile } from 'obsidian';
import { DocumentSearch } from '../document-search';
import { CopilotClientManager } from '../copilot-client';
import { DocumentSearchIndex } from '../document-search-index';
import { DocumentSearchImages } from '../document-search-images';

function file(path: string): TFile {
	return Object.assign(new TFile(), {
		path,
		basename: path.split('/').pop()!.replace(/\.[^.]+$/, ''),
		extension: path.split('.').pop()!,
	});
}

function setup(paths = ['Notes/Plan.md', 'Clippings/Decision.md']) {
	const notes = paths.map(file);
	const image = file('Media/screen.png');
	const allFiles = [...notes, image];
	const sendPrompt = jest.fn().mockResolvedValue('{"matches":[]}');
	sendPrompt.mockResolvedValueOnce('{"intent":"search"}');
	const app = {
		vault: {
			adapter: new FileSystemAdapter(),
			getMarkdownFiles: jest.fn(() => notes),
			cachedRead: jest.fn(async (note: TFile) => `Content of ${note.path}`),
			getAbstractFileByPath: jest.fn((path: string) => allFiles.find(note => note.path === path) ?? null),
		},
		metadataCache: {
			getFileCache: jest.fn((_note: TFile) => ({ embeds: [{ link: 'Media/screen.png' }] })),
			getFirstLinkpathDest: jest.fn(() => image),
		},
	};
	const searcher = new DocumentSearch(app as unknown as App, { sendPrompt } as unknown as CopilotClientManager);
	return { searcher, app, notes, image, sendPrompt };
}

const match = (path: string, score = 0.9) => ({ path, score, reason: 'Contains the decision.' });
const response = (...matches: ReturnType<typeof match>[]) => JSON.stringify({ matches });

afterEach(() => jest.restoreAllMocks());

test('accepts decision questions, scans every Markdown folder, ranks validated paths, and forces Fusion on every call', async () => {
	const { searcher, sendPrompt, app, notes } = setup();
	sendPrompt.mockResolvedValueOnce(response(match(notes[0].path, 0.6), match(notes[1].path)));
	const result = await searcher.search('What did we decide about X?');
	expect(result.ignored).toBe(false);
	expect(result.matches.map(item => item.file)).toEqual([notes[1], notes[0]]);
	expect(app.vault.cachedRead.mock.calls.map(([note]) => note.path)).toEqual(notes.map(note => note.path));
	expect(sendPrompt.mock.calls[0][0]).toContain('What did we decide about X?');
	expect(sendPrompt.mock.calls[1][0]).toContain('Clippings/Decision.md');
	for (const call of sendPrompt.mock.calls) {
		expect(call[3]).toEqual({ model: 'fusion', showWorking: false, responseOnly: true });
	}
});

test('ignores general requests without reading notes or images', async () => {
	const { searcher, sendPrompt, app } = setup();
	sendPrompt.mockReset().mockResolvedValue('{"intent":"general"}');
	await expect(searcher.search('Write a Python script', true)).resolves.toEqual({ ignored: true, matches: [] });
	expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();
	expect(sendPrompt).toHaveBeenCalledTimes(1);
});

test('rejects invented, traversal, absolute, image and unsupplied paths', async () => {
	const { searcher, sendPrompt, notes } = setup();
	const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
	sendPrompt.mockResolvedValueOnce(response(
		match('../outside.md'), match('/vault/Notes/Plan.md'), match('Missing.md'),
		match('Media/screen.png'), match('Notes/Plan.md#heading'), match(notes[0].path),
	));
	const result = await searcher.search('release decision');
	expect(result.matches.map(item => item.file)).toEqual([notes[0]]);
	expect(warn).toHaveBeenCalledTimes(5);
});

test('reads long notes to the end in bounded overlapping batches and deduplicates results', async () => {
	const { searcher, sendPrompt, app, notes } = setup(['Archive/Long.md']);
	app.vault.cachedRead.mockResolvedValue(`${'a'.repeat(50000)} decision-at-end`);
	sendPrompt.mockResolvedValue(response(match(notes[0].path, 0.7)));
	sendPrompt.mockResolvedValueOnce(response(match(notes[0].path, 0.4)));
	const result = await searcher.search('decision-at-end');
	const prompts = sendPrompt.mock.calls.slice(1).map(call => call[0] as string);
	expect(prompts.length).toBeGreaterThan(2);
	expect(prompts.some(prompt => prompt.includes('decision-at-end"'))).toBe(true);
	expect(Math.max(...prompts.map(prompt => prompt.length))).toBeLessThan(26000);
	expect(result.matches).toHaveLength(1);
	expect(result.matches[0].score).toBe(0.7);
});

test('does not inspect screenshots by default when notes do not match', async () => {
	const { searcher, sendPrompt, app } = setup();
	await expect(searcher.search('release decision')).resolves.toEqual({ ignored: false, matches: [] });
	expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test('does not inspect screenshots when Markdown matches, even with opt-in', async () => {
	const { searcher, sendPrompt, app, notes } = setup();
	sendPrompt.mockResolvedValueOnce(response(match(notes[0].path)));
	await searcher.search('release decision', true);
	expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test('uses Fusion vision once per embedded image and returns only valid containing notes', async () => {
	const { searcher, sendPrompt, notes } = setup();
	const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
	sendPrompt
		.mockResolvedValueOnce(response())
		.mockResolvedValueOnce(response(match(notes[1].path), match('Media/screen.png')));
	const result = await searcher.search('release chart', true);
	expect(sendPrompt).toHaveBeenCalledTimes(3);
	const visionCall = sendPrompt.mock.calls[2];
	expect(visionCall[0]).toContain('[📷 /vault/Media/screen.png]');
	expect(visionCall[3]).toEqual({ model: 'fusion', showWorking: false, responseOnly: true });
	expect(result.matches).toEqual([expect.objectContaining({ file: notes[1], source: 'screenshot' })]);
	expect(warn).toHaveBeenCalledTimes(1);
});

test('rejects a real Markdown path that does not contain the inspected image', async () => {
	const { searcher, sendPrompt, notes, app } = setup();
	jest.spyOn(console, 'warn').mockImplementation(() => {});
	app.metadataCache.getFileCache.mockImplementation(note =>
		({ embeds: note === notes[0] ? [{ link: 'Media/screen.png' }] : [] }));
	sendPrompt.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(match(notes[1].path)));
	expect((await searcher.search('release chart', true)).matches).toEqual([]);
});

test('ignores unresolved and non-image embeds', async () => {
	const { searcher, app, sendPrompt, notes } = setup();
	app.metadataCache.getFirstLinkpathDest.mockReturnValue(notes[0]);
	await searcher.search('release chart', true);
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test.each([
	'not JSON',
	'[]',
	'{"matches":[]} {"matches":[]}',
	'{"matches":[{"path":"Notes/Plan.md","score":0.9,"reason":"truncated"}]',
	'{"matches":null}',
	'{"matches":[{"path":"Notes/Plan.md","score":"high","reason":"yes"}]}',
	'{"matches":[{"path":"Notes/Plan.md","score":2,"reason":"yes"}]}',
])('surfaces malformed model output rather than treating it as no matches: %s', async output => {
	const { searcher, sendPrompt, app } = setup();
	sendPrompt.mockResolvedValueOnce(output);
	await expect(searcher.search('release decision', true)).rejects.toThrow(/Copilot returned/);
	expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
});

test.each([
	'Here is the result:\n```json\n{"intent":"search"}\n```\n',
	' ● Copilot Fusion selected a model.\n\n{"intent":"search"}\n\nSearch complete.',
])('accepts a JSON intent surrounded by CLI or model formatting: %s', async output => {
	const { searcher, sendPrompt } = setup();
	sendPrompt.mockReset().mockResolvedValue('{"matches":[]}').mockResolvedValueOnce(output);
	await expect(searcher.search('release decision')).resolves.toEqual({ ignored: false, matches: [] });
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test('preserves JSON string content that the prose cleaner would remove', async () => {
	const { searcher, sendPrompt, notes } = setup(['Notes/Placeholder design.md']);
	const reason = 'Explains the **placeholder** design and the {release} decision.';
	sendPrompt.mockResolvedValueOnce(`Here are the matching documents:\n\`\`\`json\n${JSON.stringify({
		matches: [{ path: notes[0].path, score: 0.9, reason }],
	})}\n\`\`\`\n`);
	const result = await searcher.search('release decision');
	expect(result.matches).toEqual([expect.objectContaining({ file: notes[0], reason })]);
});

test('surfaces CLI errors without falling back to images or another model', async () => {
	const { searcher, sendPrompt, app } = setup();
	sendPrompt.mockRejectedValueOnce(new Error('Fusion unavailable'));
	await expect(searcher.search('release decision', true)).rejects.toThrow('Fusion unavailable');
	expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
});

test('closing a search stops subsequent batches', async () => {
	const { searcher, sendPrompt, app } = setup(['Long.md']);
	app.vault.cachedRead.mockResolvedValue('a'.repeat(50000));
	const controller = new AbortController();
	sendPrompt.mockImplementationOnce(async () => {
		controller.abort();
		return response();
	});
	await expect(searcher.search('release decision', true, controller.signal)).rejects.toThrow('cancelled');
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test('reports completed notes only after their final chunk is analyzed, with cumulative matches', async () => {
	const { searcher, sendPrompt, app, notes } = setup(['Archive/Long.md']);
	app.vault.cachedRead.mockResolvedValue('a'.repeat(50000));
	sendPrompt.mockResolvedValue(response(match(notes[0].path)));
	const progress = jest.fn();
	await searcher.search('release decision', false, undefined, progress);
	const messages = progress.mock.calls.map(([message]) => message as string);
	expect(messages[0]).toContain('Understanding your search');
	expect(messages).toContain('Reading 1 Markdown notes...');
	expect(messages).toContain('Notes checked: 0/1; 1 matches so far.');
	expect(messages.filter(message => message.startsWith('Notes checked: 1/1'))).toHaveLength(1);
	expect(messages[messages.length - 1]).toBe('Notes checked: 1/1; 1 matches so far.');
	expect(messages.some(message => message.includes('analyzing batch 2'))).toBe(true);
});

test('reports screenshot fallback activity and completion counts', async () => {
	const { searcher, sendPrompt, notes } = setup();
	sendPrompt.mockResolvedValueOnce(response()).mockResolvedValueOnce(response(match(notes[0].path)));
	const progress = jest.fn();
	const onMatches = jest.fn();
	await searcher.search('release chart', true, undefined, progress, onMatches);
	expect(progress).toHaveBeenCalledWith('No Markdown matches. Finding embedded screenshots...');
	expect(progress).toHaveBeenCalledWith('Inspecting screenshot 1/1; 0 matching notes so far.');
	expect(progress).toHaveBeenLastCalledWith('Screenshots checked: 1/1; 1 matching notes so far.');
	expect(onMatches).toHaveBeenLastCalledWith([
		expect.objectContaining({ file: notes[0], source: 'screenshot' }),
	]);
});

test('publishes validated ranked matches before remaining note batches finish', async () => {
	const { searcher, sendPrompt, app, notes } = setup();
	app.vault.cachedRead.mockResolvedValue('a'.repeat(16000));
	let complete!: (value: string) => void;
	sendPrompt
		.mockResolvedValueOnce(response(match(notes[0].path, 0.7)))
		.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
	const onMatches = jest.fn();
	const pending = searcher.search('release decision', false, undefined, undefined, onMatches);
	await new Promise(resolve => setImmediate(resolve));
	expect(sendPrompt).toHaveBeenCalledTimes(3);
	expect(onMatches).toHaveBeenCalledTimes(1);
	expect(onMatches.mock.calls[0][0].map((item: { file: TFile }) => item.file)).toEqual([notes[0]]);
	complete(response(match(notes[1].path, 0.95)));
	const final = await pending;
	expect(onMatches).toHaveBeenLastCalledWith(final.matches);
	expect(final.matches.map(item => item.file)).toEqual([notes[1], notes[0]]);
});

test('incremental snapshots stay deduplicated as stronger evidence arrives in later chunks', async () => {
	const { searcher, sendPrompt, app, notes } = setup(['Archive/Long.md']);
	app.vault.cachedRead.mockResolvedValue('a'.repeat(50000));
	sendPrompt.mockResolvedValue(response(match(notes[0].path, 0.9)));
	sendPrompt.mockResolvedValueOnce(response(match(notes[0].path, 0.4)));
	const onMatches = jest.fn();
	await searcher.search('release decision', false, undefined, undefined, onMatches);
	expect(onMatches.mock.calls.length).toBeGreaterThan(1);
	for (const [snapshot] of onMatches.mock.calls) expect(snapshot).toHaveLength(1);
	expect(onMatches.mock.calls[0][0][0].score).toBe(0.4);
	expect(onMatches.mock.calls[onMatches.mock.calls.length - 1][0][0].score).toBe(0.9);
});

function indexedSetup() {
	const { app, notes, sendPrompt } = setup();
	const candidates = jest.fn(async () => [{ path: notes[0].path, content: 'Approved release plan.' }]);
	const index = { refresh: jest.fn(async () => {}), revision: 1, candidates, prioritizedPaths: jest.fn((): string[] => []) };
	const searcher = new DocumentSearch(app as unknown as App, { sendPrompt } as unknown as CopilotClientManager,
		index as unknown as DocumentSearchIndex);
	sendPrompt.mockReset();
	return { app, notes, sendPrompt, candidates, index, searcher };
}

test('ranks indexed excerpts in one request, caches successful searches, and invalidates on vault revision', async () => {
	const { searcher, sendPrompt, index, app, notes } = indexedSetup();
	sendPrompt.mockResolvedValue(JSON.stringify({ intent: 'search', matches: [match(notes[0].path)] }));
	const first = await searcher.search('release decision');
	expect(first).toMatchObject({ scope: 'indexed', matches: [{ file: notes[0] }] });
	expect(sendPrompt).toHaveBeenCalledTimes(1);
	expect(sendPrompt.mock.calls[0][0]).toContain('Approved release plan.');
	expect(app.vault.getMarkdownFiles).not.toHaveBeenCalled();
	expect(await searcher.search('  release  decision  ')).toEqual(first);
	expect(sendPrompt).toHaveBeenCalledTimes(1);
	index.revision++;
	await searcher.search('release decision');
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test('expands empty candidate results using alternate terms and ignores general requests', async () => {
	const { searcher, sendPrompt, candidates, notes } = indexedSetup();
	candidates.mockResolvedValueOnce([]);
	sendPrompt
		.mockResolvedValueOnce(JSON.stringify({ intent: 'search', matches: [], alternateTerms: 'shipment' }))
		.mockResolvedValueOnce(JSON.stringify({ intent: 'search', matches: [match(notes[0].path)] }))
		.mockResolvedValueOnce(JSON.stringify({ intent: 'general', matches: [match(notes[0].path)] }));
	expect((await searcher.search('deployment decision')).matches).toHaveLength(1);
	expect(candidates).toHaveBeenLastCalledWith('deployment decision shipment', 60, undefined);
	expect(await searcher.search('write me a song')).toMatchObject({ ignored: true, matches: [] });
	expect(sendPrompt).toHaveBeenCalledTimes(3);
});

test('checks every Markdown note before screenshot fallback when the indexed shortlist misses', async () => {
	const { searcher, sendPrompt, app, notes } = indexedSetup();
	sendPrompt
		.mockResolvedValueOnce(JSON.stringify({ intent: 'search', matches: [] }))
		.mockResolvedValueOnce(response(match(notes[1].path)));
	expect((await searcher.search('release decision', true)).matches[0].file).toBe(notes[1]);
	expect(app.vault.cachedRead).toHaveBeenCalledTimes(2);
	expect(app.metadataCache.getFileCache).not.toHaveBeenCalled();
	expect(sendPrompt).toHaveBeenCalledTimes(2);
});

test('deep search processes at most two batches at once and publishes a finished batch immediately', async () => {
	const { searcher, sendPrompt, app, candidates, notes } = indexedSetup();
	app.vault.cachedRead.mockResolvedValue('x'.repeat(16000));
	const complete: Array<(value: string) => void> = [];
	sendPrompt.mockResolvedValueOnce('{"intent":"search"}');
	sendPrompt.mockImplementation(() => new Promise(resolve => complete.push(resolve)));
	const snapshots = jest.fn();
	const pending = searcher.search('release decision', false, undefined, undefined, snapshots, true);
	await new Promise(resolve => setImmediate(resolve));
	expect(complete).toHaveLength(2);
	expect(candidates).not.toHaveBeenCalled();
	complete[1](response(match(notes[1].path)));
	await new Promise(resolve => setImmediate(resolve));
	expect(snapshots).toHaveBeenLastCalledWith([expect.objectContaining({ file: notes[1] })]);
	complete[0](response());
	await expect(pending).resolves.toMatchObject({ scope: 'deep', matches: [{ file: notes[1] }] });
});

test('deep search moves likely notes first without skipping other folders', async () => {
	const { searcher, sendPrompt, app, index, notes } = indexedSetup();
	index.prioritizedPaths.mockReturnValue([notes[1].path, 'Missing.md']);
	app.vault.cachedRead.mockResolvedValue('x'.repeat(16000));
	sendPrompt.mockResolvedValueOnce('{"intent":"search"}').mockResolvedValue(response());
	await searcher.search('release decision', false, undefined, undefined, undefined, true);
	expect(app.vault.cachedRead.mock.calls.map(([note]) => note.path)).toEqual([notes[1].path, notes[0].path]);
	expect(sendPrompt.mock.calls[1][0]).toContain(notes[1].path);
	expect(sendPrompt.mock.calls[2][0]).toContain(notes[0].path);
});

test('splits deep search at a section boundary and keeps multibyte chunks within the serialized budget', async () => {
	const { searcher, app, sendPrompt } = setup(['Archive/Long.md']);
	app.vault.cachedRead.mockResolvedValue(`${'a'.repeat(13000)}\n\n# Details\n${'😀'.repeat(14000)} end-of-note`);
	await searcher.search('details');
	const payloads = sendPrompt.mock.calls.slice(1).map(([prompt]) => (prompt as string).split('\n').pop()!);
	const chunks = payloads.flatMap(payload => (JSON.parse(payload) as { content: string }[]).map(chunk => chunk.content));
	expect(chunks[0]).toMatch(/a\n\n$/);
	expect(chunks[1]).toContain('# Details');
	expect(chunks[chunks.length - 1]).toContain('end-of-note');
	expect(payloads.every(payload => Buffer.byteLength(payload) <= 24000)).toBe(true);
	expect(payloads.every(payload => !/\\ud[89a-f][0-9a-f]{2}/i.test(payload))).toBe(true);
});

test('persists captions for restart, prioritizes valid matches, and invalidates embeds and edited image bytes', async () => {
	const { app, notes, image, sendPrompt } = setup();
	const another = file('Media/chart.png');
	const files = [...notes, image, another];
	app.vault.getAbstractFileByPath.mockImplementation(path => files.find(file => file.path === path) ?? null);
	Object.assign(image, { stat: { ctime: 1, mtime: 1, size: 1 } });
	Object.assign(another, { stat: { ctime: 1, mtime: 1, size: 1 } });
	const bytes = new Map([[image, new Uint8Array([1])], [another, new Uint8Array([2])]]);
	Object.assign(app.vault, { readBinary: jest.fn(async (file: TFile) => bytes.get(file)!.buffer) });
	app.metadataCache.getFileCache.mockImplementation(note => ({ embeds: [{ link: note === notes[0] ? image.path : another.path }] }));
	app.metadataCache.getFirstLinkpathDest.mockImplementation((link?: string) => link === image.path ? image : another);
	let persisted: string | undefined;
	const storage = { read: async () => persisted, write: async (value: string) => { persisted = value; } };
	const appInstance = app as unknown as App;
	const cache = new DocumentSearchImages(appInstance, storage);
	const searcher = new DocumentSearch(appInstance, { sendPrompt } as unknown as CopilotClientManager, undefined, cache);
	sendPrompt.mockReset()
		.mockResolvedValueOnce('{"caption":"Service health"}')
		.mockResolvedValueOnce('{"caption":"Quarterly revenue chart"}');
	const signal = new AbortController().signal;
	await searcher.enrichScreenshot(signal);
	expect(sendPrompt).toHaveBeenCalledTimes(1);
	await searcher.enrichScreenshot(signal);
	await searcher.enrichScreenshot(signal);
	expect(sendPrompt).toHaveBeenCalledTimes(2);
	expect(sendPrompt.mock.calls[1][3]).toMatchObject({ model: 'fusion', responseOnly: true, signal });

	const restarted = new DocumentSearchImages(appInstance, storage);
	const freshSearcher = new DocumentSearch(appInstance, { sendPrompt } as unknown as CopilotClientManager, undefined, restarted);
	sendPrompt.mockReset()
		.mockResolvedValueOnce('{"intent":"search"}').mockResolvedValueOnce(response())
		.mockResolvedValueOnce(response(match(notes[1].path))).mockResolvedValueOnce(response());
	const result = await freshSearcher.search('quarterly revenue chart', true);
	expect(sendPrompt.mock.calls[2][0]).toContain('Image: [📷 /vault/Media/chart.png]');
	expect(sendPrompt.mock.calls[3][0]).toContain('Image: [📷 /vault/Media/screen.png]');
	expect(result.matches.map(match => match.file)).toEqual([notes[1]]);
	expect(await restarted.prioritize('revenue')).toEqual([another, image]);
	bytes.set(another, new Uint8Array([3]));
	restarted.invalidateFile(another);
	expect(await restarted.prioritize('revenue')).toEqual([image, another]);
	app.metadataCache.getFileCache.mockImplementation(() => ({ embeds: [{ link: image.path }] }));
	restarted.invalidateReferences();
	expect([...restarted.embedded().get(image)!]).toEqual(notes.map(note => note.path));
	expect(restarted.embedded().has(another)).toBe(false);
});

test('does not save a screenshot description if the image changes while it is being analyzed', async () => {
	const { app, image } = setup();
	Object.assign(image, { stat: { ctime: 1, mtime: 1, size: 1 } });
	let bytes = new Uint8Array([1]);
	Object.assign(app.vault, { readBinary: async () => bytes.buffer });
	const write = jest.fn(async (_value: string) => {});
	const cache = new DocumentSearchImages(app as unknown as App, { read: async () => undefined, write });
	const signal = new AbortController().signal;
	await cache.enrichOne(async () => {
		bytes = new Uint8Array([2]);
		cache.invalidateFile(image);
		return 'Old description';
	}, signal);
	expect(write).not.toHaveBeenCalled();
	await cache.enrichOne(async () => 'New description', signal);
	expect(write.mock.calls[0][0]).toContain('New description');
});
