import { cleanCopilotOutput } from '../output-cleaner';

describe('cleanCopilotOutput', () => {
	it('unwraps a ```markdown fence wrapping the whole summary', () => {
		const raw = [
			'```markdown',
			'**Key Points:**',
			'- Point 1',
			'```',
		].join('\n');

		const cleaned = cleanCopilotOutput(raw);
		expect(cleaned).not.toContain('```');
		expect(cleaned).toContain('**Key Points:**');
		expect(cleaned).toContain('- Point 1');
	});

	it('strips a leading conversational preamble before the real content', () => {
		const raw = [
			"I'll analyze this meeting transcript and provide a structured summary.",
			'',
			'**Key Points:**',
			'- Point 1',
		].join('\n');

		const cleaned = cleanCopilotOutput(raw);
		expect(cleaned).not.toContain("I'll analyze");
		expect(cleaned.startsWith('**Key Points:**')).toBe(true);
	});

	it('strips preamble AND unwraps a fence together, preserving content after the fence', () => {
		const raw = [
			"I'll analyze this meeting transcript and provide a structured summary. Note: some irrelevant chatter at the end.",
			'',
			'```markdown',
			'**Key Points:**',
			'- Point 1',
			'```',
			'',
			'**Context Notes:**',
			'- RC7 = Release Candidate 7',
		].join('\n');

		const cleaned = cleanCopilotOutput(raw);
		expect(cleaned).not.toContain('```');
		expect(cleaned).not.toContain("I'll analyze");
		expect(cleaned).toContain('**Key Points:**');
		expect(cleaned).toContain('**Context Notes:**');
		expect(cleaned).toContain('RC7 = Release Candidate 7');
	});

	it('leaves already-clean content (no fence, no preamble) unchanged in substance', () => {
		const raw = '**Key Points:**\n- Point 1\n\n**Decisions:**\n- Decision 1';
		const cleaned = cleanCopilotOutput(raw);
		expect(cleaned).toBe(raw);
	});

	it('still strips CLI tool-trace lines', () => {
		const raw = [
			'● skill(summary-generation)',
			'  │ some command',
			'  └ 1 line read',
			'**Key Points:**',
			'- Point 1',
		].join('\n');

		const cleaned = cleanCopilotOutput(raw);
		expect(cleaned).not.toContain('●');
		expect(cleaned).not.toContain('│');
		expect(cleaned).not.toContain('└');
		expect(cleaned).toContain('**Key Points:**');
	});
});
