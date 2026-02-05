import { TranscriptCleaner, SpeakerEntry } from './types';

/**
 * Format 4: Simple/Generic
 * 
 * Characteristics:
 * - Minimal formatting
 * - Various timestamp patterns
 * - Fallback cleaner for unrecognized formats
 * 
 * Handles various patterns:
 * - Speaker: content
 * - Speaker - content
 * - [HH:MM] Speaker: content
 * - Speaker (HH:MM): content
 */
export class SimpleTranscriptCleaner implements TranscriptCleaner {
	
	getName(): string {
		return 'Simple/Generic (Format 4)';
	}

	canHandle(content: string): boolean {
		// This is the fallback cleaner - always returns true
		// Should be checked last in the detector
		return true;
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

			// Try to extract speaker from this line
			const extracted = this.extractSpeakerAndContent(trimmed);
			
			if (extracted) {
				// Found a new speaker
				if (currentSpeaker && currentContent.length > 0) {
					entries.push({
						speaker: currentSpeaker,
						content: currentContent.join('\n').trim()
					});
				}

				currentSpeaker = extracted.speaker;
				currentContent = extracted.content ? [extracted.content] : [];
			} else {
				// This is content for the current speaker
				if (currentSpeaker) {
					currentContent.push(trimmed);
				}
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

	private extractSpeakerAndContent(line: string): { speaker: string; content?: string } | null {
		// Remove common timestamp patterns first
		let cleaned = this.removeTimestamps(line);
		
		// Pattern 1: "Speaker: content"
		let match = cleaned.match(/^([A-Z][a-zA-Z\s'-]+?):\s*(.*)$/);
		if (match) {
			return {
				speaker: match[1].trim(),
				content: match[2].trim() || undefined
			};
		}

		// Pattern 2: "Speaker - content"
		match = cleaned.match(/^([A-Z][a-zA-Z\s'-]+?)\s*-\s*(.*)$/);
		if (match && match[2]) {
			return {
				speaker: match[1].trim(),
				content: match[2].trim() || undefined
			};
		}

		// Pattern 3: Just a name on its own line (proper case)
		// Must start with capital, contain at least one space
		if (/^[A-Z][a-z]+\s+[A-Z][a-z]/.test(cleaned)) {
			return {
				speaker: cleaned.trim()
			};
		}

		return null;
	}

	private removeTimestamps(line: string): string {
		// Remove [HH:MM] or [HH:MM:SS]
		line = line.replace(/\[\d{1,2}:\d{2}(:\d{2})?\]/g, '');
		
		// Remove (HH:MM) or (HH:MM:SS)
		line = line.replace(/\(\d{1,2}:\d{2}(:\d{2})?\)/g, '');
		
		// Remove HH:MM AM/PM
		line = line.replace(/\d{1,2}:\d{2}\s*[AP]M/gi, '');
		
		// Remove standalone HH:MM or HH:MM:SS at start of line
		line = line.replace(/^\d{1,2}:\d{2}(:\d{2})?\s+/, '');
		
		return line.trim();
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
