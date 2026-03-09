import { App, TFile } from 'obsidian';

/**
 * A single speaker's profile extracted from the transcript
 */
export interface SpeakerProfile {
	speakerId: string;      // e.g. "Speaker 1"
	sampleQuotes: string[]; // 3–5 representative lines
	lineCount: number;      // total number of utterances
	allLines: string[];     // all utterance lines (for heuristics)
}

/**
 * A resolved mapping from a generic speaker label to an attendee
 */
export interface SpeakerMapping {
	speakerId: string;      // e.g. "Speaker 1"
	attendeeName: string;   // display name e.g. "Paul Lloyd"
	wikiLink: string;       // [[People/Lloyd, Paul|Paul Lloyd]]
	confidence: number;     // 0–1
	autoDetected: boolean;
}

/**
 * Parse the raw transcript text and extract a profile for each [Speaker N] label.
 * Works on the raw file content (reads the # Transcript section).
 */
export function extractSpeakerProfiles(transcriptText: string): SpeakerProfile[] {
	// Match blocks: [Speaker N] followed by content until the next [Speaker ...] or end
	const blockPattern = /\[Speaker (\d+)\]\r?\n([\s\S]*?)(?=\n\[Speaker \d+\]|$)/g;
	const profileMap = new Map<string, { lines: string[] }>();

	let match: RegExpExecArray | null;
	while ((match = blockPattern.exec(transcriptText)) !== null) {
		const speakerId = `Speaker ${match[1]}`;
		const blockText = match[2].trim();

		if (!blockText) continue;

		// Split into individual sentences / lines, skip pure filler
		const lines = blockText
			.split(/\r?\n/)
			.map(l => l.trim())
			.filter(l => l.length > 0);

		if (!profileMap.has(speakerId)) {
			profileMap.set(speakerId, { lines: [] });
		}
		profileMap.get(speakerId)!.lines.push(...lines);
	}

	const profiles: SpeakerProfile[] = [];
	for (const [speakerId, data] of profileMap.entries()) {
		const substantiveLines = data.lines.filter(l => l.length > 30 && !/^(um|uh|yeah|okay|right|no|yes|sure|oh)\b/i.test(l));
		const sampleQuotes = substantiveLines.slice(0, 4);

		profiles.push({
			speakerId,
			sampleQuotes,
			lineCount: data.lines.length,
			allLines: data.lines
		});
	}

	// Sort numerically by speaker number
	profiles.sort((a, b) => {
		const numA = parseInt(a.speakerId.replace('Speaker ', ''));
		const numB = parseInt(b.speakerId.replace('Speaker ', ''));
		return numA - numB;
	});

	return profiles;
}

/**
 * Extract display names and wiki-links from the Attendees section of note content.
 * Returns array of { displayName, wikiLink } objects.
 */
export function extractAttendeeLinks(content: string): Array<{ displayName: string; wikiLink: string }> {
	const attendeesMatch = content.match(/^# Attendees\n([\s\S]*?)(?=\n#|$)/m);
	if (!attendeesMatch) return [];

	const attendeesText = attendeesMatch[1];
	const result: Array<{ displayName: string; wikiLink: string }> = [];

	// Match: - [[People/Last, First|First Last]]
	const wikiLinkPattern = /- \[\[([^\]|]+)\|([^\]]+)\]\]/g;
	let match: RegExpExecArray | null;
	while ((match = wikiLinkPattern.exec(attendeesText)) !== null) {
		result.push({
			displayName: match[2].trim(),
			wikiLink: `[[${match[1]}|${match[2]}]]`
		});
	}

	// Also match plain names: - Some Name (no wiki-link)
	const plainNamePattern = /^- ([A-Z][a-zA-Z]+(?: [A-Z][a-zA-Z]+)+)$/gm;
	while ((match = plainNamePattern.exec(attendeesText)) !== null) {
		const name = match[1].trim();
		// Only add if not already covered by a wiki-link
		if (!result.some(a => a.displayName === name)) {
			result.push({ displayName: name, wikiLink: name });
		}
	}

	return result;
}

/**
 * Auto-detect speaker-to-attendee mappings using heuristics.
 * Returns mappings with confidence scores; callers should use ≥ 0.8 as auto-map threshold.
 */
export function autoDetectMappings(
	profiles: SpeakerProfile[],
	attendees: Array<{ displayName: string; wikiLink: string }>
): SpeakerMapping[] {
	const mappings: SpeakerMapping[] = [];
	const usedAttendees = new Set<string>();

	for (const profile of profiles) {
		let bestMatch: { attendee: { displayName: string; wikiLink: string }; confidence: number } | null = null;

		for (const attendee of attendees) {
			const confidence = scoreSpeakerAttendee(profile, attendee);
			if (!bestMatch || confidence > bestMatch.confidence) {
				bestMatch = { attendee, confidence };
			}
		}

		if (bestMatch && bestMatch.confidence >= 0.8) {
			mappings.push({
				speakerId: profile.speakerId,
				attendeeName: bestMatch.attendee.displayName,
				wikiLink: bestMatch.attendee.wikiLink,
				confidence: bestMatch.confidence,
				autoDetected: true
			});
			usedAttendees.add(bestMatch.attendee.displayName);
		}
	}

	// Single-speaker heuristic: if only one Speaker N and only one unmatched attendee
	const unmappedProfiles = profiles.filter(p => !mappings.some(m => m.speakerId === p.speakerId));
	const unmappedAttendees = attendees.filter(a => !usedAttendees.has(a.displayName));
	if (unmappedProfiles.length === 1 && unmappedAttendees.length === 1) {
		mappings.push({
			speakerId: unmappedProfiles[0].speakerId,
			attendeeName: unmappedAttendees[0].displayName,
			wikiLink: unmappedAttendees[0].wikiLink,
			confidence: 0.6,
			autoDetected: true
		});
	}

	return mappings;
}

/**
 * Score how well a speaker profile matches an attendee.
 */
function scoreSpeakerAttendee(
	profile: SpeakerProfile,
	attendee: { displayName: string }
): number {
	const allText = profile.allLines.join(' ').toLowerCase();
	const fullName = attendee.displayName.toLowerCase();
	const parts = fullName.split(/\s+/);
	const firstName = parts[0];
	const lastName = parts[parts.length - 1];

	let score = 0;

	// Self-introduction patterns
	const introPatterns = [
		new RegExp(`\\bI(?:'m| am)\\s+${escapeRegex(firstName)}\\b`, 'i'),
		new RegExp(`\\bmy name(?:'s| is)\\s+${escapeRegex(firstName)}\\b`, 'i'),
		new RegExp(`\\b${escapeRegex(fullName)}\\b`, 'i'),
	];
	for (const pattern of introPatterns) {
		if (pattern.test(allText)) {
			score += 0.9;
			break;
		}
	}

	// First name mentioned by this speaker in their own speech
	if (score === 0) {
		const firstNamePattern = new RegExp(`\\b${escapeRegex(firstName)}\\b`, 'i');
		if (firstNamePattern.test(allText)) {
			score += 0.4;
		}
		// Last name match
		if (lastName !== firstName) {
			const lastNamePattern = new RegExp(`\\b${escapeRegex(lastName)}\\b`, 'i');
			if (lastNamePattern.test(allText)) {
				score += 0.3;
			}
		}
	}

	return Math.min(score, 1.0);
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Rewrite the transcript section of content, replacing [Speaker N] labels
 * with the mapped attendee wiki-links (or display names if no wiki-link).
 * Unmapped speakers are left as-is.
 */
export function rewriteTranscript(content: string, mappings: SpeakerMapping[]): string {
	if (mappings.length === 0) return content;

	let result = content;
	for (const mapping of mappings) {
		// Replace [Speaker N] with the display name (keep as plain text in transcript,
		// not a wiki-link, since Obsidian doesn't render links inside code-block-style transcript)
		const escapedId = escapeRegex(mapping.speakerId);
		const pattern = new RegExp(`\\[${escapedId}\\]`, 'g');
		result = result.replace(pattern, `[${mapping.attendeeName}]`);
	}
	return result;
}

/**
 * Extract just the transcript text from full note content (the # Transcript section).
 */
export function extractTranscriptText(content: string): string {
	const match = content.match(/^# Transcript\s*\n([\s\S]*?)(?=\n#|$)/m);
	return match ? match[1].trim() : '';
}
