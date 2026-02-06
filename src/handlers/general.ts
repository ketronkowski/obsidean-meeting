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

			// 2. Clean transcript (if no Copilot Summary)
			if (!hasCopilotSummary) {
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
		
		// Pattern 1: [Speaker Name] format (but not image references)
		const bracketPattern = /\[([^\]]+)\]/g;
		let match;
		
		while ((match = bracketPattern.exec(content)) !== null) {
			const speaker = match[1].trim();
			// Skip image references but keep speaker labels
			if (!speaker.includes('.png') &&          // Skip image filenames
			    !speaker.includes('.jpg') &&          // Skip image filenames
			    speaker.length > 3 &&                 // Reasonable name length
			    speaker.length < 50 &&                // Not too long
			    /[a-zA-Z]/.test(speaker)) {           // Contains letters
				speakers.add(speaker);
			}
		}
		
		// Pattern 2: **Name:** format (common in some transcripts)
		const boldPattern = /\*\*([^*:]+):\*\*/g;
		while ((match = boldPattern.exec(content)) !== null) {
			const speaker = match[1].trim();
			if (speaker.length > 3 && speaker.length < 50) {
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
		
		// Get or create profiles for each attendee
		const profiles = await Promise.all(
			names.map(name => this.peopleManager.getOrCreateProfile(name))
		);
		
		// Build the attendees list with links
		const attendeesList = profiles.map(profile => {
			const link = this.peopleManager.generateLink(profile);
			return `- ${link}`;
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
		const copilotSummaryMatch = content.match(/# Copilot Summary\s*\n([\s\S]*?)(?=\n+#\s|$)/);
		console.log('Copilot Summary match found:', !!copilotSummaryMatch);
		if (copilotSummaryMatch) {
			console.log('Copilot Summary raw length:', copilotSummaryMatch[1]?.length || 0);
			console.log('Copilot Summary trimmed length:', copilotSummaryMatch[1]?.trim().length || 0);
		}
		
		if (copilotSummaryMatch && copilotSummaryMatch[1].trim().length > 50) {
			contentToSummarize = copilotSummaryMatch[1].trim();
			console.log('Using Copilot Summary for analysis, length:', contentToSummarize.length);
		} else {
			// Use transcript
			console.log('Copilot Summary empty or too short, trying Transcript...');
			const transcriptMatch = content.match(/# Transcript\s*\n([\s\S]*?)(?=\n+#\s|$)/);
			console.log('Transcript match found:', !!transcriptMatch);
			if (transcriptMatch) {
				console.log('Transcript raw length:', transcriptMatch[1]?.length || 0);
				console.log('Transcript trimmed length:', transcriptMatch[1]?.trim().length || 0);
			}
			
			if (transcriptMatch && transcriptMatch[1].trim()) {
				contentToSummarize = transcriptMatch[1].trim();
				console.log('Using transcript for analysis, length:', contentToSummarize.length);
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

${contentToSummarize}

CRITICAL INSTRUCTIONS:
- Output ONLY the summary content (Key Points, Decisions, Action Items, Follow-up)
- DO NOT include the "# Transcript Summary" heading
- DO NOT wrap in markdown code fences (no \`\`\`markdown)
- DO NOT include meta-commentary like "Here is the summary"
- Start directly with "**Key Points:**"`;

			// Get summary from Copilot
			console.log('Sending prompt to Copilot...');
			const summary = await this.copilotClient.sendPrompt(prompt);
			console.log('Received summary from Copilot, length:', summary.length);
			
			// Clean the summary response
			let cleanedSummary = summary.trim();
			
			// Strip markdown code fence if present
			if (cleanedSummary.startsWith('```markdown') || cleanedSummary.startsWith('```')) {
				cleanedSummary = cleanedSummary.replace(/^```markdown?\s*\n/, '').replace(/\n```\s*$/, '').trim();
				console.log('Stripped markdown code fence');
			}
			
			// Strip the heading if Copilot included it anyway
			cleanedSummary = cleanedSummary.replace(/^#\s+Transcript Summary\s*\n+/i, '').trim();
			
			console.log('Cleaned summary length:', cleanedSummary.length);
			
			// Re-read file to get absolutely latest content
			console.log('Re-reading file to ensure fresh content...');
			const freshContent = await this.app.vault.read(file);
			console.log('Fresh content length:', freshContent.length);
			
			// Show all section headings in the file
			const headings = freshContent.match(/^#[^#\n].*$/gm);
			console.log('Sections in file:', headings);
			
			// Update Transcript Summary section
			let newContent: string;
			
			// Regex that properly stops at the next # heading (with any amount of whitespace before it)
			const summaryRegex = /# Transcript Summary\s*\n([\s\S]*?)(?=\n+#\s)/;
			const existingSummaryMatch = freshContent.match(summaryRegex);
			
			if (existingSummaryMatch) {
				console.log('Found existing Transcript Summary section');
				console.log('Full match length:', existingSummaryMatch[0]?.length || 0);
				console.log('Content capture length:', existingSummaryMatch[1]?.length || 0);
				console.log('Content trimmed length:', existingSummaryMatch[1]?.trim().length || 0);
				console.log('First 100 chars of matched content:', existingSummaryMatch[1]?.substring(0, 100));
				
				// Replace only the content within the existing section
				newContent = freshContent.replace(summaryRegex, `# Transcript Summary\n\n${cleanedSummary}\n\n`);
				console.log('Replaced existing Transcript Summary section');
			} else {
				console.log('No Transcript Summary found - will insert new section');
				const copilotSummaryRegex = /(# Copilot Summary\s*\n[\s\S]*?)(\n+# )/;
				
				if (copilotSummaryRegex.test(freshContent)) {
					// Insert after Copilot Summary section
					newContent = freshContent.replace(
						copilotSummaryRegex,
						`$1\n\n# Transcript Summary\n\n${cleanedSummary}\n\n$2`
					);
					console.log('Inserted new Transcript Summary after Copilot Summary');
				} else {
					// Fallback: add at end if no Copilot Summary found
					console.log('No Copilot Summary found - adding Transcript Summary at end');
					newContent = freshContent + `\n\n# Transcript Summary\n\n${cleanedSummary}\n`;
				}
			}

			console.log('Old content length:', freshContent.length);
			console.log('New content length:', newContent.length);
			console.log('Content changed:', freshContent !== newContent);
			console.log('File path:', file.path);
			
			// Check if file is currently open in an editor
			const leaves = this.app.workspace.getLeavesOfType('markdown');
			const activeLeaf = leaves.find(leaf => {
				const view = leaf.view as any;
				return view.getViewType() === 'markdown' && view.file?.path === file.path;
			});
			
			if (activeLeaf) {
				console.log('File is open, using editor API...');
				const view = activeLeaf.view as any;
				const editor = view.editor;
				if (editor) {
					// Replace entire content using editor
					const lastLine = editor.lastLine();
					const lastLineLength = editor.getLine(lastLine).length;
					editor.replaceRange(
						newContent,
						{ line: 0, ch: 0 },
						{ line: lastLine, ch: lastLineLength }
					);
					console.log('Editor content updated');
				} else {
					console.warn('No editor found, falling back to vault.modify()');
					await this.app.vault.modify(file, newContent);
				}
			} else {
				console.log('File not open, using vault.modify()...');
				await this.app.vault.modify(file, newContent);
			}
			
			console.log('Summary generated and saved');
		} catch (error) {
			console.error('Error generating summary:', error);
			throw error;
		}
	}
}
