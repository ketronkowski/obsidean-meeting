import { TranscriptCleaner } from './types';
import { TeamsDirectPasteCleaner } from './cleaner-teams';
import { TeamsDownloadedCleaner } from './cleaner-downloaded';
import { TeamsDocxCleaner } from './cleaner-docx';
import { SimpleTranscriptCleaner } from './cleaner-simple';

/**
 * Detects transcript format and selects appropriate cleaner
 */
export class TranscriptDetector {
	private cleaners: TranscriptCleaner[];

	constructor() {
		// Order matters! Check more specific formats first
		// SimpleTranscriptCleaner should be last as it's the fallback
		this.cleaners = [
			new TeamsDirectPasteCleaner(),
			new TeamsDownloadedCleaner(),
			new TeamsDocxCleaner(),
			new SimpleTranscriptCleaner()
		];
	}

	/**
	 * Detect the format of a transcript and return the appropriate cleaner
	 */
	detect(content: string): TranscriptCleaner {
		for (const cleaner of this.cleaners) {
			if (cleaner.canHandle(content)) {
				console.log(`Detected transcript format: ${cleaner.getName()}`);
				return cleaner;
			}
		}

		// Should never reach here since SimpleTranscriptCleaner always returns true
		// But return it as ultimate fallback
		return this.cleaners[this.cleaners.length - 1];
	}

	/**
	 * Detect format and clean transcript in one call
	 */
	detectAndClean(content: string): { cleaner: string; cleaned: string } {
		const cleaner = this.detect(content);
		const cleaned = cleaner.clean(content);
		
		return {
			cleaner: cleaner.getName(),
			cleaned
		};
	}

	/**
	 * Get all available cleaners
	 */
	getAvailableCleaners(): TranscriptCleaner[] {
		return [...this.cleaners];
	}
}
