import { Plugin, Notice, TFile } from 'obsidian';
import { MeetingProcessorSettings, DEFAULT_SETTINGS, MeetingProcessorSettingTab } from './src/ui/settings-tab';
import { CopilotClientManager } from './src/copilot-client';
import { MeetingRouter } from './src/meeting-router';
import { validateMeetingFile, validateEmailNote, validateDailyNote } from './src/validators';
import { StatusBarManager } from './src/ui/status-bar';
import { SkillLoader } from './src/skill-loader';
import { PeopleManager } from './src/people-manager';
import { SchedulePasteModal } from './src/ui/schedule-paste-modal';

export default class MeetingProcessorPlugin extends Plugin {
	settings: MeetingProcessorSettings;
	copilotClient: CopilotClientManager;
	statusBar: StatusBarManager;
	router: MeetingRouter;
	skillLoader: SkillLoader;
	peopleManager: PeopleManager;
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
				await this.router.process(file);
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
		if (this.copilotClient) {
			this.copilotClient.stop();
		}
		console.log('Meeting Processor plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
