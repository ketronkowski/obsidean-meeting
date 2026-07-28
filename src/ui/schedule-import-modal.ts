import { App, Modal, Notice } from 'obsidian';
import { MeetingProcessorSettings } from './settings-tab';
import { PeopleManager } from '../people-manager';
import { ParsedScheduleItem, UnparsedLine } from '../schedule-import/parser';
import { buildTargetPath, createScheduleNote } from '../schedule-import/creator';

interface ScheduleRow {
	item: ParsedScheduleItem;
	targetPath: string;
	isDuplicate: boolean;
	checked: boolean;
}

/**
 * Preview/confirmation modal shown after parsing pasted daily-schedule text.
 * Lets the user uncheck any detected meeting before notes are created, and
 * surfaces lines that couldn't be parsed or would collide with an existing
 * note (both excluded from creation regardless of checkbox state).
 */
export class ScheduleImportModal extends Modal {
	private settings: MeetingProcessorSettings;
	private peopleManager: PeopleManager;
	private date: string;
	private rows: ScheduleRow[];
	private unparsed: UnparsedLine[];

	constructor(
		app: App,
		settings: MeetingProcessorSettings,
		peopleManager: PeopleManager,
		date: string,
		items: ParsedScheduleItem[],
		unparsed: UnparsedLine[],
	) {
		super(app);
		this.settings = settings;
		this.peopleManager = peopleManager;
		this.date = date;
		this.unparsed = unparsed;

		const meetingsFolder = (settings.meetingsFolder ?? 'Meetings').replace(/^\/|\/$/g, '');
		this.rows = items.map(item => {
			const targetPath = buildTargetPath(meetingsFolder, date, item);
			const isDuplicate = !!app.vault.getAbstractFileByPath(targetPath);
			return { item, targetPath, isDuplicate, checked: !isDuplicate };
		});
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('schedule-import-modal');

		contentEl.createEl('h2', { text: `📅 Import Schedule — ${this.date}` });
		contentEl.createEl('p', {
			text: 'Review the detected meetings below. Uncheck any you don\'t want created, then click Create Meetings.',
			cls: 'schedule-import-desc'
		});

		if (this.rows.length > 0) {
			this.renderMeetingRows(contentEl);
		} else {
			contentEl.createEl('p', { text: 'No meetings were detected in the pasted text.' });
		}

		if (this.unparsed.length > 0) {
			this.renderUnparsedSection(contentEl);
		}

		this.renderButtons(contentEl);
	}

	private renderMeetingRows(container: HTMLElement) {
		const section = container.createDiv({ cls: 'schedule-import-section' });
		section.createEl('strong', { text: `Meetings to create (${this.rows.filter(r => !r.isDuplicate).length})` });

		for (const row of this.rows) {
			const rowEl = section.createDiv({ cls: 'schedule-import-row' });

			const checkbox = rowEl.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
			checkbox.checked = row.checked;
			checkbox.disabled = row.isDuplicate;
			checkbox.addEventListener('change', () => {
				row.checked = checkbox.checked;
			});

			const label = rowEl.createEl('span', { cls: 'schedule-import-row-label' });
			label.createEl('strong', { text: row.item.title });
			if (row.item.isGreenStandup) {
				label.createEl('span', { text: ' 🟢 Green Standup', cls: 'schedule-import-badge' });
			}
			label.createEl('div', {
				text: `${row.item.startTime}–${row.item.endTime}, organized by ${row.item.organizer}`,
				cls: 'schedule-import-hint'
			});
			label.createEl('div', {
				text: row.isDuplicate ? `Already exists — will be skipped: ${row.targetPath}` : `→ ${row.targetPath}`,
				cls: row.isDuplicate ? 'schedule-import-duplicate-hint' : 'schedule-import-hint'
			});
		}
	}

	private renderUnparsedSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'schedule-import-section' });
		section.createEl('strong', { text: `⚠️ Could not parse (${this.unparsed.length})` });
		section.createEl('p', {
			text: 'These lines were not recognized as meetings (e.g. all-day events) and will not be created.',
			cls: 'schedule-import-hint'
		});
		for (const line of this.unparsed) {
			section.createEl('div', { text: line.rawLine, cls: 'schedule-import-unparsed-line' });
		}
	}

	private renderButtons(container: HTMLElement) {
		const buttonRow = container.createDiv({ cls: 'schedule-import-buttons' });

		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'mod-muted' });
		cancelBtn.addEventListener('click', () => {
			this.close();
		});

		const applyBtn = buttonRow.createEl('button', { text: 'Create Meetings', cls: 'mod-cta' });
		applyBtn.addEventListener('click', async () => {
			await this.applyAndClose();
		});
	}

	private async applyAndClose() {
		let created = 0;
		let skippedDuplicates = 0;
		let failed = 0;

		for (const row of this.rows) {
			if (row.isDuplicate) {
				skippedDuplicates++;
				continue;
			}
			if (!row.checked) continue;

			try {
				const result = await createScheduleNote(this.app, this.settings, this.peopleManager, this.date, row.item);
				if (result.status === 'created') {
					created++;
				} else {
					skippedDuplicates++;
				}
			} catch (error) {
				console.error('[ScheduleImportModal] Failed to create meeting note:', row.item.title, error);
				failed++;
			}
		}

		const parts = [`Created ${created} meeting${created !== 1 ? 's' : ''}`];
		if (skippedDuplicates > 0) parts.push(`skipped ${skippedDuplicates} duplicate${skippedDuplicates !== 1 ? 's' : ''}`);
		if (this.unparsed.length > 0) parts.push(`${this.unparsed.length} line${this.unparsed.length !== 1 ? 's' : ''} unparsed`);
		if (failed > 0) parts.push(`${failed} failed`);

		new Notice(parts.join(', '));
		this.close();
	}
}
