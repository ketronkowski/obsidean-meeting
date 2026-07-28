/**
 * @jest-environment jsdom
 */
import { ScheduleImportModal } from '../ui/schedule-import-modal';
import { ParsedScheduleItem, UnparsedLine } from '../schedule-import/parser';
import { TFile } from 'obsidian';

jest.mock('../schedule-import/creator', () => ({
	buildTargetPath: (folder: string, date: string, item: ParsedScheduleItem) =>
		`${folder}/${date} - ${item.title}.md`,
	createScheduleNote: jest.fn(async (_app: any, _settings: any, _people: any, _date: string, item: ParsedScheduleItem) => ({
		status: 'created',
		path: `Meetings/2026-07-28 - ${item.title}.md`,
	})),
}));

import { createScheduleNote } from '../schedule-import/creator';

function makeApp(existingPaths: string[] = []) {
	const files: Record<string, any> = {};
	for (const p of existingPaths) files[p] = Object.assign(new TFile(), { path: p });
	return {
		vault: {
			getAbstractFileByPath: jest.fn((path: string) => files[path] ?? null),
		},
	} as any;
}

function makeItem(overrides: Partial<ParsedScheduleItem> = {}): ParsedScheduleItem {
	return {
		rawLine: 'raw',
		title: 'Daily Sync',
		startTime: '11:00 AM',
		endTime: '11:30 AM',
		organizer: 'Meller, Jonathan',
		isGreenStandup: false,
		...overrides,
	};
}

describe('ScheduleImportModal', () => {
	beforeEach(() => {
		(createScheduleNote as jest.Mock).mockClear();
	});

	test('checkboxes default to checked for non-duplicate items', () => {
		const app = makeApp();
		const modal = new ScheduleImportModal(app, { meetingsFolder: 'Meetings' } as any, {} as any, '2026-07-28',
			[makeItem(), makeItem({ title: 'Second Meeting' })], []);
		modal.onOpen();

		const checkboxes = modal.contentEl.querySelectorAll('input[type="checkbox"]');
		expect(checkboxes.length).toBe(2);
		checkboxes.forEach(cb => expect((cb as HTMLInputElement).checked).toBe(true));
	});

	test('duplicate rows are unchecked and disabled', () => {
		const app = makeApp(['Meetings/2026-07-28 - Daily Sync.md']);
		const modal = new ScheduleImportModal(app, { meetingsFolder: 'Meetings' } as any, {} as any, '2026-07-28',
			[makeItem()], []);
		modal.onOpen();

		const checkbox = modal.contentEl.querySelector('input[type="checkbox"]') as HTMLInputElement;
		expect(checkbox.checked).toBe(false);
		expect(checkbox.disabled).toBe(true);
	});

	test('renders unparsed lines as read-only text with no checkbox', () => {
		const app = makeApp();
		const unparsed: UnparsedLine[] = [{ rawLine: 'There is also an all-day PTO-related event, Ajay PTO, ending today. 1' }];
		const modal = new ScheduleImportModal(app, { meetingsFolder: 'Meetings' } as any, {} as any, '2026-07-28', [], unparsed);
		modal.onOpen();

		expect(modal.contentEl.textContent).toContain('Ajay PTO');
		expect(modal.contentEl.querySelectorAll('input[type="checkbox"]').length).toBe(0);
	});

	test('Apply creates notes only for checked, non-duplicate rows', async () => {
		const app = makeApp(['Meetings/2026-07-28 - Second Meeting.md']);
		const modal = new ScheduleImportModal(app, { meetingsFolder: 'Meetings' } as any, {} as any, '2026-07-28',
			[makeItem(), makeItem({ title: 'Second Meeting' })], []);
		modal.onOpen();

		const checkboxes = Array.from(modal.contentEl.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
		// Uncheck the first (non-duplicate) row so only... actually leave checked; verify create called once for non-duplicate
		const applyBtn = Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Create Meetings') as HTMLButtonElement;
		applyBtn.click();
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(createScheduleNote).toHaveBeenCalledTimes(1);
		expect((createScheduleNote as jest.Mock).mock.calls[0][4].title).toBe('Daily Sync');
	});

	test('unchecking a row before Apply excludes it from creation', async () => {
		const app = makeApp();
		const modal = new ScheduleImportModal(app, { meetingsFolder: 'Meetings' } as any, {} as any, '2026-07-28',
			[makeItem(), makeItem({ title: 'Second Meeting' })], []);
		modal.onOpen();

		const checkboxes = Array.from(modal.contentEl.querySelectorAll('input[type="checkbox"]')) as HTMLInputElement[];
		checkboxes[0].checked = false;
		checkboxes[0].dispatchEvent(new Event('change'));

		const applyBtn = Array.from(modal.contentEl.querySelectorAll('button')).find(b => b.textContent === 'Create Meetings') as HTMLButtonElement;
		applyBtn.click();
		await new Promise(resolve => setTimeout(resolve, 0));

		expect(createScheduleNote).toHaveBeenCalledTimes(1);
		expect((createScheduleNote as jest.Mock).mock.calls[0][4].title).toBe('Second Meeting');
	});
});
