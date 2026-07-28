import { App, Modal, Notice } from 'obsidian';
import { MeetingProcessorSettings } from './settings-tab';
import { PeopleManager } from '../people-manager';
import { parseSchedule } from '../schedule-import/parser';
import { ScheduleImportModal } from './schedule-import-modal';

/**
 * First step of the "Import Today's Schedule" flow: a simple paste-in
 * textarea. On Parse, hands the raw text to `parseSchedule()` and opens the
 * `ScheduleImportModal` preview/confirmation dialog with the results.
 */
export class SchedulePasteModal extends Modal {
	private settings: MeetingProcessorSettings;
	private peopleManager: PeopleManager;
	private date: string;
	private textarea: HTMLTextAreaElement;

	constructor(app: App, settings: MeetingProcessorSettings, peopleManager: PeopleManager, date: string) {
		super(app);
		this.settings = settings;
		this.peopleManager = peopleManager;
		this.date = date;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('schedule-paste-modal');

		contentEl.createEl('h2', { text: `📋 Paste Today's Schedule — ${this.date}` });
		contentEl.createEl('p', {
			text: 'Paste your calendar\'s agenda text below. All-day events are ignored automatically.',
			cls: 'schedule-paste-desc'
		});

		this.textarea = contentEl.createEl('textarea', {
			cls: 'schedule-paste-textarea',
			attr: { rows: '14', placeholder: "Today's schedule\n\u2022 Meeting Title \u2014 11:00 AM\u201311:30 AM, organized by Last, First." }
		}) as HTMLTextAreaElement;

		const buttonRow = contentEl.createDiv({ cls: 'schedule-paste-buttons' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'mod-muted' });
		cancelBtn.addEventListener('click', () => this.close());

		const parseBtn = buttonRow.createEl('button', { text: 'Parse Schedule', cls: 'mod-cta' });
		parseBtn.addEventListener('click', () => this.parseAndOpenPreview());
	}

	private parseAndOpenPreview() {
		const text = this.textarea.value;
		if (!text || !text.trim()) {
			new Notice('Paste some schedule text first.');
			return;
		}

		const { items, unparsed } = parseSchedule(text);
		if (items.length === 0 && unparsed.length === 0) {
			new Notice('No lines found in the pasted text.');
			return;
		}

		this.close();
		new ScheduleImportModal(this.app, this.settings, this.peopleManager, this.date, items, unparsed).open();
	}
}
