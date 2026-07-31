import { App, Modal, Notice } from 'obsidian';
import { MeetingProcessorSettings } from './settings-tab';
import { PeopleManager } from '../people-manager';
import { parseSchedule } from '../schedule-import/parser';
import { parseCsvSchedule } from '../schedule-import/parser-csv';
import { ScheduleImportModal } from './schedule-import-modal';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';

/**
 * Default directory for the Outlook/Exchange CSV file picker.
 * Expands the leading `~` so Electron's dialog can use it.
 */
const OUTLOOK_CSV_DEFAULT_DIR = path.join(
	os.homedir(),
	'Library/Containers/com.microsoft.Outlook/Data/Documents/Copilot generated files',
);

/**
 * First step of the "Import Today's Schedule" flow.
 *
 * Offers two input paths in one dialog:
 *   1. Paste calendar agenda text (existing behaviour)
 *   2. Select or drag-and-drop a Microsoft Exchange/Outlook CSV export
 *
 * Both paths normalise to `ParsedSchedule` output and hand off to
 * `ScheduleImportModal` for preview/selection/note-creation.
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

		contentEl.createEl('h2', { text: `📋 Import Today's Schedule — ${this.date}` });

		// --- CSV file import section ---
		this.renderCsvSection(contentEl);

		// --- Divider ---
		const divider = contentEl.createDiv({ cls: 'schedule-paste-divider' });
		divider.createEl('span', { text: 'or paste text below' });

		// --- Text paste section ---
		contentEl.createEl('p', {
			text: 'Paste your calendar\'s agenda text below. All-day events are ignored automatically.',
			cls: 'schedule-paste-desc'
		});

		this.textarea = contentEl.createEl('textarea', {
			cls: 'schedule-paste-textarea',
			attr: {
				rows: '10',
				placeholder:
					'Upcoming / current meetings\n' +
					'\u2022 Meeting Title \u2014 11:00 AM\u201311:30 AM. 2\n' +
					'\u2022 Other Meeting \u2014 12:00 PM\u20131:00 PM (conflicts with ...). 3\n' +
					'\u2022 Meeting Title \u2014 11:00 AM\u201311:30 AM, organized by Last, First. 4',
			}
		}) as HTMLTextAreaElement;

		const buttonRow = contentEl.createDiv({ cls: 'schedule-paste-buttons' });
		const cancelBtn = buttonRow.createEl('button', { text: 'Cancel', cls: 'mod-muted' });
		cancelBtn.addEventListener('click', () => this.close());

		const parseBtn = buttonRow.createEl('button', { text: 'Parse Schedule', cls: 'mod-cta' });
		parseBtn.addEventListener('click', () => this.parseTextAndOpenPreview());
	}

	// -----------------------------------------------------------------------
	// CSV section: file chooser button + drag/drop target
	// -----------------------------------------------------------------------

	private renderCsvSection(container: HTMLElement) {
		const section = container.createDiv({ cls: 'schedule-csv-section' });

		const row = section.createDiv({ cls: 'schedule-csv-row' });

		const chooseBtn = row.createEl('button', {
			text: '📂 Choose CSV File',
			cls: 'schedule-csv-choose-btn',
		});
		chooseBtn.addEventListener('click', () => this.openCsvFilePicker());

		const dropZone = section.createDiv({ cls: 'schedule-csv-drop-zone' });
		dropZone.createEl('span', {
			text: 'Drag & drop an Outlook CSV export here',
			cls: 'schedule-csv-drop-label',
		});

		dropZone.addEventListener('dragover', (e) => {
			e.preventDefault();
			dropZone.addClass('schedule-csv-drop-active');
		});
		dropZone.addEventListener('dragleave', () => {
			dropZone.removeClass('schedule-csv-drop-active');
		});
		dropZone.addEventListener('drop', (e) => {
			e.preventDefault();
			dropZone.removeClass('schedule-csv-drop-active');
			const file = e.dataTransfer?.files?.[0];
			if (file) {
				this.handleDroppedFile(file);
			}
		});
	}

	/**
	 * Opens Electron's native file-open dialog, defaulting to the Outlook
	 * Copilot-generated-files directory if it exists.
	 */
	private openCsvFilePicker() {
		// Electron's remote module is available as `require('electron').remote`
		// in older Obsidian, and `require('@electron/remote')` in newer builds.
		// We try both without hard-failing.
		let remote: any;
		try {
			remote = (window as any).require('@electron/remote');
		} catch {
			try {
				remote = (window as any).require('electron').remote;
			} catch {
				new Notice('File picker unavailable in this environment. Use drag & drop instead.');
				return;
			}
		}

		const defaultPath = fs.existsSync(OUTLOOK_CSV_DEFAULT_DIR)
			? OUTLOOK_CSV_DEFAULT_DIR
			: os.homedir();

		remote.dialog.showOpenDialog({
			title: 'Select Outlook / Exchange CSV export',
			defaultPath,
			filters: [
				{ name: 'CSV Files', extensions: ['csv'] },
				{ name: 'All Files', extensions: ['*'] },
			],
			properties: ['openFile'],
		}).then((result: { canceled: boolean; filePaths: string[] }) => {
			if (result.canceled || !result.filePaths.length) return;
			const filePath = result.filePaths[0];
			this.loadAndParseCsvFile(filePath);
		}).catch((err: Error) => {
			console.error('[SchedulePasteModal] File dialog error:', err);
			new Notice('Could not open file picker: ' + err.message);
		});
	}

	/**
	 * Handles a file dropped onto the drop zone.
	 * In Obsidian/Electron, `File` objects from drag/drop have a `.path`
	 * property pointing to the absolute filesystem path.
	 */
	private handleDroppedFile(file: File) {
		if (!file.name.toLowerCase().endsWith('.csv')) {
			new Notice('Please drop a CSV file (.csv).');
			return;
		}
		// Electron File objects expose the absolute path via `.path`
		const filePath = (file as any).path as string | undefined;
		if (filePath) {
			this.loadAndParseCsvFile(filePath);
			return;
		}
		// Fallback: read via FileReader (web-style API)
		const reader = new FileReader();
		reader.onload = (e) => {
			const text = e.target?.result as string;
			if (text) this.parseCsvTextAndOpenPreview(text, file.name);
		};
		reader.onerror = () => new Notice('Could not read the dropped file.');
		reader.readAsText(file);
	}

	/** Reads a CSV file from the filesystem and kicks off parsing. */
	private loadAndParseCsvFile(filePath: string) {
		let csvText: string;
		try {
			csvText = fs.readFileSync(filePath, 'utf-8');
		} catch (err: any) {
			console.error('[SchedulePasteModal] Could not read CSV file:', err);
			new Notice(`Could not read file: ${err.message}`);
			return;
		}
		const fileName = path.basename(filePath);
		this.parseCsvTextAndOpenPreview(csvText, fileName);
	}

	/** Parses a CSV string and opens the preview modal. */
	private parseCsvTextAndOpenPreview(csvText: string, fileName: string) {
		const { items, unparsed } = parseCsvSchedule(csvText, this.date);
		if (items.length === 0 && unparsed.length === 0) {
			new Notice(`No events found in ${fileName}.`);
			return;
		}
		this.close();
		new ScheduleImportModal(this.app, this.settings, this.peopleManager, this.date, items, unparsed).open();
	}

	// -----------------------------------------------------------------------
	// Text paste path (existing behaviour)
	// -----------------------------------------------------------------------

	private parseTextAndOpenPreview() {
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
