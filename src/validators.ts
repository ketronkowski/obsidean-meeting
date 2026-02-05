import { TFile, App } from 'obsidian';
import { MeetingProcessorSettings } from './ui/settings-tab';

export interface ValidationResult {
	valid: boolean;
	error?: string;
}

/**
 * Validates that a file is a proper meeting file
 */
export async function validateMeetingFile(
	file: TFile,
	app: App,
	settings: MeetingProcessorSettings
): Promise<ValidationResult> {
	// Check file exists and is markdown
	if (!file || file.extension !== 'md') {
		return { valid: false, error: 'Not a markdown file' };
	}

	// Check file is in Meetings folder
	const meetingsFolder = settings.meetingsFolder.replace(/^\/|\/$/g, ''); // Remove leading/trailing slashes
	if (!file.path.startsWith(meetingsFolder + '/')) {
		return {
			valid: false,
			error: `File must be in the ${meetingsFolder} folder`
		};
	}

	// Check filename pattern: YYYY-MM-DD - *.md
	const filenamePattern = /^\d{4}-\d{2}-\d{2} - .+\.md$/;
	const filename = file.name;
	if (!filenamePattern.test(filename)) {
		return {
			valid: false,
			error: 'Filename must match pattern: YYYY-MM-DD - <name>.md'
		};
	}

	// Check frontmatter has meeting tag
	const content = await app.vault.read(file);
	const hasMeetingTag = content.includes('tags: [meeting]') || 
	                       content.includes('tags:\n  - meeting') ||
	                       content.includes('tags: meeting');
	
	if (!hasMeetingTag) {
		return {
			valid: false,
			error: 'File must have "meeting" tag in frontmatter'
		};
	}

	return { valid: true };
}

/**
 * Detects meeting type from filename
 */
export function detectMeetingType(file: TFile, settings: MeetingProcessorSettings): 'standup' | 'general' {
	const keywords = settings.standupKeywords.split(',').map(k => k.trim());
	const filename = file.basename; // Without extension
	
	for (const keyword of keywords) {
		if (filename.includes(keyword)) {
			return 'standup';
		}
	}
	
	return 'general';
}

/**
 * Detects team from standup filename
 */
export function detectTeam(file: TFile): 'green' | 'magenta' | null {
	const filename = file.basename.toLowerCase();
	
	if (filename.includes('green')) {
		return 'green';
	} else if (filename.includes('magenta')) {
		return 'magenta';
	}
	
	return null;
}
