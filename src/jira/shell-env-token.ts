import { spawn } from 'child_process';
import { MeetingProcessorSettings } from '../ui/settings-tab';

/**
 * Obsidian is normally launched from Launchpad/Spotlight/Dock on macOS, which makes it a
 * child of launchd's GUI session — NOT a descendant of an interactive login shell. As a
 * result it never sees variables exported only in ~/.zshrc (e.g. JIRA_API_TOKEN), even
 * though those variables work fine for the same commands run from Terminal.
 *
 * This mirrors the well-known technique VS Code's `resolveShellEnv` and the `shell-env`
 * npm package use to solve the identical problem: spawn the user's real login shell in
 * interactive+login mode (so it sources ~/.zshrc/~/.zprofile) and capture the value of a
 * single variable via `printf`, guarded by a timeout in case rc files hang (e.g. on an
 * interactive prompt or a slow oh-my-zsh auto-update check).
 */

const DEFAULT_TIMEOUT_MS = 8000;

/**
 * Spawn the user's login shell and capture the value of a single environment variable
 * as sourced by their shell startup files (~/.zshrc, ~/.zprofile, etc.).
 *
 * Returns undefined if the variable is unset/empty, the shell exits non-zero, or the
 * timeout elapses (the spawned shell is killed in that case).
 */
export function getShellEnvVar(name: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string | undefined> {
	return new Promise((resolve) => {
		const shell = process.env.SHELL || '/bin/zsh';
		let settled = false;
		let out = '';

		let child;
		try {
			child = spawn(shell, ['-ilc', `printf '%s' "$${name}"`], {
				stdio: ['ignore', 'pipe', 'pipe'],
				// Suppress oh-my-zsh's interactive auto-update prompt, which can hang indefinitely.
				env: { ...process.env, DISABLE_AUTO_UPDATE: 'true' },
			});
		} catch (error) {
			console.error('Failed to spawn shell for env capture:', error);
			resolve(undefined);
			return;
		}

		const timeout = setTimeout(() => {
			if (settled) return;
			settled = true;
			child.kill();
			console.warn(`Timed out after ${timeoutMs}ms capturing ${name} from shell environment`);
			resolve(undefined);
		}, timeoutMs);

		child.stdout?.on('data', (data: Buffer) => {
			out += data.toString();
		});

		child.on('error', (error: Error) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			console.error('Error spawning shell for env capture:', error);
			resolve(undefined);
		});

		child.on('close', (code: number) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			if (code !== 0) {
				console.warn(`Shell exited with code ${code} while capturing ${name} from shell environment`);
				resolve(undefined);
				return;
			}
			resolve(out.length > 0 ? out : undefined);
		});
	});
}

// Cache the resolved token for the lifetime of the plugin so we don't re-spawn a login
// shell (which can take 150ms-2s depending on shell startup work) on every JIRA query.
let cachedTokenPromise: Promise<string | undefined> | null = null;

/**
 * Resolve the JIRA API token to use for the jira CLI, in priority order:
 *   1. process.env.JIRA_API_TOKEN — already present in Obsidian's own environment
 *      (e.g. if launchctl setenv was used, or Obsidian was launched from a shell)
 *   2. Shell-captured value of JIRA_API_TOKEN (cached after first resolution) — this is
 *      the terminal-verified value the user's `jira` CLI setup actually authenticates
 *      with, and is the primary intended path for this feature.
 *   3. settings.jiraApiToken — last-resort manual override. This field is shared with
 *      the REST fallback's Basic Auth and can go stale independently of the CLI's
 *      working credentials (e.g. an expired Atlassian API token saved in plugin
 *      settings), so it must NOT take priority over a working shell-sourced token or
 *      the CLI query silently authenticates with the wrong/expired token and returns
 *      an empty result set instead of using the token that's actually valid.
 */
export async function resolveJiraApiToken(settings: MeetingProcessorSettings): Promise<string | undefined> {
	if (process.env.JIRA_API_TOKEN) {
		return process.env.JIRA_API_TOKEN;
	}

	if (!cachedTokenPromise) {
		cachedTokenPromise = getShellEnvVar('JIRA_API_TOKEN');
	}

	const shellToken = await cachedTokenPromise;
	if (shellToken) {
		return shellToken;
	}

	if (settings.jiraApiToken) {
		return settings.jiraApiToken;
	}

	return undefined;
}

/** Test helper: clear the in-memory token cache so tests can exercise fresh resolution. */
export function resetShellEnvTokenCache(): void {
	cachedTokenPromise = null;
}
