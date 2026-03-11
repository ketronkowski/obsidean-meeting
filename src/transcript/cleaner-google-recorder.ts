import { TranscriptCleaner, SpeakerEntry } from './types';

/**
 * Format 5: Google Recorder
 *
 * Characteristics:
 * - Speaker on its own line in brackets: [Speaker N] or [First Last]
 * - Content on following line(s)
 * - Blank line between speaker blocks
 *
 * Example:
 * [Speaker 1]
 * Hello everyone, let's get started.
 *
 * [Kevin Tronkowski]
 * Thanks for joining.
 */
export class GoogleRecorderCleaner implements TranscriptCleaner {

	getName(): string {
		return 'Google Recorder (Format 5)';
	}

	canHandle(content: string): boolean {
		// Match any [text] (not [[text]]) on its own line — Google Recorder's speaker format
		return /^\[[^\[\]]+\]\s*$/m.test(content);
	}

	clean(content: string): string {
		const lines = content.split('\n');
		const entries: SpeakerEntry[] = [];

		let currentSpeaker = '';
		let currentContent: string[] = [];
		let preamble: string[] = [];

		for (const line of lines) {
			const trimmed = line.trim();

			// Skip empty lines
			if (!trimmed) {
				continue;
			}

			// Check for [Any Name] or [Speaker N] on its own line (not [[wikilink]])
			const speakerMatch = trimmed.match(/^\[([^\[\]]+)\]$/);
			if (speakerMatch) {
				if (currentSpeaker && currentContent.length > 0) {
					entries.push({ speaker: currentSpeaker, content: currentContent.join(' ').trim() });
				}
				currentSpeaker = speakerMatch[1]; // e.g. "Speaker 1" or "Kevin Tronkowski"
				// Prepend any preamble to this first speaker
				currentContent = preamble.length > 0 ? [...preamble] : [];
				preamble = [];
				continue;
			}

			if (currentSpeaker) {
				currentContent.push(trimmed);
			} else {
				preamble.push(trimmed);
			}
		}

		// Save last entry
		if (currentSpeaker && currentContent.length > 0) {
			entries.push({ speaker: currentSpeaker, content: currentContent.join(' ').trim() });
		}

		return this.formatEntries(entries);
	}

	private formatEntries(entries: SpeakerEntry[]): string {
		// Consolidate consecutive same-speaker blocks
		const consolidated: SpeakerEntry[] = [];
		for (const entry of entries) {
			const last = consolidated[consolidated.length - 1];
			if (last && last.speaker === entry.speaker) {
				last.content += ' ' + entry.content;
			} else {
				consolidated.push({ speaker: entry.speaker, content: entry.content });
			}
		}

		// Preserve [Speaker] brackets so rewriteTranscript can replace Speaker N with real names
		return consolidated
			.map(e => `[${e.speaker}]\n${e.content}`)
			.join('\n\n');
	}
}
