import { Plugin, Notice, TAbstractFile, TFile } from 'obsidian';
import { MeetingProcessorSettings, DEFAULT_SETTINGS, MeetingProcessorSettingTab } from './src/ui/settings-tab';
import { CopilotClientManager } from './src/copilot-client';
import { MeetingRouter } from './src/meeting-router';
import { validateMeetingFile, validateEmailNote, validateDailyNote } from './src/validators';
import { StatusBarManager } from './src/ui/status-bar';
import { SkillLoader } from './src/skill-loader';
import { PeopleManager } from './src/people-manager';
import { SchedulePasteModal } from './src/ui/schedule-paste-modal';
import { DocumentSearch } from './src/document-search';
import { DocumentSearchIndex } from './src/document-search-index';
import { DocumentSearchImages } from './src/document-search-images';
import { DocumentSearchModal } from './src/ui/document-search-modal';

export default class MeetingProcessorPlugin extends Plugin {
	settings: MeetingProcessorSettings;
	copilotClient: CopilotClientManager;
	statusBar: StatusBarManager;
	router: MeetingRouter;
	skillLoader: SkillLoader;
	peopleManager: PeopleManager;
	private searchIndex?: DocumentSearchIndex;
	private searchDialogs = new Set<DocumentSearchModal>();
	private indexRebuild?: AbortController;
	private screenshotEnrichment?: AbortController;
	processing: boolean = false;

	async onload() {
		await this.loadSettings();

		// Initialize components
		this.statusBar = new StatusBarManager(this.addStatusBarItem());
		this.copilotClient = new CopilotClientManager(this.app, this.settings);
		
		// Load skills
		const pluginDir = (this.manifest as any).dir || '.obsidian/plugins/obsidean-meeting';
		console.log('Plugin directory:', pluginDir);
		this.skillLoader = new SkillLoader(this.app, pluginDir);
		await this.skillLoader.loadAll();
		
		this.router = new MeetingRouter(this.app, this.settings, this.copilotClient, this.skillLoader, this.statusBar);
		this.peopleManager = new PeopleManager(this.app);

		// Add ribbon icon
		this.addRibbonIcon('brain-circuit', 'Process Meeting', async () => {
			await this.processMeeting();
		});

		// Add command palette command
		this.addCommand({
			id: 'process-meeting',
			name: 'Process Meeting',
			callback: async () => {
				await this.processMeeting();
			}
		});

		const searchIndex = this.searchIndex = new DocumentSearchIndex(this.app);
		const refreshSearchIndex = () => {
			void searchIndex.refresh().catch(error => console.warn('Document search index refresh failed:', error));
		};
		this.app.workspace.onLayoutReady(refreshSearchIndex);
		this.registerInterval(window.setInterval(refreshSearchIndex, 15 * 60 * 1000));
		const searchImages = new DocumentSearchImages(this.app);
		const searcher = new DocumentSearch(this.app, this.copilotClient, searchIndex, searchImages);
		this.registerEvent(this.app.metadataCache.on('changed', () => searchImages.invalidateReferences()));
		this.registerEvent(this.app.metadataCache.on('resolved', () => searchImages.invalidateReferences()));
		const markFileChanged = (file: TAbstractFile, ...oldPaths: string[]) => {
			searchIndex.markChanged(file.path, ...oldPaths);
			if (file instanceof TFile) searchImages.invalidateFile(file);
		};
		const markStructureChanged = (file: TAbstractFile, ...oldPaths: string[]) => {
			searchImages.invalidateReferences();
			markFileChanged(file, ...oldPaths);
		};
		this.registerEvent(this.app.vault.on('create', markStructureChanged));
		this.registerEvent(this.app.vault.on('delete', markStructureChanged));
		this.registerEvent(this.app.vault.on('rename', markStructureChanged));
		this.registerEvent(this.app.vault.on('modify', markFileChanged));
		this.app.workspace.onLayoutReady(() => {
			this.registerInterval(window.setInterval(() => {
				if (this.settings.backgroundScreenshotEnrichment !== true || this.screenshotEnrichment
					|| this.processing || this.searchDialogs.size) return;
				const controller = this.screenshotEnrichment = new AbortController();
				void searcher.enrichScreenshot(controller.signal).catch(error => {
					if (!controller.signal.aborted) console.warn('Background screenshot description failed:', error);
				}).finally(() => { this.screenshotEnrichment = undefined; });
			}, 15 * 60 * 1000));
		});
		const openDocumentSearch = () => {
			this.screenshotEnrichment?.abort();
			const modal = new DocumentSearchModal(this.app, searcher, this.settings, () => this.searchDialogs.delete(modal));
			this.searchDialogs.add(modal);
			modal.open();
		};
		this.addRibbonIcon('search', 'Search vault documents', openDocumentSearch);
		this.addCommand({
			id: 'search-vault-documents',
			name: 'Search vault documents',
			callback: openDocumentSearch,
		});
		this.addCommand({
			id: 'rebuild-document-search-index',
			name: 'Rebuild document search index',
			checkCallback: checking => {
				if (this.indexRebuild) return false;
				if (!checking) {
					const controller = this.indexRebuild = new AbortController();
					this.statusBar.show('Rebuilding document search index…', 0);
					void searchIndex.refresh(true, (checked, total) => {
						this.statusBar.show(`Indexing notes: ${checked}/${total}`, 0);
					}, controller.signal).then(() => {
						if (!controller.signal.aborted) this.statusBar.show('Document search index rebuilt', 3000);
					}).catch(error => {
						if (controller.signal.aborted) this.statusBar.show('Document search index rebuild cancelled', 3000);
						else {
							console.error('Document search index rebuild failed:', error);
							this.statusBar.show('Document search index rebuild failed', 5000);
						}
					}).finally(() => { this.indexRebuild = undefined; });
				}
				return true;
			},
		});
		this.addCommand({
			id: 'cancel-document-search-index-rebuild',
			name: 'Cancel document search index rebuild',
			checkCallback: checking => {
				if (!this.indexRebuild) return false;
				if (!checking) this.indexRebuild.abort();
				return true;
			},
		});

		// Add command palette command + Daily Note button target for importing a
		// pasted calendar schedule into one meeting note per real meeting.
		this.addCommand({
			id: 'import-daily-schedule',
			name: "Import Today's Schedule",
			callback: async () => {
				await this.importDailySchedule();
			}
		});

		// Add settings tab
		this.addSettingTab(new MeetingProcessorSettingTab(this.app, this));

		console.log('Meeting Processor plugin loaded');
	}

	async processMeeting() {
		// Prevent double-clicks
		if (this.processing) {
			new Notice('Meeting processing already in progress');
			return;
		}

		try {
			this.processing = true;
			this.statusBar.show('Validating meeting file...');

			// Get active file
			const file = this.app.workspace.getActiveFile();
			if (!file) {
				new Notice('No file is currently open');
				return;
			}

			// Validate: try daily note first, then meeting, then email chain
			const dailyNoteValidation = await validateDailyNote(file, this.app, this.settings);
			if (dailyNoteValidation.valid) {
				this.statusBar.show('Generating daily summary...', 0);
				await this.router.processDailySummary(file);
				return;
			}

			const meetingValidation = await validateMeetingFile(file, this.app, this.settings);
			if (meetingValidation.valid) {
				this.statusBar.show('Detecting meeting type...');
				const outcome = await this.router.process(file);
				if (outcome === 'transcript-not-found') {
					this.statusBar.show('No meeting transcript selected', 8000);
					new Notice('No meeting transcript found or selected. Transcript processing was skipped.', 8000);
					return;
				}
				this.statusBar.show('Meeting processed successfully', 3000);
				new Notice('Meeting processing complete!');
				return;
			}

			const emailValidation = await validateEmailNote(file, this.app, this.settings);
			if (emailValidation.valid) {
				this.statusBar.show('Processing email chain…', 0);
				await this.router.processEmail(file);
				// EmailChainHandler shows its own completion notice
				return;
			}

			// None matched — give the user a useful error
			new Notice(
				`Cannot process this file.\n` +
				`As daily note: ${dailyNoteValidation.error}\n` +
				`As meeting: ${meetingValidation.error}\n` +
				`As email chain: ${emailValidation.error}`
			);
		} catch (error) {
			console.error('Meeting processing error:', error);
			new Notice(`Error processing meeting: ${error.message}`);
			this.statusBar.show('Error processing meeting', 5000);
		} finally {
			this.processing = false;
		}
	}

	async importDailySchedule() {
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No file is currently open');
			return;
		}

		const dailyNoteValidation = await validateDailyNote(file, this.app, this.settings);
		if (!dailyNoteValidation.valid) {
			new Notice(`Cannot import schedule: ${dailyNoteValidation.error}`);
			return;
		}

		// Daily Note filenames are validated as YYYY-MM-DD.md.
		const date = file.basename;
		new SchedulePasteModal(this.app, this.settings, this.peopleManager, date).open();
	}

	onunload() {
		this.screenshotEnrichment?.abort();
		this.searchIndex?.stop();
		this.indexRebuild?.abort();
		for (const dialog of this.searchDialogs) dialog.close();
		if (this.copilotClient) {
			this.copilotClient.stop();
		}
		console.log('Meeting Processor plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
		const limit = this.settings.documentSearchResultLimit;
		if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
			console.warn('Invalid document search result limit; using the default.');
			this.settings.documentSearchResultLimit = DEFAULT_SETTINGS.documentSearchResultLimit;
		}
	}

	async saveSettings() {
		if (this.settings.backgroundScreenshotEnrichment !== true) this.screenshotEnrichment?.abort();
		await this.saveData(this.settings);
	}
}
