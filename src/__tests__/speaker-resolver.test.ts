import { countDistinctSpeakerLabels } from '../speaker-resolver';

describe('countDistinctSpeakerLabels', () => {
	test('counts multiple distinct speakers', () => {
		const transcript = `[Kevin Tronkowski]
Hi everyone.

[Shaji Mohammed]
Hello!

[Kevin Tronkowski]
Good to see you.`;
		expect(countDistinctSpeakerLabels(transcript)).toBe(2);
	});

	test('detects the single-speaker mismatch case (diarization failure)', () => {
		// Mirrors the real bug: MacWhisper's non-diarizing engine collapsed a
		// 6-person meeting into one speaker block.
		const transcript = `[Kevin Tronkowski]
Everything anyone in the meeting said, all merged into one block...`;
		expect(countDistinctSpeakerLabels(transcript)).toBe(1);
	});

	test('is case-insensitive when deduping labels', () => {
		const transcript = `[Kevin Tronkowski]\nHi.\n\n[kevin tronkowski]\nStill me.`;
		expect(countDistinctSpeakerLabels(transcript)).toBe(1);
	});

	test('returns 0 when there are no bracketed speaker labels', () => {
		expect(countDistinctSpeakerLabels('Just plain paragraph text, no labels.')).toBe(0);
	});
});
