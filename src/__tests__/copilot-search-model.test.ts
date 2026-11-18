import { EventEmitter } from 'events';
import { App } from 'obsidian';
import { CopilotClientManager } from '../copilot-client';
import { DEFAULT_SETTINGS } from '../ui/settings-tab';

jest.mock('../ui/settings-tab', () => ({
	DEFAULT_SETTINGS: { model: 'claude-sonnet-4.5', copilotCliPath: '/custom/copilot' },
}));

afterEach(() => jest.restoreAllMocks());

function events(content: string): string {
	return [
		{ type: 'session.start', data: {} },
		{ type: 'assistant.message', data: { phase: 'commentary', content: 'Searching...' } },
		{ type: 'assistant.message', data: { phase: 'final_answer', content, toolRequests: [] } },
		{ type: 'result', exitCode: 0 },
	].map(event => JSON.stringify(event)).join('\n') + '\n';
}

function mockOutput(output: string) {
	return jest.spyOn(require('child_process'), 'spawn').mockImplementation(() => {
		const child = Object.assign(new EventEmitter(), {
			stdout: new EventEmitter(), stderr: new EventEmitter(),
		});
		setImmediate(() => {
			child.stdout.emit('data', Buffer.from(output.slice(0, 23)));
			child.stdout.emit('data', Buffer.from(output.slice(23)));
			child.emit('close', 0);
		});
		return child;
	});
}

test.each([
	['Classify this search', 'fusion', ['--model', 'fusion']],
	['Inspect [📷 /vault/screen.png]', 'fusion', ['--model', 'fusion']],
	['Existing meeting prompt', undefined, ['--model', 'claude-sonnet-4.5']],
])('passes the explicit CLI model for %s without changing general settings', async (prompt, model, expected) => {
	const responseOnly = model === 'fusion';
	const spawn = mockOutput(responseOnly ? events('{"matches":[]}') : '{"matches":[]}');
	const client = new CopilotClientManager({} as App, DEFAULT_SETTINGS);
	await expect(client.sendPrompt(prompt, undefined, undefined, {
		model, showWorking: false, responseOnly,
	})).resolves.toBe('{"matches":[]}');
	expect(spawn).toHaveBeenCalledWith(
		'/custom/copilot',
		[...expected, ...(responseOnly ? ['--output-format', 'json', '--stream', 'off', '--no-color'] : []), '-p', prompt],
		expect.any(Object),
	);
	expect(DEFAULT_SETTINGS.model).toBe('claude-sonnet-4.5');
});

test('preserves long JSON strings instead of parsing text-renderer line wrapping', async () => {
	const reason = 'Directly records the decision about Project Blue and its planned release date. '.repeat(3);
	const content = JSON.stringify({ matches: [{ path: 'Notes/Project Blue.md', score: 1, reason }] });
	mockOutput(events(content));
	const client = new CopilotClientManager({} as App, DEFAULT_SETTINGS);
	const output = await client.sendPrompt('Search', undefined, undefined, {
		model: 'fusion', showWorking: false, responseOnly: true,
	});
	expect(JSON.parse(output).matches[0].reason).toBe(reason);
});

test.each([
	['not JSON', 'invalid JSON event'],
	[JSON.stringify({ type: 'assistant.message', data: { content: '{}' } }), 'before completion'],
	[JSON.stringify({ type: 'result', exitCode: 0 }), 'no final assistant response'],
	[JSON.stringify({ type: 'result', exitCode: 1 }), 'not complete successfully'],
	[JSON.stringify({ type: 'session.error', data: { message: 'Failure' } }), 'session error'],
])('surfaces invalid or incomplete CLI event output: %s', async (output, error) => {
	mockOutput(output);
	const client = new CopilotClientManager({} as App, DEFAULT_SETTINGS);
	await expect(client.sendPrompt('Search', undefined, undefined, {
		model: 'fusion', showWorking: false, responseOnly: true,
	})).rejects.toThrow(error);
});
