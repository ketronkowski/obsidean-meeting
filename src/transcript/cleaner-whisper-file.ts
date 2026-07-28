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
 *
 * Some engines (e.g. Apple's native speech transcription, "modelEngine":
 * "nativeSpeechTranscription") do not perform per-segment speaker diarization at all.
 * In that case every segment omits `speaker` entirely, and the top-level `speakers[]`
 * array contains at most one entry (the local mic user). This cleaner falls back to
 * attributing all segments to that single known speaker, or to a generic "Speaker 1"
 * label if there is no speaker info anywhere in the file — so downstream [Speaker N]
 * resolution still has something to work with.
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
				speaker?: { id: string; name: string; color: number };
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

		// Fallback name to use when a segment has no `speaker` field at all
		// (engine didn't diarize). Prefer the sole known top-level speaker; otherwise
		// use a generic label so [Speaker N] resolution still has something to match.
		const fallbackName = Array.isArray(data.speakers) && data.speakers.length === 1 && data.speakers[0].name
			? data.speakers[0].name
			: 'Speaker 1';

		const consolidated: SpeakerEntry[] = [];

		for (const segment of data.transcripts) {
			const rawName = (segment.speaker?.name ?? fallbackName).trim();
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
