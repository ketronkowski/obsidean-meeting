/** @jest-environment jsdom */
import { App, TFile } from 'obsidian';
import { DocumentSearch } from '../document-search';
import { DocumentSearchModal } from '../ui/document-search-modal';

function setup(documentSearchResultLimit = 10) {
	const file = Object.assign(new TFile(), { path: 'Notes/Decision.md', basename: 'Decision', extension: 'md' });
	const search = jest.fn().mockResolvedValue({
		ignored: false,
		matches: [{ file, score: 0.9, reason: 'Records our release decision.', source: 'note' }],
	});
	const openFile = jest.fn().mockResolvedValue(undefined);
	const app = {
		vault: { getAbstractFileByPath: jest.fn(() => file) },
		metadataCache: { getFileCache: (note: TFile) => note.basename === 'Release email'
			? { headings: [{ heading: 'Email Chain' }] }
			: null },
		workspace: { getLeaf: jest.fn(() => ({ openFile })) },
	};
	const modal = new DocumentSearchModal(app as unknown as App, { search } as unknown as DocumentSearch, {
		documentSearchResultLimit, meetingsFolder: 'Project Meetings/',
	});
	modal.onOpen();
	const input = modal.contentEl.querySelector<HTMLInputElement>('input[type=text]')!;
	const form = modal.contentEl.querySelector('form')!;
	input.value = 'What did we decide about release?';
	return { modal, app, search, openFile, file, input, form };
}

async function submit(form: HTMLFormElement) {
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	await new Promise(resolve => setTimeout(resolve, 0));
}

afterEach(() => {
	jest.restoreAllMocks();
	jest.useRealTimers();
});

test('keeps Search and Close together below the results and only Search submits', async () => {
	const { modal, search, form } = setup();
	const close = jest.spyOn(modal, 'close');
	const footer = form.lastElementChild!;
	expect(footer.previousElementSibling?.tagName).toBe('OL');
	const buttons = [...footer.querySelectorAll('button')];
	expect(buttons.map(button => [button.textContent, button.type])).toEqual([['Search', 'submit'], ['Close', 'button']]);
	buttons[1].click();
	expect(close).toHaveBeenCalledTimes(1);
	expect(search).not.toHaveBeenCalled();
	await submit(form);
	expect(form.querySelectorAll('button[type=submit]')).toHaveLength(1);
	expect(form.querySelector('ol button')?.getAttribute('type')).toBe('button');
});

test('defaults screenshot fallback to unchecked, renders ranked results, opens selected note and closes', async () => {
	const { modal, search, form, openFile, file } = setup();
	const close = jest.spyOn(modal, 'close');
	expect(modal.contentEl.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked).toBe(false);
	await submit(form);
	expect(search).toHaveBeenCalledWith(
		'What did we decide about release?', false, expect.any(AbortSignal), expect.any(Function), expect.any(Function), false,
	);
	expect(modal.contentEl.querySelector('ol')!.textContent).toContain('Records our release decision.');
	modal.contentEl.querySelector<HTMLButtonElement>('ol button')!.click();
	await Promise.resolve();
	expect(openFile).toHaveBeenCalledWith(file);
	expect(close).toHaveBeenCalled();
});

test('passes screenshot opt-in and warns that general requests were ignored', async () => {
	const { modal, search, form } = setup();
	search.mockResolvedValue({ ignored: true, matches: [] });
	modal.contentEl.querySelector<HTMLInputElement>('input[type=checkbox]')!.checked = true;
	await submit(form);
	expect(search).toHaveBeenCalledWith(
		expect.any(String), true, expect.any(AbortSignal), expect.any(Function), expect.any(Function), false,
	);
	expect(modal.contentEl.textContent).toContain('Ignored:');
	expect(modal.contentEl.querySelectorAll('ol li')).toHaveLength(0);
});

test.each([10, 4])('shows only the top %i results in live and completed snapshots', async limit => {
	const { modal, search, form } = setup(limit);
	const matches = Array.from({ length: 12 }, (_, i) => ({
		file: Object.assign(new TFile(), { path: `Notes/Result ${i + 1}.md`, basename: `Result ${i + 1}` }),
		score: 1 - i / 20, reason: `Evidence ${i + 1}`, source: 'note' as const,
	}));
	let complete!: (value: { ignored: boolean; matches: typeof matches }) => void;
	search.mockReturnValue(new Promise(resolve => { complete = resolve; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	const expectTopResults = () => {
		const titles = modal.contentEl.querySelectorAll('.document-search-results button');
		expect([...titles].map(button => button.textContent)).toEqual(matches.slice(0, limit).map(match => match.file.basename));
	};
	search.mock.calls[0][4](matches);
	expectTopResults();
	complete({ ignored: false, matches });
	await Promise.resolve();
	expectTopResults();
	expect(modal.contentEl.querySelector('[role=status]')!.textContent).toBe(`Showing the top ${limit} of 12 matches.`);
});

test('uses one title with a document-type icon and keeps the full path in a tooltip', async () => {
	const { modal, search, form, file } = setup();
	const meeting = Object.assign(new TFile(), { path: 'Project Meetings/Weekly sync.md', basename: 'Weekly sync' });
	const email = Object.assign(new TFile(), { path: 'Notes/Release email.md', basename: 'Release email' });
	search.mockResolvedValue({
		ignored: false,
		matches: [
			{ file: meeting, score: 1, reason: 'Discussed the release.', source: 'note' },
			{ file: email, score: 0.9, reason: 'Confirms the decision.', source: 'note' },
			{ file, score: 0.8, reason: 'Shows the release plan.', source: 'screenshot' },
		],
	});
	await submit(form);
	const rows = [...modal.contentEl.querySelectorAll('ol li')];
	expect(rows.map(row => row.querySelector('button')!.textContent)).toEqual(['Weekly sync', 'Release email', 'Decision']);
	expect(rows.map(row => row.querySelector('[data-icon]')!.getAttribute('data-icon'))).toEqual(['calendar', 'mail', 'file-text']);
	expect(rows[1].querySelector('button')!.title).toBe(`Email: ${email.path}`);
	expect(rows[1].textContent).not.toContain(email.path);
	expect(rows[2].textContent).toContain('Screenshot match:');
});

test('shows failures and permits retry', async () => {
	const { modal, search, form } = setup();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	search.mockRejectedValue(new Error('Fusion unavailable'));
	await submit(form);
	expect(modal.contentEl.textContent).toContain('Search failed: Fusion unavailable');
	expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(false);
});

test('closing cancels pending search results and does not render late results', async () => {
	const { modal, search, form } = setup();
	let complete!: (value: { ignored: boolean; matches: [] }) => void;
	search.mockReturnValue(new Promise(resolve => { complete = resolve; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	modal.onClose();
	expect(search.mock.calls[0][2].aborted).toBe(true);
	complete({ ignored: false, matches: [] });
	await Promise.resolve();
	expect(modal.contentEl.textContent).toBe('');
});

test('revalidates selected results before opening deleted notes', async () => {
	const { modal, form, app, openFile } = setup();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	await submit(form);
	app.vault.getAbstractFileByPath.mockReturnValue(null as unknown as TFile);
	modal.contentEl.querySelector<HTMLButtonElement>('ol button')!.click();
	await Promise.resolve();
	expect(openFile).not.toHaveBeenCalled();
});

test('shows live progress and elapsed time while waiting, then stops the spinner and timer', async () => {
	jest.useFakeTimers();
	const { modal, search, form } = setup();
	let complete!: (value: { ignored: boolean; matches: [] }) => void;
	search.mockReturnValue(new Promise(resolve => { complete = resolve; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	const spinner = modal.contentEl.querySelector<HTMLElement>('.document-search-spinner')!;
	expect(spinner.hidden).toBe(false);
	const progress = search.mock.calls[0][3];
	progress('Searching notes: 12/50 checked; batch 3; 2 matches so far.');
	jest.advanceTimersByTime(65000);
	expect(modal.contentEl.textContent).toContain('12/50 checked; batch 3; 2 matches');
	expect(modal.contentEl.textContent).toContain('Elapsed: 1m 5s');
	complete({ ignored: false, matches: [] });
	await Promise.resolve();
	expect(spinner.hidden).toBe(true);
	expect(jest.getTimerCount()).toBe(0);
	expect(modal.contentEl.textContent).toContain('No matching documents found.');
});

test('closing stops the elapsed timer and ignores late progress events', async () => {
	jest.useFakeTimers();
	const { modal, search, form } = setup();
	let complete!: (value: { ignored: boolean; matches: [] }) => void;
	search.mockReturnValue(new Promise(resolve => { complete = resolve; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	expect(jest.getTimerCount()).toBe(1);
	modal.onClose();
	expect(jest.getTimerCount()).toBe(0);
	search.mock.calls[0][3]('Late progress');
	jest.advanceTimersByTime(2000);
	expect(modal.contentEl.textContent).toBe('');
	complete({ ignored: false, matches: [] });
	await Promise.resolve();
});

test('search failure stops activity and leaves the error visible', async () => {
	jest.useFakeTimers();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	const { modal, search, form } = setup();
	search.mockRejectedValue(new Error('CLI failed'));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	await Promise.resolve();
	expect(jest.getTimerCount()).toBe(0);
	expect(modal.contentEl.querySelector<HTMLElement>('.document-search-spinner')!.hidden).toBe(true);
	expect(modal.contentEl.textContent).toContain('Search failed: CLI failed');
});

test('displays incremental results while searching and replaces snapshots without duplicates', async () => {
	const { modal, search, form, file } = setup();
	const match = { file, score: 0.9, reason: 'Release decision', source: 'note' as const };
	let complete!: (value: { ignored: boolean; matches: typeof match[] }) => void;
	search.mockReturnValue(new Promise(resolve => { complete = resolve; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	const onMatches = search.mock.calls[0][4];
	onMatches([match]);
	expect(form.querySelector<HTMLButtonElement>('button[type=submit]')!.disabled).toBe(true);
	expect(modal.contentEl.querySelector('ol')!.textContent).toContain('Release decision');
	onMatches([{ ...match, score: 1, reason: 'Stronger evidence' }]);
	expect(modal.contentEl.querySelectorAll('ol li')).toHaveLength(1);
	expect(modal.contentEl.querySelector('ol')!.textContent).toContain('Stronger evidence');
	complete({ ignored: false, matches: [match] });
	await Promise.resolve();
	expect(modal.contentEl.querySelectorAll('ol li')).toHaveLength(1);
});

test('opens a partial match before search completes and ignores later result updates', async () => {
	const { modal, search, form, file, openFile } = setup();
	const close = jest.spyOn(modal, 'close').mockImplementation(() => modal.onClose());
	let complete!: (value: { ignored: boolean; matches: [] }) => void;
	search.mockReturnValue(new Promise(resolve => { complete = resolve; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	const onMatches = search.mock.calls[0][4];
	onMatches([{ file, score: 1, reason: 'Found early', source: 'note' }]);
	modal.contentEl.querySelector<HTMLButtonElement>('ol button')!.click();
	await Promise.resolve();
	expect(openFile).toHaveBeenCalledWith(file);
	expect(close).toHaveBeenCalled();
	expect(search.mock.calls[0][2].aborted).toBe(true);
	onMatches([{ file, score: 1, reason: 'Late update', source: 'note' }]);
	complete({ ignored: false, matches: [] });
	await Promise.resolve();
	expect(modal.contentEl.textContent).toBe('');
});

test('keeps already-found results available when a later batch fails', async () => {
	const { modal, search, form, file } = setup();
	jest.spyOn(console, 'error').mockImplementation(() => {});
	let fail!: (error: Error) => void;
	search.mockReturnValue(new Promise((_resolve, reject) => { fail = reject; }));
	form.dispatchEvent(new Event('submit', { cancelable: true }));
	search.mock.calls[0][4]([{ file, score: 1, reason: 'Found early', source: 'note' }]);
	fail(new Error('Later batch failed'));
	await Promise.resolve();
	expect(modal.contentEl.querySelector('ol')!.textContent).toContain('Found early');
	expect(modal.contentEl.textContent).toContain('Matches found so far remain available below.');
});
