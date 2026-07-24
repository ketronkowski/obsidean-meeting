import * as fs from 'fs';
import * as path from 'path';
import { parseEmailParticipants, parseLastFirst, EmailParticipant } from '../email-parser';

// Load the real SIC issue email note as test fixture
const FIXTURE_PATH = path.join(__dirname, 'fixtures', 'email-chain-sic-issue.md');
const fixtureContent = fs.readFileSync(FIXTURE_PATH, 'utf8');

// Extract just the Email Chain section from the fixture
function extractEmailChain(content: string): string {
	const headingIdx = content.indexOf('# Email Chain');
	if (headingIdx === -1) throw new Error('No # Email Chain section in fixture');
	const afterHeading = content.indexOf('\n', headingIdx) + 1;
	return content.slice(afterHeading);
}

const EMAIL_CHAIN = extractEmailChain(fixtureContent);

describe('parseLastFirst', () => {
	test('converts "Last, First" to "First Last"', () => {
		expect(parseLastFirst('Tronkowski, Kevin')).toBe('Kevin Tronkowski');
		expect(parseLastFirst('Yun, Stella')).toBe('Stella Yun');
		expect(parseLastFirst('Lankababu, Kanumuri')).toBe('Kanumuri Lankababu');
	});

	test('returns name unchanged when no comma', () => {
		expect(parseLastFirst('GL Platform Services Support')).toBe('GL Platform Services Support');
	});
});

describe('parseEmailParticipants', () => {
	let participants: EmailParticipant[];

	beforeAll(() => {
		participants = parseEmailParticipants(EMAIL_CHAIN);
	});

	test('extracts exactly 7 HPE personal participants from the SIC issue fixture', () => {
		expect(participants).toHaveLength(7);
	});

	test('includes all expected people', () => {
		const emails = participants.map(p => p.email.toLowerCase());
		expect(emails).toContain('will.colton@hpe.com');
		expect(emails).toContain('xiaoyang.yun@hpe.com');
		expect(emails).toContain('kashish.pahwa@hpe.com');
		expect(emails).toContain('kanumuri.lankababu@hpe.com');
		expect(emails).toContain('sayali.hirve@hpe.com');
		expect(emails).toContain('czarena.siebert@hpe.com');
		expect(emails).toContain('kevin.tronkowski@hpe.com');
	});

	test('excludes the group mailbox "GL Platform Services Support"', () => {
		const emails = participants.map(p => p.email.toLowerCase());
		expect(emails).not.toContain('glplatformservices@hpe.com');
	});

	test('deduplicates participants who appear in multiple emails', () => {
		// Will Colton appears in From/To across 5+ email blocks
		const willCount = participants.filter(p => p.email === 'will.colton@hpe.com').length;
		expect(willCount).toBe(1);
	});

	test('produces "First Last" displayName', () => {
		const will = participants.find(p => p.email === 'will.colton@hpe.com');
		expect(will?.displayName).toBe('Will Colton');

		const kanumuri = participants.find(p => p.email === 'kanumuri.lankababu@hpe.com');
		expect(kanumuri?.displayName).toBe('Kanumuri Lankababu');
	});

	test('preserves "Last, First" as mailboxName for People profile lookup', () => {
		const will = participants.find(p => p.email === 'will.colton@hpe.com');
		expect(will?.mailboxName).toBe('Colton, Will');
	});

	test('excludes non-HPE email addresses', () => {
		// loic.harrang@roullier.com is mentioned in email body but not a header participant
		const external = participants.filter(p => !p.email.endsWith('@hpe.com'));
		expect(external).toHaveLength(0);
	});
});

describe('parseEmailParticipants with synthetic content', () => {
	test('handles plain (non-markdown-link) email format', () => {
		const content = '**From:** Smith, John <john.smith@hpe.com>\n**To:** Doe, Jane <jane.doe@hpe.com>\n';
		const result = parseEmailParticipants(content);
		expect(result).toHaveLength(2);
		expect(result[0].displayName).toBe('John Smith');
		expect(result[1].displayName).toBe('Jane Doe');
	});

	test('returns empty array when no HPE addresses present', () => {
		const content = '**From:** Smith, John <john.smith@external.com>\n';
		expect(parseEmailParticipants(content)).toHaveLength(0);
	});

	test('skips group addresses with no comma in display name', () => {
		const content = '**Cc:** My Team DL <myteam@hpe.com>\n';
		expect(parseEmailParticipants(content)).toHaveLength(0);
	});

	test('ignores Subject, Sent, Date header fields', () => {
		const content =
			'**Subject:** Test Email\n' +
			'**Sent:** Monday, May 1, 2026\n' +
			'**Date:** Monday, May 1, 2026\n' +
			'**From:** Smith, John <john.smith@hpe.com>\n';
		const result = parseEmailParticipants(content);
		expect(result).toHaveLength(1);
		expect(result[0].displayName).toBe('John Smith');
	});
});
