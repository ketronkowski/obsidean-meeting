import { TranscriptCleaner, SpeakerEntry } from './types';

/**
 * Format 1: Direct Teams Paste
 * 
 * Characteristics:
 * - Speaker name on its own line
 * - Timestamp on next line with profile URL
 * - Format: "HH:MM:SS AM/PM → https://teams.microsoft.com/..."
 * 
 * Example:
 * John Smith
 * 10:30:45 AM → https://teams.microsoft.com/l/message/...
 * Hello everyone
 * 
 * Jane Doe
 * 10:31:20 AM → https://teams.microsoft.com/l/message/...
 * Hi John!
 */
export class TeamsDirectPasteCleaner implements TranscriptCleaner {
	
	getName(): string {
		return 'Teams Direct Paste (Format 1)';
	}

	canHandle(content: string): boolean {
		// Check for Teams URL pattern with arrow
		const teamsUrlPattern = /→\s*https:\/\/teams\.microsoft\.com/;
		// Check for timestamp format with AM/PM
		const timestampPattern = /\d{1,2}:\d{2}:\d{2}\s+[AP]M/;
		
		return teamsUrlPattern.test(content) && timestampPattern.test(content);
	}

	clean(content: string): string {
		const lines = content.split('\n');
		const entries: SpeakerEntry[] = [];
		
		let currentSpeaker = '';
		let currentContent: string[] = [];
		let skipNextLine = false;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i].trim();
			
			// Skip empty lines
			if (!line) {
				continue;
			}

			// Skip if this is a timestamp line (should skip)
			if (skipNextLine) {
				skipNextLine = false;
				continue;
			}

			// Check if this is a timestamp line with Teams URL
			if (this.isTimestampLine(line)) {
				continue;
			}

			// Check if next line is a timestamp (speaker detection)
			const nextLine = i + 1 < lines.length ? lines[i + 1].trim() : '';
			if (this.isTimestampLine(nextLine)) {
				// Save previous speaker's content
				if (currentSpeaker && currentContent.length > 0) {
					entries.push({
						speaker: currentSpeaker,
						content: currentContent.join('\n').trim()
					});
				}

				// Start new speaker
				currentSpeaker = line;
				currentContent = [];
				skipNextLine = true;
				continue;
			}

			// This is content for the current speaker
			if (currentSpeaker) {
				currentContent.push(line);
			}
		}

		// Save last speaker's content
		if (currentSpeaker && currentContent.length > 0) {
			entries.push({
				speaker: currentSpeaker,
				content: currentContent.join('\n').trim()
			});
		}

		return this.formatEntries(entries);
	}

	private isTimestampLine(line: string): boolean {
		// Matches: "10:30:45 AM → https://teams.microsoft.com/..."
		const pattern = /^\d{1,2}:\d{2}:\d{2}\s+[AP]M\s*→\s*https:\/\/teams\.microsoft\.com/;
		return pattern.test(line);
	}

	private formatEntries(entries: SpeakerEntry[]): string {
		const formatted: string[] = [];

		for (const entry of entries) {
			formatted.push(entry.speaker);
			formatted.push(entry.content);
			formatted.push(''); // Blank line between speakers
		}

		// Remove trailing blank line
		while (formatted.length > 0 && formatted[formatted.length - 1] === '') {
			formatted.pop();
		}

		return formatted.join('\n');
	}
}
