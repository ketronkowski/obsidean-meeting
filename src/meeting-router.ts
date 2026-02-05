import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from './ui/settings-tab';
import { CopilotClientManager } from './copilot-client';
import { detectMeetingType } from './validators';
import { GeneralMeetingHandler } from './handlers/general';
import { StandupMeetingHandler } from './handlers/standup';

/**
 * Routes meeting files to the appropriate handler
 */
export class MeetingRouter {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private generalHandler: GeneralMeetingHandler;
	private standupHandler: StandupMeetingHandler;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		
		// Initialize handlers
		this.generalHandler = new GeneralMeetingHandler(app, settings, copilotClient);
		this.standupHandler = new StandupMeetingHandler(app, settings, copilotClient);
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
