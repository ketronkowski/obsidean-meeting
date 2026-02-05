import { TranscriptCleaner, SpeakerEntry } from './types';

/**
 * Format 2: Downloaded from Teams
 * 
 * Characteristics:
 * - Combined speaker and timestamp: "**Speaker Name** HH:MM AM"
 * - Bold formatting on speaker name (markdown or HTML)
 * - Speaker and time on same line
 * 
 * Example:
 * **John Smith** 10:30 AM
 * Hello everyone
 * 
 * **Jane Doe** 10:31 AM
 * Hi John!
 */
export class TeamsDownloadedCleaner implements TranscriptCleaner {
	
	getName(): string {
		return 'Teams Downloaded (Format 2)';
	}

	canHandle(content: string): boolean {
		// Check for bold speaker with timestamp pattern
		const pattern = /\*\*[^*]+\*\*\s+\d{1,2}:\d{2}\s+[AP]M/;
		return pattern.test(content);
	}

	clean(content: string): string {
		const lines = content.split('\n');
		const entries: SpeakerEntry[] = [];
		
		let currentSpeaker = '';
		let currentContent: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();
			
			// Skip empty lines
			if (!trimmed) {
				continue;
			}

			// Check if this is a speaker line
			const speakerMatch = this.extractSpeaker(trimmed);
			if (speakerMatch) {
				// Save previous speaker's content
				if (currentSpeaker && currentContent.length > 0) {
					entries.push({
						speaker: currentSpeaker,
						content: currentContent.join('\n').trim()
					});
				}

				// Start new speaker
				currentSpeaker = speakerMatch;
				currentContent = [];
				continue;
			}

			// This is content for the current speaker
			if (currentSpeaker) {
				currentContent.push(trimmed);
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

	private extractSpeaker(line: string): string | null {
		// Match: **Speaker Name** HH:MM AM/PM
		const pattern = /\*\*([^*]+)\*\*\s+\d{1,2}:\d{2}\s+[AP]M/;
		const match = line.match(pattern);
		
		if (match) {
			return match[1].trim();
		}

		// Also try HTML bold tags: <b>Speaker Name</b> HH:MM AM/PM
		const htmlPattern = /<b>([^<]+)<\/b>\s+\d{1,2}:\d{2}\s+[AP]M/;
		const htmlMatch = line.match(htmlPattern);
		
		if (htmlMatch) {
			return htmlMatch[1].trim();
		}

		return null;
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
