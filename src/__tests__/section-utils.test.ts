import { upsertSection, getSection } from '../section-utils';

describe('upsertSection heading whitespace tolerance', () => {
	it('replaces an existing section even when the heading has extra internal spaces', () => {
		// Regression test: a note had "#  Summary" (two spaces after #), which the
		// old strict single-space regex failed to match, causing upsertSection to
		// insert a brand-new "# Summary" section instead of replacing the existing
		// (empty) one — leaving a duplicate heading in the note.
		const content = [
			'# Attendees',
			'- Alice',
			'',
			'#  Summary',
			'',
			'',
			'# Notes',
			'',
			'# Transcript',
			'[Alice]\nhello',
		].join('\n');

		const result = upsertSection(content, 'Summary', '**Key Points:**\n- Point 1', { insertBeforeHeading: 'Notes' });

		// Only one "Summary" heading should remain
		const summaryHeadingCount = (result.match(/^#\s+Summary\b/gm) || []).length;
		expect(summaryHeadingCount).toBe(1);
		expect(result).toContain('**Key Points:**');
		expect(result).toContain('- Point 1');
	});

	it('getSection also tolerates extra internal spaces in the heading', () => {
		const content = '#  Summary\n\nSome body text\n\n# Notes\n';
		expect(getSection(content, 'Summary')).toBe('Some body text');
	});

	it('still works normally with standard single-space headings', () => {
		const content = '# Summary\n\nOld body\n\n# Notes\n';
		const result = upsertSection(content, 'Summary', 'New body', { insertBeforeHeading: 'Notes' });
		const summaryHeadingCount = (result.match(/^#\s+Summary\b/gm) || []).length;
		expect(summaryHeadingCount).toBe(1);
		expect(result).toContain('New body');
		expect(result).not.toContain('Old body');
	});
});
