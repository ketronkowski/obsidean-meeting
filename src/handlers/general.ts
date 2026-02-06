import { App, TFile } from 'obsidian';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { CopilotClientManager } from '../copilot-client';
import { SkillLoader } from '../skill-loader';
import { TranscriptDetector } from '../transcript';
import { PeopleManager } from '../people-manager';
import { StatusBarManager } from '../ui/status-bar';

/**
 * Handles processing of general (non-standup) meetings
 */
export class GeneralMeetingHandler {
	private app: App;
	private settings: MeetingProcessorSettings;
	private copilotClient: CopilotClientManager;
	private skillLoader: SkillLoader;
	private transcriptDetector: TranscriptDetector;
	private peopleManager: PeopleManager;
	private statusBar: StatusBarManager;

	constructor(app: App, settings: MeetingProcessorSettings, copilotClient: CopilotClientManager, skillLoader: SkillLoader, statusBar: StatusBarManager) {
		this.app = app;
		this.settings = settings;
		this.copilotClient = copilotClient;
		this.skillLoader = skillLoader;
		this.transcriptDetector = new TranscriptDetector();
		this.peopleManager = new PeopleManager(app);
		this.statusBar = statusBar;
	}

	/**
	 * Process a general meeting file
	 */
	async process(file: TFile): Promise<void> {
		console.log('Processing general meeting:', file.basename);

		try {
			// Read the meeting content
			const content = await this.app.vault.read(file);

			// Check if already has Copilot Summary (skip transcript cleaning if so)
			const hasCopilotSummary = this.hasCopilotSummary(content);

			// 1. Extract/populate attendees
			this.statusBar.show('Extracting attendees...', 0);
			await this.processAttendees(file, content);

			// 2. Clean transcript (if enabled, no Copilot Summary, and setting enabled)
			if (!hasCopilotSummary && this.settings.autoCleanTranscript) {
				this.statusBar.show('Cleaning transcript...', 0);
				await this.cleanTranscript(file);
			}

			// 3. Generate summary
			this.statusBar.show('Generating summary...', 0);
			await this.generateSummary(file);

			this.statusBar.show('Complete!', 2000);
			console.log('General meeting processing complete');
		} catch (error) {
			this.statusBar.show('Error processing meeting', 3000);
			throw error;
		}
	}

	/**
	 * Check if meeting has a Copilot Summary section with content
	 */
	private hasCopilotSummary(content: string): boolean {
		const summaryMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n#|$)/);
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
				// Get the image file from the vault
				const imagePath = this.app.metadataCache.getFirstLinkpathDest(screenshot, file.path);
				if (!imagePath) {
					console.warn(`Screenshot not found: ${screenshot}`);
					continue;
				}

				console.log(`Processing screenshot: ${screenshot}`);
				
				// Get the full filesystem path to the image
				const adapter = this.app.vault.adapter;
				const fullPath = (adapter as any).getFullPath(imagePath.path);
				console.log('Full image path:', fullPath);

				const prompt = `Extract all participant names from this Microsoft Teams meeting screenshot. Output ONLY a comma-separated list of full names like: "First Last, First Last". No other text or explanation.`;

				// Use CLI directly for vision analysis
				console.log('Using Copilot CLI directly for vision analysis...');
				const response = await this.copilotClient.analyzeImageWithCLI(fullPath, prompt);
				console.log('Vision response:', response);
				
				// Check if vision actually worked
				if (response.includes("don't see") || response.includes("cannot see") || 
				    response.includes("no image") || response.includes("Please provide") ||
				    response.includes("error") || response.length === 0) {
					console.warn('Vision analysis failed, will fall back to content extraction');
					visionFailed = true;
					break;
				}
				
				// Parse the response - extract just the names part if there's extra text
				let namesList = response.trim();
				
				// If response contains multiple lines, try to find the line with names
				if (namesList.includes('\n')) {
					const lines = namesList.split('\n').map(l => l.trim()).filter(l => l.length > 0);
					// Look for a line that looks like comma-separated names
					const namesLine = lines.find(l => l.includes(',') && !l.includes(':') && l.split(',').length > 1);
					if (namesLine) {
						namesList = namesLine;
					}
				}
				
				// Parse the names
				if (namesList && namesList !== 'NO_NAMES_FOUND') {
					const names = namesList.split(',').map(n => n.trim()).filter(n => 
						n.length > 0 && 
						n.length < 100 &&
						!/don't|cannot|please/i.test(n)  // Filter out error messages
					);
					names.forEach(name => allNames.add(name));
					console.log(`Extracted ${names.length} names from ${screenshot}:`, names);
				}
				
			} catch (error) {
				console.error(`Error processing screenshot ${screenshot}:`, error);
				visionFailed = true;
			}
		}
		
		// If vision failed, try content extraction as fallback
		if (visionFailed || allNames.size === 0) {
			console.log('Vision extraction failed or returned no names, falling back to content extraction');
			return [];  // Return empty so caller can try content extraction
		}
		
		return Array.from(allNames);
	}

	/**
	 * Extract attendees from meeting content (fallback method)
	 */
	private async extractFromContent(content: string): Promise<string[]> {
		console.log('Extracting attendees from content (fallback - limited capability)...');
		
		// Look for speaker patterns in transcript: [Speaker Name] or **Speaker Name:**
		const speakers = new Set<string>();
		const jiraKeyPattern = /^[A-Z]+-\d+$/; // Match JIRA keys like GLCP-12345
		const speakerNumberPattern = /^Speaker \d+$/; // Match "Speaker 1", "Speaker 2", etc.
		
		// Pattern 1: [Speaker Name] format (but not image references or JIRA keys)
		const bracketPattern = /\[([^\]]+)\]/g;
		let match;
		
		while ((match = bracketPattern.exec(content)) !== null) {
			const speaker = match[1].trim();
			// Skip image references, JIRA keys, and other non-names
			if (!speaker.includes('.png') &&          // Skip image filenames
			    !speaker.includes('.jpg') &&          // Skip image filenames
			    speaker.length > 3 &&                 // Reasonable name length
			    speaker.length < 50 &&                // Not too long
			    /[a-zA-Z]/.test(speaker) &&           // Contains letters
			    !jiraKeyPattern.test(speaker) &&      // Not a JIRA key
			    speaker !== 'Learn more') {           // Not "Learn more" link
				speakers.add(speaker);
			}
		}
		
		// Pattern 2: **Name:** format (common in some transcripts)
		const boldPattern = /\*\*([^*:]+):\*\*/g;
		while ((match = boldPattern.exec(content)) !== null) {
			const speaker = match[1].trim();
			if (speaker.length > 3 && 
			    speaker.length < 50 && 
			    !speakerNumberPattern.test(speaker) &&
			    !jiraKeyPattern.test(speaker)) {
				speakers.add(speaker);
			}
		}
		
		console.log(`Found ${speakers.size} potential speakers in content:`, Array.from(speakers));
		
		// If we only found generic speakers, warn the user
		const allGeneric = Array.from(speakers).every(s => /^Speaker \d+$/i.test(s));
		if (allGeneric && speakers.size > 0) {
			console.warn('Only generic speaker labels found (Speaker 1, Speaker 2, etc.). Vision API would provide real names from screenshots.');
		}
		
		return Array.from(speakers);
	}

	/**
	 * Update the Attendees section with extracted names
	 * Creates People profiles and generates links
	 */
	private async updateAttendeesSection(file: TFile, names: string[]): Promise<void> {
		console.log('Updating Attendees section...');
		
		const content = await this.app.vault.read(file);
		
		// Get or create profiles for each attendee (respecting setting)
		const profiles = await Promise.all(
			names.map(async name => {
				if (this.settings.autoCreateProfiles) {
					return await this.peopleManager.getOrCreateProfile(name);
				} else {
					// Just find existing profiles, don't create
					return await this.peopleManager.findProfile(name);
				}
			})
		);
		
		// Build the attendees list with links
		const attendeesList = profiles.map(profile => {
			if (profile.exists) {
				const link = this.peopleManager.generateLink(profile);
				return `- ${link}`;
			} else {
				// No profile and auto-create disabled, just use plain name
				return `- ${profile.displayName}`;
			}
		}).join('\n');
		
		const attendeesContent = `\n## In Meeting (${names.length})\n${attendeesList}\n`;
		
		// Find and update the Attendees section
		const attendeesRegex = /# Attendees\s*\n([\s\S]*?)(?=\n+#\s)/;
		let newContent: string;
		
		if (attendeesRegex.test(content)) {
			// Replace existing content
			newContent = content.replace(attendeesRegex, `# Attendees${attendeesContent}\n`);
		} else {
			// Couldn't find section (shouldn't happen)
			console.warn('Attendees section not found in file');
			return;
		}
		
		await this.app.vault.modify(file, newContent);
		console.log('Attendees section updated');
	}

	/**
	 * Convert ArrayBuffer to base64 string
	 */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		let binary = '';
		const bytes = new Uint8Array(buffer);
		const len = bytes.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		return btoa(binary);
	}

	/**
	 * Clean transcript based on detected format
	 */
	private async cleanTranscript(file: TFile): Promise<void> {
		console.log('Cleaning transcript...');
		
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
		console.log('Generating general meeting summary...');
		
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
			// Build prompt with skill instructions
			const prompt = `You are a meeting summarization assistant. Analyze the following meeting content and generate a structured summary.

${summarySkill.sections.get('Analysis Points') || ''}

${summarySkill.sections.get('Output Format') || ''}

${summarySkill.sections.get('Style Guidelines') || ''}

Meeting content to summarize:

${contentToSummarize}`;

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
			console.log('General meeting summary generated and saved');
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
			const prompt = `You are analyzing a general meeting transcript. Generate a comprehensive summary with:
- **Key Points**: Main topics discussed
- **Decisions**: Decisions made during the meeting
- **Action Items**: Tasks assigned with owners
- **Follow-up**: Items requiring follow-up

Keep the summary clear, organized, and actionable.

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
		console.log('Copilot Summary length:', copilotSummary.length);
		console.log('Copilot Summary preview:', copilotSummary.substring(0, 200));

		// Check if Copilot Summary is just a disclaimer (no actual content)
		const lowerCopilot = copilotSummary.toLowerCase();
		const isDisclaimer = copilotSummary.length < 150 || 
		                     lowerCopilot.includes('disclaimer') ||
		                     lowerCopilot.includes('ai-generated') ||
		                     lowerCopilot.includes('generated by ai') ||
		                     lowerCopilot.includes('may be incorrect') ||
		                     lowerCopilot.includes('may not be accurate') ||
		                     lowerCopilot.includes('learn more');
		
		if (isDisclaimer) {
			console.log('Copilot Summary appears to be just a disclaimer, using transcript summary only');
			return transcriptSummary; // Just return the transcript summary
		}

		try {
			const prompt = `You are creating a unified summary for a meeting by combining two sources:

1. **Teams Copilot Summary** (from Microsoft Teams AI):
${copilotSummary}

2. **Transcript Summary** (from meeting transcript):
${transcriptSummary}

Create a single, cohesive summary that:
- Merges duplicate information (don't repeat the same point twice)
- Preserves all unique insights from both sources
- Maintains structured format: Key Points, Decisions, Action Items, Follow-up
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
}
