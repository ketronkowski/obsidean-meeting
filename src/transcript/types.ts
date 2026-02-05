/**
 * Interface for transcript cleaners
 */
export interface TranscriptCleaner {
	/**
	 * Clean the transcript content
	 */
	clean(content: string): string;

	/**
	 * Check if this cleaner can handle the given content
	 */
	canHandle(content: string): boolean;

	/**
	 * Get the name of this cleaner
	 */
	getName(): string;
}

/**
 * Cleaned speaker entry
 */
export interface SpeakerEntry {
	speaker: string;
	content: string;
}
