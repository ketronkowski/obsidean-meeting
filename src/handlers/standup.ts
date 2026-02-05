import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { detectTeam } from '../validators';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';

/**
 * Handles processing of standup meetings
 */
export class StandupMeetingHandler {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private transcriptDetector: TranscriptDetector;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.transcriptDetector = new TranscriptDetector();
	}

	/**
	 * Process a standup meeting file
	 */
	async process(file: TFile): Promise<void> {
		console.log('Processing standup meeting:', file.basename);

		const team = detectTeam(file);
		if (!team) {
			throw new Error('Could not determine team from filename');
		}

		const boardId = team === 'green' ? this.settings.greenBoardId : this.settings.magentaBoardId;
		console.log(`Detected ${team} team standup (board ${boardId})`);

		// Read content to determine mode
		const content = await this.app.vault.read(file);
		const mode = this.detectMode(content);

		if (mode === 'pre-meeting') {
			await this.processPreMeeting(file, boardId);
		} else {
			await this.processPostMeeting(file, boardId);
		}

		console.log('Standup meeting processing complete');
	}

	/**
	 * Detect if this is pre-meeting or post-meeting processing
	 */
	private detectMode(content: string): 'pre-meeting' | 'post-meeting' {
		// If there's a transcript section with content, it's post-meeting
		const transcriptMatch = content.match(/## Transcript\s*\n([\s\S]*?)(?=\n##|$)/);
		if (transcriptMatch) {
			const transcriptContent = transcriptMatch[1].trim();
			if (transcriptContent.length > 50) {
				return 'post-meeting';
			}
		}

		return 'pre-meeting';
	}

	/**
	 * Pre-meeting: Populate JIRA section and expected attendees
	 */
	private async processPreMeeting(file: TFile, boardId: string): Promise<void> {
		console.log('Pre-meeting mode: populating JIRA section...');

		// TODO: Query active sprint issues via Atlassian MCP
		// TODO: Group by assignee
		// TODO: Format with checkboxes, icons, status, links
		// TODO: Populate expected attendees from recent standups

		// For now, placeholder
		console.log(`Would query JIRA board ${boardId}`);
	}

	/**
	 * Post-meeting: Process attendees, transcript, and summary
	 */
	private async processPostMeeting(file: TFile, boardId: string): Promise<void> {
		console.log('Post-meeting mode: processing transcript and summary...');

		const content = await this.app.vault.read(file);

		// 1. Process attendees (screenshot or expected list)
		await this.processAttendees(file, content);

		// 2. Clean transcript (if no Copilot Summary)
		const hasCopilotSummary = this.hasCopilotSummary(content);
		if (!hasCopilotSummary) {
			await this.cleanTranscript(file);
		}

		// 3. Generate summary
		await this.generateSummary(file);

		// 4. Extract JIRA updates mentioned in meeting
		await this.extractJiraUpdates(file, content);
	}

	private hasCopilotSummary(content: string): boolean {
		const summaryMatch = content.match(/## Copilot Summary\s*\n([\s\S]*?)(?=\n##|$)/);
		if (!summaryMatch) return false;
		const summaryContent = summaryMatch[1].trim();
		return summaryContent.length > 0;
	}

	private async processAttendees(file: TFile, content: string): Promise<void> {
		console.log('Processing standup attendees...');
		// TODO: Similar to general meeting attendee processing
	}

	private async cleanTranscript(file: TFile): Promise<void> {
		console.log('Cleaning standup transcript...');
		
		const content = await this.app.vault.read(file);
		
		// Extract transcript section
		const transcriptMatch = content.match(/## Transcript\s*\n([\s\S]*?)(?=\n##|$)/);
		if (!transcriptMatch) {
			console.log('No transcript section found');
			return;
		}

		const transcriptContent = transcriptMatch[1].trim();
		if (!transcriptContent || transcriptContent.length < 10) {
			console.log('Transcript section is empty or too short');
			return;
		}

		// Detect format and clean
		const result = this.transcriptDetector.detectAndClean(transcriptContent);
		console.log(`Cleaned transcript using: ${result.cleaner}`);

		// Replace transcript section
		const newContent = content.replace(
			/## Transcript\s*\n[\s\S]*?(?=\n##|$)/,
			`## Transcript\n\n${result.cleaned}\n\n`
		);

		await this.app.vault.modify(file, newContent);
		console.log('Transcript cleaned and saved');
	}

	private async generateSummary(file: TFile): Promise<void> {
		console.log('Generating standup summary...');
		// TODO: Generate summary via Copilot
	}

	private async extractJiraUpdates(file: TFile, content: string): Promise<void> {
		console.log('Extracting JIRA updates...');
		// TODO: Find JIRA key mentions in content
		// TODO: Add update comments to JIRA items
	}
}
