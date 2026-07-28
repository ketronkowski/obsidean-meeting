import { WhisperFileMetaCleaner } from '../transcript/cleaner-whisper-file';

describe('WhisperFileMetaCleaner', () => {
	const cleaner = new WhisperFileMetaCleaner();

	test('canHandle/clean: diarized transcript with per-segment speaker objects', () => {
		const content = JSON.stringify({
			transcripts: [
				{ text: 'Hi everyone.', speaker: { id: 'a', name: 'Kevin Tronkowski', color: 1 } },
				{ text: 'How is it going?', speaker: { id: 'a', name: 'Kevin Tronkowski', color: 1 } },
				{ text: 'Great, thanks!', speaker: { id: 'b', name: 'Shaji Mohammed', color: 2 } },
			],
			speakers: [
				{ id: 'a', name: 'Kevin Tronkowski', color: 1 },
				{ id: 'b', name: 'Shaji Mohammed', color: 2 },
			],
		});

		expect(cleaner.canHandle(content)).toBe(true);
		const cleaned = cleaner.clean(content);
		expect(cleaned).toBe(
			'[Kevin Tronkowski]\nHi everyone. How is it going?\n\n[Shaji Mohammed]\nGreat, thanks!'
		);
	});

	test('canHandle/clean: non-diarized transcript (Apple native speech, no per-segment speaker)', () => {
		// Mirrors the real-world shape produced by modelEngine "nativeSpeechTranscription":
		// segments have no `speaker` field at all, and there is exactly one top-level speaker.
		const content = JSON.stringify({
			originalMediaExtension: 'm4a',
			modelEngine: 'nativeSpeechTranscription',
			speakers: [{ name: 'Kevin Tronkowski', color: 1, id: 'X' }],
			transcripts: [
				{ end: 4200, id: '1', start: 1, text: 'Came up in our retro.', favorited: false },
				{ end: 5220, id: '2', start: 4260, text: 'So thank you.', favorited: false },
			],
		});

		expect(cleaner.canHandle(content)).toBe(true);
		const cleaned = cleaner.clean(content);
		expect(cleaned).toBe('[Kevin Tronkowski]\nCame up in our retro. So thank you.');
	});

	test('canHandle/clean: no speaker info anywhere falls back to generic label', () => {
		const content = JSON.stringify({
			transcripts: [
				{ text: 'Segment one.' },
				{ text: 'Segment two.' },
			],
		});

		expect(cleaner.canHandle(content)).toBe(true);
		const cleaned = cleaner.clean(content);
		expect(cleaned).toBe('[Speaker 1]\nSegment one. Segment two.');
	});

	test('canHandle: rejects non-whisper JSON', () => {
		expect(cleaner.canHandle('[]')).toBe(false);
		expect(cleaner.canHandle('{"foo":"bar"}')).toBe(false);
		expect(cleaner.canHandle('not json at all')).toBe(false);
	});
});
