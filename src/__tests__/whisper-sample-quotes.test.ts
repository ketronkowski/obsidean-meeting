import { extractWhisperSampleQuotes } from '../transcript/whisper-sample-quotes';

describe('extractWhisperSampleQuotes', () => {
	it('picks the longest segment per speaker as the sample quote', () => {
		const metadata = JSON.stringify({
			transcripts: [
				{ text: 'Yeah.', speaker: { id: 'a', name: 'Speaker 1' } },
				{ text: 'I think we should revisit the roadmap for next quarter.', speaker: { id: 'a', name: 'Speaker 1' } },
				{ text: 'Okay.', speaker: { id: 'b', name: 'Speaker 2' } },
				{ text: 'Sure, that works for me as well.', speaker: { id: 'b', name: 'Speaker 2' } },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.get('a')).toBe('I think we should revisit the roadmap for next quarter.');
		expect(quotes.get('b')).toBe('Sure, that works for me as well.');
	});

	it('skips trivial short segments and segments without a speaker id', () => {
		const metadata = JSON.stringify({
			transcripts: [
				{ text: 'Hi.', speaker: { id: 'a', name: 'Speaker 1' } },
				{ text: 'No speaker here at all.' },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.size).toBe(0);
	});

	it('truncates long quotes to the max length with an ellipsis', () => {
		const longText = 'x'.repeat(300);
		const metadata = JSON.stringify({
			transcripts: [{ text: longText, speaker: { id: 'a', name: 'Speaker 1' } }],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		const quote = quotes.get('a')!;
		expect(quote.endsWith('…')).toBe(true);
		expect(quote.length).toBeLessThan(300);
	});

	it('returns an empty map for invalid JSON or missing transcripts', () => {
		expect(extractWhisperSampleQuotes('not json').size).toBe(0);
		expect(extractWhisperSampleQuotes('{}').size).toBe(0);
	});

	it('picks the longest-duration segment even when a shorter-duration segment has more text (matches the Play button clip)', () => {
		const metadata = JSON.stringify({
			transcripts: [
				// Short duration (2s), but dense/long text — should NOT win.
				{ text: 'I think we should revisit the roadmap for next quarter and also discuss budget.', start: 10, end: 12, speaker: { id: 'a', name: 'Speaker 1' } },
				// Long duration (8s) despite shorter text — should win, matching best_segment_for_playback.
				{ text: 'Well... um... so...', start: 20, end: 28, speaker: { id: 'a', name: 'Speaker 1' } },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.get('a')).toBe('Well... um... so...');
	});

	it('normalizes millisecond timestamps like the daemon does (values > 10000 are ms)', () => {
		const metadata = JSON.stringify({
			transcripts: [
				// 81140ms -> 81.14s start, 82000ms -> 82s end => ~0.86s duration
				{ text: 'Short but in milliseconds.', start: 81140, end: 82000, speaker: { id: 'a', name: 'Speaker 1' } },
				// 5s -> 15s (already seconds) => 10s duration, should win
				{ text: 'Longer duration in seconds.', start: 5, end: 15, speaker: { id: 'a', name: 'Speaker 1' } },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.get('a')).toBe('Longer duration in seconds.');
	});

	it('falls back to longer text as a tiebreaker when durations are equal', () => {
		const metadata = JSON.stringify({
			transcripts: [
				{ text: 'Short one.', start: 0, end: 5, speaker: { id: 'a', name: 'Speaker 1' } },
				{ text: 'This one is longer text with the same duration.', start: 10, end: 15, speaker: { id: 'a', name: 'Speaker 1' } },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.get('a')).toBe('This one is longer text with the same duration.');
	});

	it('still excludes trivial-text segments even if they have the longest duration', () => {
		const metadata = JSON.stringify({
			transcripts: [
				// Long duration but trivial text (< MIN_SEGMENT_TEXT_LENGTH) — must be excluded.
				{ text: 'Hi.', start: 0, end: 30, speaker: { id: 'a', name: 'Speaker 1' } },
				{ text: 'This is the only eligible segment.', start: 40, end: 41, speaker: { id: 'a', name: 'Speaker 1' } },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.get('a')).toBe('This is the only eligible segment.');
	});

	it('supports startTime/endTime field aliases', () => {
		const metadata = JSON.stringify({
			transcripts: [
				{ text: 'Short duration alias fields.', startTime: 0, endTime: 1, speaker: { id: 'a', name: 'Speaker 1' } },
				{ text: 'Long duration alias fields.', startTime: 10, endTime: 20, speaker: { id: 'a', name: 'Speaker 1' } },
			],
		});

		const quotes = extractWhisperSampleQuotes(metadata);
		expect(quotes.get('a')).toBe('Long duration alias fields.');
	});
});
