import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { detectTeam } from '../validators';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';
import { StatusBarManager } from '../ui/status-bar';
import { JiraManager } from '../jira/manager';
import { PeopleManager } from '../people-manager';
import { JiraKeyExtractor } from '../jira/extractor';

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
	private peopleManager: PeopleManager;
	private jiraExtractor: JiraKeyExtractor;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader, statusBar: StatusBarManager) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.transcriptDetector = new TranscriptDetector();
		this.statusBar = statusBar;
		this.jiraManager = new JiraManager(copilotClient, settings);
		this.peopleManager = new PeopleManager(app);
		this.jiraExtractor = new JiraKeyExtractor();
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
				await this.processPreMeeting(file, boardId, team);
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
		const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
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
	private async processPreMeeting(file: TFile, boardId: string, teamName: string): Promise<void> {
		console.log('Pre-meeting mode: populating JIRA section...');
		this.statusBar.show('Querying JIRA...', 0);

		try {
			// Query and format JIRA issues (pass team name to help find correct sprint)
			const jiraSection = await this.jiraManager.queryAndFormatSprint(
				boardId,
				this.settings.jiraProjectKey,
				teamName
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

		// Check if JIRA section already exists (level 1 heading: # JIRA)
		const jiraRegex = /# JIRA\s*\n[\s\S]*?(?=\n#|$)/;
		let newContent: string;

		if (jiraRegex.test(content)) {
			// Replace existing section
			newContent = content.replace(jiraRegex, jiraSection.trim() + '\n');
			console.log('Replaced existing JIRA section');
		} else {
			// Insert after Attendees section if it exists
			const attendeesRegex = /# Attendees\s*\n[\s\S]*?(?=\n#|$)/;
			if (attendeesRegex.test(content)) {
				newContent = content.replace(
					attendeesRegex,
					(match) => match + '\n' + jiraSection + '\n'
				);
				console.log('Inserted JIRA section after Attendees');
			} else {
				// Insert at the beginning after frontmatter
				const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
				if (frontmatterRegex.test(content)) {
					newContent = content.replace(
						frontmatterRegex,
						(match) => match + '\n' + jiraSection + '\n'
					);
					console.log('Inserted JIRA section after frontmatter');
				} else {
					// No frontmatter, insert at top
					newContent = jiraSection + '\n\n' + content;
					console.log('Inserted JIRA section at top');
				}
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

		// 2. Clean transcript (if no Copilot Summary and setting enabled)
		const hasCopilotSummary = this.hasCopilotSummary(content);
		if (!hasCopilotSummary && this.settings.autoCleanTranscript) {
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
		const summaryMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (!summaryMatch) return false;
		const summaryContent = summaryMatch[1].trim();
		return summaryContent.length > 0;
	}

	private async processAttendees(file: TFile, content: string): Promise<void> {
		console.log('Processing standup attendees...');
		
		// Check for screenshot references
		const screenshotPattern = /!\[\[(SCR-[^\]]+\.png)\]\]/g;
		const screenshots: string[] = [];
		let match;
		
		while ((match = screenshotPattern.exec(content)) !== null) {
			screenshots.push(match[1]);
		}

		let extractedNames: string[] = [];

		// Try screenshots first if available
		if (screenshots.length > 0) {
			console.log(`Found ${screenshots.length} screenshots for attendee extraction`);
			extractedNames = await this.extractFromScreenshots(file, screenshots);
		}
		
		// Fall back to content extraction if screenshots didn't work
		if (extractedNames.length === 0) {
			console.log('Falling back to content extraction');
			extractedNames = await this.extractFromContent(content);
		}

		if (extractedNames.length > 0) {
			console.log(`Extracted ${extractedNames.length} attendees:`, extractedNames);
			await this.updateAttendeesSection(file, extractedNames);
		} else {
			console.log('No attendees extracted');
		}
	}

	/**
	 * Extract attendees from screenshot images using Copilot vision
	 */
	private async extractFromScreenshots(file: TFile, screenshots: string[]): Promise<string[]> {
		console.log('Extracting attendees from screenshots using vision...');
		
		const allNames: Set<string> = new Set();
		let visionFailed = false;
		
		for (const screenshot of screenshots) {
			try {
				const imagePath = this.app.metadataCache.getFirstLinkpathDest(screenshot, file.path);
				if (!imagePath) {
					console.warn(`Screenshot not found: ${screenshot}`);
					continue;
				}

				const adapter = this.app.vault.adapter;
				const fullPath = (adapter as any).getFullPath(imagePath.path);
				
				const prompt = `Extract all participant names from this Microsoft Teams meeting screenshot. Output ONLY a comma-separated list of full names like: "First Last, First Last". No other text or explanation.`;

				const response = await this.copilotClient.analyzeImageWithCLI(fullPath, prompt);
				console.log('Vision response:', response);
				
				if (response.includes("don't see") || response.includes("cannot see") || 
				    response.includes("no image") || response.includes("Please provide") ||
				    response.includes("error") || response.length === 0) {
					console.warn('Vision analysis failed');
					visionFailed = true;
					break;
				}
				
				let namesList = response.trim();
				if (namesList.includes('\n')) {
					const lines = namesList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
					const namesLine = lines.find(l => l.includes(',') && !l.includes(':') && l.split(',').length > 1);
					if (namesLine) {
						namesList = namesLine;
					}
				}
				
				if (namesList && namesList !== 'NO_NAMES_FOUND') {
					const names = namesList.split(',').map(n => n.trim()).filter(n => 
						n.length > 0 && n.length < 100 && !/don't|cannot|please/i.test(n)
					);
					names.forEach(name => allNames.add(name));
					console.log(`Extracted ${names.length} names from ${screenshot}`);
				}
			} catch (error) {
				console.error(`Error processing screenshot ${screenshot}:`, error);
				visionFailed = true;
			}
		}
		
		if (visionFailed || allNames.size === 0) {
			return [];
		}
		
		return Array.from(allNames);
	}

	/**
	 * Extract attendees from meeting content (fallback method)
	 */
	private async extractFromContent(content: string): Promise<string[]> {
		console.log('Extracting attendees from content...');
		
		const names: Set<string> = new Set();
		const speakerPattern = /(?:\[([^\]]+)\]|^\*\*([^:*]+):\*\*)/gm;
		let match;
		
		while ((match = speakerPattern.exec(content)) !== null) {
			const name = (match[1] || match[2]).trim();
			if (name && name.length > 2 && name.length < 50) {
				names.add(name);
			}
		}
		
		return Array.from(names);
	}

	/**
	 * Update Attendees section with extracted names and links to People profiles
	 */
	private async updateAttendeesSection(file: TFile, names: string[]): Promise<void> {
		console.log('Updating Attendees section...');
		
		const attendeeLinks: string[] = [];
		
		for (const name of names) {
			if (this.settings.autoCreateProfiles) {
				const profile = await this.peopleManager.getOrCreateProfile(name);
				attendeeLinks.push(`- [[${profile.displayName}]]`);
			} else {
				// Just find existing, don't create
				const profile = await this.peopleManager.findProfile(name);
				if (profile.exists) {
					attendeeLinks.push(`- [[${profile.displayName}]]`);
				} else {
					attendeeLinks.push(`- ${name}`);
				}
			}
		}
		
		const content = await this.app.vault.read(file);
		const attendeesSection = `# Attendees\n\n${attendeeLinks.join('\n')}`;
		
		const attendeesRegex = /# Attendees\s*\n[\s\S]*?(?=\n#|$)/;
		let newContent: string;
		
		if (attendeesRegex.test(content)) {
			newContent = content.replace(attendeesRegex, attendeesSection + '\n');
		} else {
			const frontmatterRegex = /^---\s*\n[\s\S]*?\n---\s*\n/;
			if (frontmatterRegex.test(content)) {
				newContent = content.replace(frontmatterRegex, (match) => match + '\n' + attendeesSection + '\n');
			} else {
				newContent = attendeesSection + '\n\n' + content;
			}
		}
		
		await this.app.vault.modify(file, newContent);
		console.log('Attendees section updated');
	}

	private async cleanTranscript(file: TFile): Promise<void> {
		console.log('Cleaning standup transcript...');
		
		const content = await this.app.vault.read(file);
		
		// Extract transcript section
		const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
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
			/# Transcript\s*\n[\s\S]*?(?=\n#|$)/,
			`# Transcript\n\n${result.cleaned}\n\n`
		);

		await this.app.vault.modify(file, newContent);
		console.log('Transcript cleaned and saved');
	}

	/**
	 * Check if Unified Summary already exists with content
	 */
	private hasUnifiedSummary(content: string): boolean {
		const match = content.match(/# Unified Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		return match !== null && match[1].trim().length > 20;
	}

	/**
	 * Check if Transcript section exists with content
	 */
	private hasTranscript(content: string): boolean {
		const match = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
		return match !== null && match[1].trim().length > 20;
	}

	/**
	 * Main summary generation - routes to standard or enhanced workflow
	 */
	private async generateSummary(file: TFile): Promise<void> {
		console.log('Generating standup summary...');
		
		const content = await this.app.vault.read(file);
		
		// Skip if Unified Summary already exists
		if (this.hasUnifiedSummary(content)) {
			console.log('Unified Summary already exists, skipping generation');
			return;
		}

		// Check what sources we have
		const hasCopilotSummary = this.hasCopilotSummary(content);
		const hasTranscript = this.hasTranscript(content);

		// Route to appropriate workflow
		if (hasCopilotSummary && hasTranscript) {
			console.log('Both sources available - using enhanced workflow');
			await this.generateEnhancedSummary(file, content);
		} else {
			console.log('Single source available - using standard workflow');
			await this.generateStandardSummary(file, content);
		}
	}

	/**
	 * Standard summary workflow - single source (backward compatible)
	 */
	private async generateStandardSummary(file: TFile, content: string): Promise<void> {
		console.log('Generating standard summary...');
		
		// Get the summary generation skill
		const summarySkill = this.skillLoader.getSkill('summary-generation');
		if (!summarySkill) {
			console.warn('Summary generation skill not found');
			return;
		}

		// Extract transcript or Copilot Summary for analysis
		let contentToSummarize = '';
		
		// Check for Copilot Summary first
		const copilotSummaryMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (copilotSummaryMatch && copilotSummaryMatch[1].trim()) {
			contentToSummarize = copilotSummaryMatch[1].trim();
		} else {
			// Use transcript
			const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
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
			const summaryRegex = /# Summary\s*\n[\s\S]*?(?=\n#|$)/;
			let newContent: string;
			
			if (summaryRegex.test(content)) {
				newContent = content.replace(summaryRegex, `# Summary\n\n${summary}\n\n`);
			} else {
				newContent = content + `\n\n# Summary\n\n${summary}\n`;
			}

			await this.app.vault.modify(file, newContent);
			console.log('Standup summary generated and saved');
		} catch (error) {
			console.error('Error generating summary:', error);
			throw error;
		}
	}

	/**
	 * Enhanced summary workflow - generates from transcript and combines with Copilot Summary
	 */
	private async generateEnhancedSummary(file: TFile, content: string): Promise<void> {
		console.log('Generating enhanced summary with both sources...');
		
		try {
			// Step 1: Generate Transcript Summary
			this.statusBar.show('Generating transcript summary...', 0);
			const transcriptSummary = await this.generateTranscriptSummary(content);
			
			if (!transcriptSummary) {
				console.warn('Failed to generate transcript summary, falling back to standard');
				await this.generateStandardSummary(file, content);
				return;
			}

			// Step 2: Combine both summaries
			this.statusBar.show('Combining summaries...', 0);
			const unifiedSummary = await this.combineSummaries(content, transcriptSummary);
			
			if (!unifiedSummary) {
				console.warn('Failed to combine summaries, falling back to standard');
				await this.generateStandardSummary(file, content);
				return;
			}

			// Step 3: Update all sections
			await this.updateSummarySections(file, content, unifiedSummary, transcriptSummary);
			
			console.log('Enhanced summary generated successfully');
		} catch (error) {
			console.error('Error in enhanced summary generation:', error);
			console.log('Falling back to standard summary generation');
			await this.generateStandardSummary(file, content);
		}
	}

	/**
	 * Generate summary from transcript content
	 */
	private async generateTranscriptSummary(content: string): Promise<string | null> {
		console.log('Generating transcript summary...');
		
		// Extract transcript
		const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n#|$)/);
		if (!transcriptMatch || !transcriptMatch[1].trim()) {
			console.warn('No transcript content found');
			return null;
		}

		const transcriptContent = transcriptMatch[1].trim();

		try {
			const prompt = `You are analyzing a standup meeting transcript. Generate a concise summary focused on:
- What each person completed yesterday
- What each person is planning for today  
- Any blockers or issues mentioned
- Key decisions or action items

Format as clear bullet points organized by team member when possible.

Transcript:

${transcriptContent}`;

			const summary = await this.copilotClient.sendPrompt(prompt);
			return summary.trim();
		} catch (error) {
			console.error('Error generating transcript summary:', error);
			return null;
		}
	}

	/**
	 * Combine Copilot Summary and Transcript Summary intelligently
	 */
	private async combineSummaries(content: string, transcriptSummary: string): Promise<string | null> {
		console.log('Combining summaries...');
		
		// Extract Copilot Summary
		const copilotMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
		if (!copilotMatch || !copilotMatch[1].trim()) {
			console.warn('No Copilot Summary found');
			return null;
		}

		const copilotSummary = copilotMatch[1].trim();

		try {
			const prompt = `You are creating a unified summary for a standup meeting by combining two sources:

1. **Teams Copilot Summary** (from Microsoft Teams AI):
${copilotSummary}

2. **Transcript Summary** (from meeting transcript):
${transcriptSummary}

Create a single, cohesive summary that:
- Merges duplicate information (don't repeat the same point twice)
- Preserves all unique insights from both sources
- Maintains focus on: completed work, planned work, blockers
- Uses clear, organized bullet points
- Prioritizes accuracy and completeness

Generate the unified summary:`;

			const unified = await this.copilotClient.sendPrompt(prompt);
			return unified.trim();
		} catch (error) {
			console.error('Error combining summaries:', error);
			return null;
		}
	}

	/**
	 * Update file with all summary sections in correct order
	 */
	private async updateSummarySections(
		file: TFile, 
		content: string, 
		unifiedSummary: string, 
		transcriptSummary: string
	): Promise<void> {
		console.log('Updating summary sections...');
		
		let newContent = content;

		// Insert or update Transcript Summary (above Transcript)
		const transcriptSummarySection = `# Transcript Summary\n\n${transcriptSummary}\n\n`;
		const transcriptSummaryRegex = /# Transcript Summary\s*\n[\s\S]*?(?=\n#|$)/;
		
		if (transcriptSummaryRegex.test(newContent)) {
			// Update existing
			newContent = newContent.replace(transcriptSummaryRegex, transcriptSummarySection);
		} else {
			// Insert before Transcript
			const transcriptRegex = /(# Transcript\s*\n)/;
			if (transcriptRegex.test(newContent)) {
				newContent = newContent.replace(transcriptRegex, transcriptSummarySection + '$1');
			}
		}

		// Insert or update Unified Summary (above Copilot Summary)
		const unifiedSummarySection = `# Unified Summary\n\n${unifiedSummary}\n\n`;
		const unifiedSummaryRegex = /# Unified Summary\s*\n[\s\S]*?(?=\n#|$)/;
		
		if (unifiedSummaryRegex.test(newContent)) {
			// Update existing
			newContent = newContent.replace(unifiedSummaryRegex, unifiedSummarySection);
		} else {
			// Insert before Copilot Summary
			const copilotSummaryRegex = /(# Copilot Summary\s*\n)/;
			if (copilotSummaryRegex.test(newContent)) {
				newContent = newContent.replace(copilotSummaryRegex, unifiedSummarySection + '$1');
			}
		}

		await this.app.vault.modify(file, newContent);
		console.log('All summary sections updated');
	}

	private async extractJiraUpdates(file: TFile, content: string): Promise<void> {
		console.log('Extracting JIRA updates...');
		this.statusBar.show('Checking JIRA mentions...', 0);
		
		try {
			// Extract content to analyze
			const relevantContent = this.jiraExtractor.extractRelevantContent(content);
			
			if (!relevantContent || relevantContent.trim().length < 20) {
				console.log('No content to analyze for JIRA keys');
				return;
			}
			
			// Extract JIRA keys
			const matches = this.jiraExtractor.extractKeys(relevantContent);
			
			if (matches.length === 0) {
				console.log('No JIRA keys found in content');
				return;
			}
			
			// Get just the keys for checkbox updates
			const mentionedKeys = matches.map(m => m.key);
			console.log(`Found ${mentionedKeys.length} JIRA keys:`, mentionedKeys);
			
			// Update checkboxes in JIRA section
			const updatedContent = this.jiraExtractor.updateJiraSection(content, mentionedKeys);
			
			if (updatedContent !== content) {
				await this.app.vault.modify(file, updatedContent);
				console.log('JIRA section updated with checked items');
			} else {
				console.log('No JIRA items were checked (keys may not match items in JIRA section)');
			}
		} catch (error) {
			console.error('Error extracting JIRA updates:', error);
			// Don't throw - this is not critical
		}
	}
}
