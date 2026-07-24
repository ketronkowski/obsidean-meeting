import { VoiceAnalysisResponse } from '../../voice-analysis-types';

export const ALL_AUTO_RESPONSE: VoiceAnalysisResponse = {
	speakers: [
		{ speakerUuid: 'test-uuid-001', displayName: 'Speaker 1', bestMatch: 'Alice Smith',  score: 0.85, action: 'auto' },
		{ speakerUuid: 'test-uuid-002', displayName: 'Speaker 2', bestMatch: 'Bob Jones',    score: 0.79, action: 'auto' },
		{ speakerUuid: 'test-uuid-003', displayName: 'Speaker 3', bestMatch: 'Carol White',  score: 0.77, action: 'auto' },
	],
	knownSpeakers: ['Alice Smith', 'Bob Jones', 'Carol White'],
};

export const MIXED_RESPONSE: VoiceAnalysisResponse = {
	speakers: [
		{ speakerUuid: 'test-uuid-001', displayName: 'Speaker 1', bestMatch: 'Alice Smith', score: 0.85, action: 'auto' },
		{ speakerUuid: 'test-uuid-002', displayName: 'Speaker 2', bestMatch: 'Bob Jones',   score: 0.62, action: 'confirm' },
		{ speakerUuid: 'test-uuid-003', displayName: 'Speaker 3', bestMatch: null,           score: 0.28, action: 'skip' },
	],
	knownSpeakers: ['Alice Smith', 'Bob Jones', 'Carol White'],
};

export const ALL_SKIP_RESPONSE: VoiceAnalysisResponse = {
	speakers: [
		{ speakerUuid: 'test-uuid-001', displayName: 'Speaker 1', bestMatch: null, score: 0.21, action: 'skip' },
		{ speakerUuid: 'test-uuid-002', displayName: 'Speaker 2', bestMatch: null, score: 0.18, action: 'skip' },
	],
	knownSpeakers: ['Alice Smith', 'Bob Jones'],
};
