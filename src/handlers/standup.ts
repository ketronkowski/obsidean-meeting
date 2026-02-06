import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { detectTeam } from '../validators';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';
import { StatusBarManager } from '../ui/status-bar';
import { JiraManager } from '../jira/manager';

/**
 * Handles processing of standup meetings
 */
export class StandupMeetingHandler {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private transcriptDetector: TranscriptDetector;
	private statusBar: StatusBarManager;
	private jiraManager: JiraManager;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader, statusBar: StatusBarManager) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.transcriptDetector = new TranscriptDetector();
		this.statusBar = statusBar;
		this.jiraManager = new JiraManager(copilotClient, settings);
	}

	/**
	 * Process a standup meeting file
	 */
	async process(file: TFile): Promise<void> {
		console.log('Processing standup meeting:', file.basename);

		try {
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

			this.statusBar.show('Complete!', 2000);
			console.log('Standup meeting processing complete');
		} catch (error) {
			this.statusBar.show('Error processing standup', 3000);
			throw error;
		}
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
		this.statusBar.show('Querying JIRA...', 0);

		try {
			// Query and format JIRA issues
			const jiraSection = await this.jiraManager.queryAndFormatSprint(
				boardId,
				this.settings.jiraProjectKey
			);

			// Insert into file
			await this.insertJiraSection(file, jiraSection);

			console.log('JIRA section populated successfully');
		} catch (error) {
			console.error('Error populating JIRA section:', error);
			throw error;
		}
	}

	/**
	 * Insert or update JIRA section in meeting file
	 */
	private async insertJiraSection(file: TFile, jiraSection: string): Promise<void> {
		const content = await this.app.vault.read(file);

		// Check if JIRA section already exists
		const jiraRegex = /## JIRA\s*\n[\s\S]*?(?=\n##|$)/;
		let newContent: string;

		if (jiraRegex.test(content)) {
			// Replace existing section
			newContent = content.replace(jiraRegex, jiraSection + '\n');
		} else {
			// Insert after Attendees section if it exists, otherwise at top
			const attendeesRegex = /## Attendees\s*\n[\s\S]*?(?=\n##|$)/;
			if (attendeesRegex.test(content)) {
				newContent = content.replace(
					attendeesRegex,
					(match) => match + '\n' + jiraSection + '\n'
				);
			} else {
				// Insert at the beginning
				newContent = jiraSection + '\n\n' + content;
			}
		}

		await this.app.vault.modify(file, newContent);
	}

	/**
	 * Post-meeting: Process attendees, transcript, and summary
	 */
	private async processPostMeeting(file: TFile, boardId: string): Promise<void> {
		console.log('Post-meeting mode: processing transcript and summary...');

		const content = await this.app.vault.read(file);

		// 1. Process attendees (screenshot or expected list)
		this.statusBar.show('Processing attendees...', 0);
		await this.processAttendees(file, content);

		// 2. Clean transcript (if no Copilot Summary)
		const hasCopilotSummary = this.hasCopilotSummary(content);
		if (!hasCopilotSummary) {
			this.statusBar.show('Cleaning transcript...', 0);
			await this.cleanTranscript(file);
		}

		// 3. Generate summary
		this.statusBar.show('Generating summary...', 0);
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
		
		const content = await this.app.vault.read(file);
		
		// Get the summary generation skill
		const summarySkill = this.skillLoader.getSkill('summary-generation');
		if (!summarySkill) {
			console.warn('Summary generation skill not found');
			return;
		}

		// Extract transcript or Copilot Summary for analysis
		let contentToSummarize = '';
		
		// Check for Copilot Summary first
		const copilotSummaryMatch = content.match(/## Copilot Summary\s*\n([\s\S]*?)(?=\n##|$)/);
		if (copilotSummaryMatch && copilotSummaryMatch[1].trim()) {
			contentToSummarize = copilotSummaryMatch[1].trim();
		} else {
			// Use transcript
			const transcriptMatch = content.match(/## Transcript\s*\n([\s\S]*?)(?=\n##|$)/);
			if (transcriptMatch && transcriptMatch[1].trim()) {
				contentToSummarize = transcriptMatch[1].trim();
			}
		}

		if (!contentToSummarize || contentToSummarize.length < 20) {
			console.log('No content available for summary generation');
			return;
		}

		try {
			// Build prompt with skill instructions and standup context
			const prompt = `This is a standup meeting. ${summarySkill.purpose}

${summarySkill.sections.get('Analysis Points') || ''}
${summarySkill.sections.get('Output Format') || ''}

Meeting content to summarize:

${contentToSummarize}

Please generate a summary focused on: what was completed yesterday, what's planned for today, and any blockers mentioned.`;

			// Get summary from Copilot
			const summary = await this.copilotClient.sendPrompt(prompt);
			
			// Update Summary section
			const summaryRegex = /## Summary\s*\n[\s\S]*?(?=\n##|$)/;
			let newContent: string;
			
			if (summaryRegex.test(content)) {
				newContent = content.replace(summaryRegex, `## Summary\n\n${summary}\n\n`);
			} else {
				newContent = content + `\n\n## Summary\n\n${summary}\n`;
			}

			await this.app.vault.modify(file, newContent);
			console.log('Standup summary generated and saved');
		} catch (error) {
			console.error('Error generating summary:', error);
			throw error;
		}
	}

	private async extractJiraUpdates(file: TFile, content: string): Promise<void> {
		console.log('Extracting JIRA updates...');
		// TODO: Find JIRA key mentions in content
		// TODO: Add update comments to JIRA items
	}
}
