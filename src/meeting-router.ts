import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from './ui/settings-tab';
import { CopilotClientManager } from './copilot-client';
import { detectMeetingType } from './validators';
import { GeneralMeetingHandler } from './handlers/general';
import { StandupMeetingHandler } from './handlers/standup';
import { SkillLoader } from './skill-loader';

/**
 * Routes meeting files to the appropriate handler
 */
export class MeetingRouter {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private generalHandler: GeneralMeetingHandler;
	private standupHandler: StandupMeetingHandler;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		
		// Initialize handlers
		this.generalHandler = new GeneralMeetingHandler(app, settings, copilotClient, skillLoader);
		this.standupHandler = new StandupMeetingHandler(app, settings, copilotClient, skillLoader);
	}

	/**
	 * Process a meeting file
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
}
