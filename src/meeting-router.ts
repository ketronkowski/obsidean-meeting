import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from './ui/settings-tab';
import { CopilotClientManager } from './copilot-client';
import { detectMeetingType } from './validators';
import { GeneralMeetingHandler } from './handlers/general';
import { StandupMeetingHandler } from './handlers/standup';
import { EmailChainHandler } from './handlers/email';
import { DailySummaryHandler } from './handlers/daily-summary';
import { SkillLoader } from './skill-loader';
import { StatusBarManager } from './ui/status-bar';

/**
 * Routes meeting and note files to the appropriate handler
 */
export class MeetingRouter {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private statusBar: StatusBarManager;
	private generalHandler: GeneralMeetingHandler;
	private standupHandler: StandupMeetingHandler;
	private emailHandler: EmailChainHandler;
	private dailySummaryHandler: DailySummaryHandler;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader, statusBar: StatusBarManager) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.statusBar = statusBar;
		
		// Initialize handlers
		this.generalHandler = new GeneralMeetingHandler(app, settings, copilotClient, skillLoader, statusBar);
		this.standupHandler = new StandupMeetingHandler(app, settings, copilotClient, skillLoader, statusBar);
		this.emailHandler = new EmailChainHandler(app, settings, copilotClient, skillLoader, statusBar);
		this.dailySummaryHandler = new DailySummaryHandler(app, settings, copilotClient, skillLoader, statusBar);
	}

	/**
	 * Process a meeting file (standup or general)
	 */
	async process(file: TFile): Promise<void> {
		const meetingType = detectMeetingType(file, this.settings);
		
		console.log(`Processing ${meetingType} meeting: ${file.basename}`);

		if (meetingType === 'standup') {
			await this.standupHandler.process(file);
		} else {
			await this.generalHandler.process(file);
		}
	}

	/**
	 * Process an email chain note
	 */
	async processEmail(file: TFile): Promise<void> {
		console.log(`Processing email chain note: ${file.basename}`);
		await this.emailHandler.process(file);
	}

	/**
	 * Generate a daily summary for a Daily Note
	 */
	async processDailySummary(file: TFile): Promise<void> {
		console.log(`Generating daily summary: ${file.basename}`);
		await this.dailySummaryHandler.process(file);
	}
}

