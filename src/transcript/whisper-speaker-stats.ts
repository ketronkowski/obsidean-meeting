/**
 * Computes per-speaker speaking-time stats from a MacWhisper metadata.json
 * payload, so the voice speaker identification modal can flag likely
 * diarization noise — MacWhisper's own speaker clustering sometimes
 * over-segments a meeting into far more "speakers" than actual attendees
 * (e.g. brief crosstalk or background noise misclassified as a distinct
 * speaker). Those spurious speakers typically have only a few seconds of
 * total speaking time across a handful of segments, unlike real
 * participants who accumulate tens of seconds to minutes even when quiet.
 */

import { msToSec } from './whisper-sample-quotes';

/**
 * A speaker's total speaking time and segment count is considered "low
 * signal" (likely diarization noise rather than a real distinct speaker)
 * below this threshold. Deliberately conservative — under-flagging a real,
 * quiet participant is far less annoying than pre-skipping someone who
 * actually spoke.
 */
export const LOW_SIGNAL_DURATION_SEC = 10;

export interface WhisperSpeakerStats {
	totalDurationSec: number;
	segmentCount: number;
}

interface WhisperTranscriptSegment {
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
 * Build a map of speaker.id -> {totalDurationSec, segmentCount} by summing
 * every segment's duration per speaker across the whole file.
 */
export function extractWhisperSpeakerStats(metadataJson: string): Map<string, WhisperSpeakerStats> {
	const stats = new Map<string, WhisperSpeakerStats>();

	let data: WhisperMetadata;
	try {
		data = JSON.parse(metadataJson);
	} catch {
		return stats;
	}

	if (!Array.isArray(data.transcripts)) return stats;

	for (const seg of data.transcripts) {
		const speakerId = seg.speaker?.id;
		if (!speakerId) continue;

		const start = msToSec(seg.start ?? seg.startTime);
		const end = msToSec(seg.end ?? seg.endTime);
		const duration = Math.max(0, end - start);

		const existing = stats.get(speakerId) ?? { totalDurationSec: 0, segmentCount: 0 };
		existing.totalDurationSec += duration;
		existing.segmentCount += 1;
		stats.set(speakerId, existing);
	}

	return stats;
}

/**
 * Whether a speaker's aggregate stats look like diarization noise rather
 * than a real participant. A missing/undefined entry is treated as *not*
 * low-signal (fail open — never surprise-skip a speaker we have no data
 * for, e.g. if stats extraction failed).
 */
export function isLowSignalSpeaker(stats: WhisperSpeakerStats | undefined): boolean {
	if (!stats) return false;
	return stats.totalDurationSec < LOW_SIGNAL_DURATION_SEC;
}
