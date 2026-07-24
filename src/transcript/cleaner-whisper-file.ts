import { TranscriptCleaner, SpeakerEntry } from './types';

/**
 * MacWhisper metadata JSON format (from .whisper ZIP package)
 *
 * Characteristics:
 * - Top-level JSON object with a "transcripts" array (not a plain JSON array)
 * - Each segment has speaker as an OBJECT: { id, name, color }
 *   (contrast with MacWhisperJsonCleaner where speaker is a plain string)
 * - Timestamps in milliseconds (start / end)
 * - Speaker names may be real names (e.g. "Kevin Tronkowski"), generic identifiers
 *   ("Speaker 1" … "Speaker N"), or "Unknown"
 *
 * Example metadata.json shape:
 * {
 *   "transcripts": [
 *     {
 *       "id": "...",
 *       "text": "Awesome.",
 *       "start": 1280,
 *       "end": 2400,
 *       "speaker": { "id": "...", "name": "Speaker 1", "color": 0 }
 *     },
 *     ...
 *   ],
 *   "speakers": [ { "id": "...", "name": "Kevin Tronkowski", "color": 1 }, ... ],
 *   ...
 * }
 *
 * Consecutive segments from the same named speaker are merged into a single block.
 * "Unknown" segments are never merged — each is kept as its own block since
 * consecutive unknowns may be different unidentified people.
 */
export class WhisperFileMetaCleaner implements TranscriptCleaner {

	getName(): string {
		return 'MacWhisper .whisper File (Format 7)';
	}

	canHandle(content: string): boolean {
		const trimmed = content.trim();
		if (!trimmed.startsWith('{')) return false;
		try {
			const parsed = JSON.parse(trimmed);
			return (
				Array.isArray(parsed.transcripts) &&
				parsed.transcripts.length > 0 &&
				typeof parsed.transcripts[0].speaker === 'object' &&
				parsed.transcripts[0].speaker !== null &&
				typeof parsed.transcripts[0].speaker.name === 'string' &&
				typeof parsed.transcripts[0].text === 'string'
			);
		} catch {
			return false;
		}
	}

	clean(content: string): string {
		const data: {
			transcripts: Array<{
				text: string;
				speaker: { id: string; name: string; color: number };
			}>;
			speakers?: Array<{ id: string; name: string; color: number }>;
		} = JSON.parse(content.trim());

		// Build ID → resolved name lookup from the top-level speakers[].
		// The whisper-speaker-id tool updates speakers[] with real names but does NOT
		// back-fill segment.speaker.name, so we must do the ID lookup here.
		const speakerMap = new Map<string, string>();
		if (Array.isArray(data.speakers)) {
			for (const s of data.speakers) {
				if (s.id && s.name) speakerMap.set(s.id, s.name);
			}
		}

		const consolidated: SpeakerEntry[] = [];

		for (const segment of data.transcripts) {
			const rawName = (segment.speaker?.name ?? 'Unknown').trim();
			const speaker = segment.speaker?.id
				? (speakerMap.get(segment.speaker.id) ?? rawName)
				: rawName;
			const text = (segment.text ?? '').trim();
			if (!text) continue;

			const isUnknown = speaker.toLowerCase() === 'unknown';
			const last = consolidated[consolidated.length - 1];

			if (!isUnknown && last && last.speaker === speaker) {
				last.content += ' ' + text;
			} else {
				consolidated.push({ speaker, content: text });
			}
		}

		return consolidated
			.map(e => `[${e.speaker}]\n${e.content}`)
			.join('\n\n');
	}
}
