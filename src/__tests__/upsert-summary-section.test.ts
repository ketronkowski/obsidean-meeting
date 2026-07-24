/**
 * Tests for upsertSummarySection — the fix for the \Z regex bug that caused
 * duplicate # Summary sections when the section was at the end of the document.
 */

import { upsertSummarySection } from '../handlers/general';

const NEW_BODY = 'New AI-generated summary content.';

describe('upsertSummarySection', () => {

	// -------------------------------------------------------------------------
	// Updating existing section
	// -------------------------------------------------------------------------

	test('replaces existing # Summary when it is the last section', () => {
		const content = `---
tags: [meeting]
---

# Attendees
- [[Alice]]

# Transcript
Some transcript text.

# Summary
Old summary that should be replaced.`;

		const result = upsertSummarySection(content, NEW_BODY);
		expect(result).toContain(`# Summary\n\n${NEW_BODY}`);
		expect(result).not.toContain('Old summary that should be replaced.');
		// No duplicate heading
		expect(result.split('# Summary').length).toBe(2);
	});

	test('replaces existing # Summary when another section follows', () => {
		const content = `# Attendees
- [[Alice]]

# Summary
Old summary.

# Notes
Some notes here.`;

		const result = upsertSummarySection(content, NEW_BODY);
		expect(result).toContain(`# Summary\n\n${NEW_BODY}`);
		expect(result).not.toContain('Old summary.');
		expect(result).toContain('# Notes\nSome notes here.');
		expect(result.split('# Summary').length).toBe(2);
	});

	test('preserves content before and after when updating middle section', () => {
		const content = `# Attendees
- [[Alice]]

# Summary
Old summary.

# Transcript
Transcript text.

# Notes
Notes.`;

		const result = upsertSummarySection(content, NEW_BODY);
		expect(result).toContain('# Attendees');
		expect(result).toContain('# Transcript\nTranscript text.');
		expect(result).toContain('# Notes\nNotes.');
		expect(result).not.toContain('Old summary.');
	});

	// -------------------------------------------------------------------------
	// Inserting new section
	// -------------------------------------------------------------------------

	test('inserts # Summary before # Notes when no Summary exists', () => {
		const content = `# Attendees
- [[Alice]]

# Transcript
Some transcript.

# Notes
Some notes.`;

		const result = upsertSummarySection(content, NEW_BODY);
		expect(result).toContain(`# Summary\n\n${NEW_BODY}`);
		// Summary appears before Notes
		const summaryIdx = result.indexOf('# Summary');
		const notesIdx = result.indexOf('# Notes');
		expect(summaryIdx).toBeLessThan(notesIdx);
	});

	test('appends # Summary when no Summary or Notes section exists', () => {
		const content = `# Attendees
- [[Alice]]

# Transcript
Some transcript.`;

		const result = upsertSummarySection(content, NEW_BODY);
		expect(result).toContain(`# Summary\n\n${NEW_BODY}`);
		// Appended at the end
		expect(result.trimEnd().endsWith(NEW_BODY.trim()) ||
			result.trimEnd().endsWith(`${NEW_BODY}\n`)).toBeTruthy();
	});

	// -------------------------------------------------------------------------
	// Edge cases
	// -------------------------------------------------------------------------

	test('does not create duplicate sections on second call', () => {
		const content = `# Transcript
Some text.

# Summary
First summary.`;

		const after1 = upsertSummarySection(content, 'Second summary.');
		const after2 = upsertSummarySection(after1, 'Third summary.');

		expect(after2.split('# Summary').length).toBe(2);
		expect(after2).toContain('Third summary.');
		expect(after2).not.toContain('Second summary.');
	});

	test('# Summary with subtitle line is replaced correctly', () => {
		const content = `# Transcript
Text.

# Summary — Auto-generated
Old body.

# Notes
Notes.`;

		const result = upsertSummarySection(content, NEW_BODY);
		// The heading line matches /^# Summary\b/ regardless of subtitle
		expect(result).toContain(`# Summary\n\n${NEW_BODY}`);
		expect(result).not.toContain('Old body.');
		expect(result).toContain('# Notes');
	});
});
