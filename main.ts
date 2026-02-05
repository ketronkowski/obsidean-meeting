import { Plugin, Notice, TFile } from 'obsidian';
import { MeetingProcessorSettings, DEFAULT_SETTINGS, MeetingProcessorSettingTab } from './src/ui/settings-tab';
import { CopilotClientManager } from './src/copilot-client';
import { MeetingRouter } from './src/meeting-router';
import { validateMeetingFile } from './src/validators';
import { StatusBarManager } from './src/ui/status-bar';
import { SkillLoader } from './src/skill-loader';

export default class MeetingProcessorPlugin extends Plugin {
	settings: MeetingProcessorSettings;
	copilotClient: CopilotClientManager;
	statusBar: StatusBarManager;
	router: MeetingRouter;
	skillLoader: SkillLoader;
	processing: boolean = false;

	async onload() {
		await this.loadSettings();

		// Initialize components
		this.statusBar = new StatusBarManager(this.addStatusBarItem());
		this.copilotClient = new CopilotClientManager(this.settings);
		
		// Load skills
		const pluginDir = (this.manifest as any).dir || '.obsidian/plugins/obsidean-meeting';
		console.log('Plugin directory:', pluginDir);
		this.skillLoader = new SkillLoader(this.app, pluginDir);
		await this.skillLoader.loadAll();
		
		this.router = new MeetingRouter(this.app, this.settings, this.copilotClient, this.skillLoader);

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

			// Validate it's a meeting file
			const validation = await validateMeetingFile(file, this.app, this.settings);
			if (!validation.valid) {
				new Notice(validation.error || 'Not a valid meeting file');
				return;
			}

			this.statusBar.show('Detecting meeting type...');

			// Route to appropriate handler
			await this.router.process(file);

			this.statusBar.show('Meeting processed successfully', 3000);
			new Notice('Meeting processing complete!');
		} catch (error) {
			console.error('Meeting processing error:', error);
			new Notice(`Error processing meeting: ${error.message}`);
			this.statusBar.show('Error processing meeting', 5000);
		} finally {
			this.processing = false;
		}
	}

	onunload() {
		// Cleanup
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
