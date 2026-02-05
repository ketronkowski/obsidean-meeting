import { TranscriptCleaner, SpeakerEntry } from './types';

/**
 * Format 3: .docx Exported
 * 
 * Characteristics:
 * - Plain text with leading spaces
 * - No special formatting
 * - Speaker and time may be on same line or separate
 * - Various spacing patterns
 * 
 * Example:
 *     John Smith 10:30 AM
 *     Hello everyone
 *     
 *     Jane Doe 10:31 AM
 *     Hi John!
 */
export class TeamsDocxCleaner implements TranscriptCleaner {
	
	getName(): string {
		return 'Teams .docx Export (Format 3)';
	}

	canHandle(content: string): boolean {
		// Check for timestamp pattern without special markers
		const timestampPattern = /\d{1,2}:\d{2}\s+[AP]M/;
		// Check for leading whitespace (common in docx exports)
		const leadingWhitespace = /^\s{2,}/m;
		
		// This format is harder to detect - look for timestamps and whitespace
		// but NOT the Teams URL or bold markers
		const hasTeamsUrl = /teams\.microsoft\.com/.test(content);
		const hasBoldMarker = /\*\*[^*]+\*\*/.test(content);
		
		return timestampPattern.test(content) && 
		       !hasTeamsUrl && 
		       !hasBoldMarker &&
		       leadingWhitespace.test(content);
	}

	clean(content: string): string {
		const lines = content.split('\n');
		const entries: SpeakerEntry[] = [];
		
		let currentSpeaker = '';
		let currentContent: string[] = [];

		for (const line of lines) {
			// Remove leading/trailing whitespace
			const trimmed = line.trim();
			
			// Skip empty lines
			if (!trimmed) {
				continue;
			}

			// Check if this line contains a speaker and timestamp
			const speakerInfo = this.extractSpeakerInfo(trimmed);
			if (speakerInfo) {
				// Save previous speaker's content
				if (currentSpeaker && currentContent.length > 0) {
					entries.push({
						speaker: currentSpeaker,
						content: currentContent.join('\n').trim()
					});
				}

				// Start new speaker
				currentSpeaker = speakerInfo.speaker;
				currentContent = [];
				
				// If there's content on the same line after the timestamp, include it
				if (speakerInfo.remainingContent) {
					currentContent.push(speakerInfo.remainingContent);
				}
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

	private extractSpeakerInfo(line: string): { speaker: string; remainingContent?: string } | null {
		// Match patterns like:
		// "John Smith 10:30 AM"
		// "John Smith 10:30 AM - Hello everyone"
		
		// Try to match name followed by timestamp
		const pattern = /^([A-Z][a-zA-Z\s'-]+?)\s+(\d{1,2}:\d{2}\s+[AP]M)(.*)$/;
		const match = line.match(pattern);
		
		if (match) {
			const speaker = match[1].trim();
			const remainingContent = match[3].trim();
			
			return {
				speaker,
				remainingContent: remainingContent || undefined
			};
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
