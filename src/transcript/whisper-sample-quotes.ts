/**
 * Extracts short sample quotes per speaker ID from a MacWhisper metadata.json
 * payload, for display in the voice speaker identification modal so users
 * have transcript context (not just a voice waveform) to help identify
 * unresolved/generic speakers.
 */

const MAX_QUOTE_LENGTH = 160;
const MIN_SEGMENT_TEXT_LENGTH = 8; // skip trivial segments like "Yeah." / "Okay."

interface WhisperTranscriptSegment {
	text: string;
	speaker?: { id: string; name: string };
	start?: number;
	startTime?: number;
	end?: number;
	endTime?: number;
}

interface WhisperMetadata {
	transcripts?: WhisperTranscriptSegment[];
}

/**
 * Convert a timestamp that may be in milliseconds to seconds, mirroring the
 * whisper-speaker-id daemon's `_ms_to_sec` (whisper_file.py): MacWhisper
 * stores timestamps in milliseconds (e.g. 81140 = 81.14s); values > 10000
 * are assumed to be ms, smaller values are treated as already-seconds.
 */
function msToSec(value: number | undefined): number {
	const v = value ?? 0;
	return v > 10_000 ? v / 1000 : v;
}

/**
 * Build a map of speaker.id -> a single representative sample quote.
 *
 * Selection criterion mirrors the whisper-speaker-id daemon's
 * `longest_segment_by_speaker`/`best_segment_for_playback` (which pick the
 * longest-*duration* segment for the ▶ Play button's audio clip) rather than
 * the longest-*text* segment, so the displayed quote matches what's actually
 * heard when playing the clip. Ties are broken by longer text for
 * determinism. Trivial/near-empty segments are still excluded regardless of
 * duration (e.g. a long silent pause with a one-word transcript).
 *
 * Known limitation: the daemon also bounds candidates to the real audio
 * duration (`start < max_end`) to guard against segments with corrupted/
 * ambiguous timestamp units. This extractor has no access to the audio
 * track's real duration (it only reads metadata.json), so it can't
 * replicate that bounds check — in the rare case of such corrupted
 * timestamps, the quote and clip could still diverge.
 */
export function extractWhisperSampleQuotes(metadataJson: string): Map<string, string> {
	const quotes = new Map<string, string>();

	let data: WhisperMetadata;
	try {
		data = JSON.parse(metadataJson);
	} catch {
		return quotes;
	}

	if (!Array.isArray(data.transcripts)) return quotes;

	const bestBySpeaker = new Map<string, { text: string; duration: number }>();

	for (const seg of data.transcripts) {
		const speakerId = seg.speaker?.id;
		const text = (seg.text ?? '').trim();
		if (!speakerId || text.length < MIN_SEGMENT_TEXT_LENGTH) continue;

		const start = msToSec(seg.start ?? seg.startTime);
		const end = msToSec(seg.end ?? seg.endTime);
		const duration = end - start;

		const existing = bestBySpeaker.get(speakerId);
		if (
			!existing ||
			duration > existing.duration ||
			(duration === existing.duration && text.length > existing.text.length)
		) {
			bestBySpeaker.set(speakerId, { text, duration });
		}
	}

	for (const [speakerId, { text }] of bestBySpeaker) {
		const truncated = text.length > MAX_QUOTE_LENGTH
			? text.slice(0, MAX_QUOTE_LENGTH).trim() + '…'
			: text;
		quotes.set(speakerId, truncated);
	}

	return quotes;
}
