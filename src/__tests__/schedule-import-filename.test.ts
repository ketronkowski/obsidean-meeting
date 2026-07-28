import { sanitizeMeetingTitle, isFallbackTitle } from '../schedule-import/filename';

describe('sanitizeMeetingTitle', () => {
	test('leaves a normal title unchanged', () => {
		expect(sanitizeMeetingTitle('2026 July P2P - Daily Sync')).toBe('2026 July P2P - Daily Sync');
	});

	test('preserves tight hyphens like "Kevin/Ila 1-1" other than the slash', () => {
		expect(sanitizeMeetingTitle('Kevin/Ila 1-1')).toBe('Kevin-Ila 1-1');
	});

	test('replaces other illegal filesystem characters', () => {
		expect(sanitizeMeetingTitle('Q&A: "Roadmap" <Review>|Sync?')).not.toMatch(/[\\/:*?"<>|]/);
	});

	test('collapses whitespace and repeated dashes', () => {
		expect(sanitizeMeetingTitle('Foo    /   / Bar')).toBe('Foo - Bar');
	});

	test('trims leading/trailing dashes and whitespace', () => {
		expect(sanitizeMeetingTitle('  /Foo Bar/  ')).toBe('Foo Bar');
	});

	test('falls back to a timestamp when the sanitized result would be empty', () => {
		const result = sanitizeMeetingTitle('///');
		expect(isFallbackTitle(result)).toBe(true);
	});

	test('does not flag a normal title as a fallback', () => {
		expect(isFallbackTitle(sanitizeMeetingTitle('EPIC Dashboard Approach'))).toBe(false);
	});
});
