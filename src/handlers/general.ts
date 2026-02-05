import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';

/**
 * Handles processing of general (non-standup) meetings
 */
export class GeneralMeetingHandler {
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
	 * Process a general meeting file
	 */
	async process(file: TFile): Promise<void> {
		console.log('Processing general meeting:', file.basename);

		// Read the meeting content
		const content = await this.app.vault.read(file);

		// Check if already has Copilot Summary (skip transcript cleaning if so)
		const hasCopilotSummary = this.hasCopilotSummary(content);

		// 1. Extract/populate attendees
		await this.processAttendees(file, content);

		// 2. Clean transcript (if no Copilot Summary)
		if (!hasCopilotSummary) {
			await this.cleanTranscript(file);
		}

		// 3. Generate summary
		await this.generateSummary(file);

		console.log('General meeting processing complete');
	}

	/**
	 * Check if meeting has a Copilot Summary section with content
	 */
	private hasCopilotSummary(content: string): boolean {
		const summaryMatch = content.match(/## Copilot Summary\s*\n([\s\S]*?)(?=\n##|$)/);
		if (!summaryMatch) return false;
		
		const summaryContent = summaryMatch[1].trim();
		return summaryContent.length > 0;
	}

	/**
	 * Extract attendees from screenshots or content
	 */
	private async processAttendees(file: TFile, content: string): Promise<void> {
		console.log('Processing attendees...');
		
		// Check for screenshot references
		const screenshotPattern = /!\[\[SCR-.*?\.png\]\]/g;
		const screenshots = content.match(screenshotPattern);

		if (screenshots && screenshots.length > 0) {
			// TODO: Use Copilot vision to extract names from screenshots
			console.log('Found screenshots for attendee extraction:', screenshots);
		} else {
			// TODO: Extract names from meeting content
			console.log('No screenshots found, will extract from content');
		}

		// TODO: Create missing People profiles
		// TODO: Update Attendees section
	}

	/**
	 * Clean transcript based on detected format
	 */
	private async cleanTranscript(file: TFile): Promise<void> {
		console.log('Cleaning transcript...');
		
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

	/**
	 * Generate meeting summary using Copilot
	 */
	private async generateSummary(file: TFile): Promise<void> {
		console.log('Generating summary...');
		
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
			console.log('Using Copilot Summary for analysis');
		} else {
			// Use transcript
			const transcriptMatch = content.match(/## Transcript\s*\n([\s\S]*?)(?=\n##|$)/);
			if (transcriptMatch && transcriptMatch[1].trim()) {
				contentToSummarize = transcriptMatch[1].trim();
				console.log('Using transcript for analysis');
			}
		}

		if (!contentToSummarize || contentToSummarize.length < 20) {
			console.log('No content available for summary generation');
			return;
		}

		try {
			// Build prompt with skill instructions
			const prompt = `${summarySkill.purpose}

${summarySkill.sections.get('Analysis Points') || ''}
${summarySkill.sections.get('Output Format') || ''}
${summarySkill.sections.get('Style Guidelines') || ''}

Meeting content to summarize:

${contentToSummarize}

Please generate a comprehensive summary following the format specified above.`;

			// Get summary from Copilot
			const summary = await this.copilotClient.sendPrompt(prompt);
			
			// Update Summary section
			const summaryRegex = /## Summary\s*\n[\s\S]*?(?=\n##|$)/;
			let newContent: string;
			
			if (summaryRegex.test(content)) {
				// Replace existing summary
				newContent = content.replace(summaryRegex, `## Summary\n\n${summary}\n\n`);
			} else {
				// Add summary section before last heading or at end
				newContent = content + `\n\n## Summary\n\n${summary}\n`;
			}

			await this.app.vault.modify(file, newContent);
			console.log('Summary generated and saved');
		} catch (error) {
			console.error('Error generating summary:', error);
			throw error;
		}
	}
}
