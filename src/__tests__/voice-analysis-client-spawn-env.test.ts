import { buildSpawnEnv } from '../voice-analysis-client';

describe('buildSpawnEnv', () => {
	const originalPath = process.env.PATH;

	afterEach(() => {
		process.env.PATH = originalPath;
	});

	test('prepends Homebrew/user bin dirs missing from a minimal GUI-app PATH', () => {
		// Simulates the restricted PATH Electron apps (like Obsidian) inherit when
		// launched by launchd/Finder rather than an interactive shell.
		process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

		const env = buildSpawnEnv();
		const dirs = (env.PATH ?? '').split(':');

		expect(dirs).toContain('/opt/homebrew/bin');
		expect(dirs).toContain('/usr/local/bin');
		// Original entries must be preserved.
		expect(dirs).toContain('/usr/bin');
		expect(dirs).toContain('/bin');
	});

	test('does not duplicate dirs already present on PATH', () => {
		process.env.PATH = '/opt/homebrew/bin:/usr/bin:/bin';

		const env = buildSpawnEnv();
		const dirs = (env.PATH ?? '').split(':');
		const occurrences = dirs.filter(d => d === '/opt/homebrew/bin').length;

		expect(occurrences).toBe(1);
	});

	test('preserves other environment variables', () => {
		process.env.PATH = '/usr/bin';
		process.env.SOME_TEST_VAR = 'hello';

		const env = buildSpawnEnv();

		expect(env.SOME_TEST_VAR).toBe('hello');
		delete process.env.SOME_TEST_VAR;
	});
});
