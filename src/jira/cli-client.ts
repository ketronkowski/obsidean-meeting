import { spawn } from 'child_process';
import { MeetingProcessorSettings } from '../ui/settings-tab';
import { JiraIssue } from './client';
import { buildSpawnEnv } from '../voice-analysis-client';
import { resolveJiraApiToken } from './shell-env-token';

const DEFAULT_TIMEOUT_MS = 20_000;

/** Distinguishable error type so callers (JiraManager) can log the specific CLI failure
 *  reason before falling back to the REST API path. */
export class JiraCliError extends Error {
	constructor(message: string, public readonly cause?: unknown) {
		super(message);
		this.name = 'JiraCliError';
	}
}

interface RawJiraCliIssue {
	key: string;
	fields?: {
		summary?: string;
		status?: { name?: string };
		issuetype?: { name?: string };
		assignee?: { accountId?: string; displayName?: string } | null;
	};
}

/**
 * Queries JIRA sprint issues via the `jira` CLI (ankitpokhrel/jira-cli), using a token
 * captured from the user's shell environment (see shell-env-token.ts) rather than the
 * plugin's own REST credentials. This lets a terminal-verified, already-working `jira`
 * CLI auth setup become the preferred path for standup JIRA queries, with the existing
 * direct REST API (JiraApiClient) retained as a fallback in JiraManager.
 *
 * Design notes (see plan.md / research report for full rationale):
 *  - `jira issue list -q "<JQL>" --raw` produces clean JSON for issues.
 *  - `jira sprint list --raw` does NOT produce JSON despite the flag existing (confirmed
 *    empirically — it always prints the same tab-delimited table as `--plain`), so the
 *    active sprint lookup below uses `--plain --no-headers --columns ID,NAME,STATE`
 *    (still tab-delimited, but a stable, minimal, script-friendly format) instead.
 *  - There is no `--board` flag on any query command in jira-cli — board scoping is
 *    entirely determined by the `board.id` configured in the user's `jira init` config
 *    (`~/.config/.jira/.config.yml`), which is why this client resolves the *actual*
 *    active sprint ID for that configured board via `jira sprint list` first, then
 *    queries `jira issue list -q "sprint in (<ids>)"` — NOT `sprint in openSprints()`.
 *    An earlier version used `project = <key> AND sprint in openSprints()`, which is
 *    unscoped to any particular board/team and returned every open sprint across the
 *    whole project (all teams sharing that Jira project), not just the configured team's
 *    board — this surfaced as "JIRA works, but shows other teams' issues, not mine".
 */
export class JiraCliClient {
	private settings: MeetingProcessorSettings;

	constructor(settings: MeetingProcessorSettings) {
		this.settings = settings;
	}

	isEnabled(): boolean {
		return !!this.settings.jiraCliEnabled;
	}

	/**
	 * Query the active sprint's issues for the board configured in the jira CLI's own
	 * config file (NOT the plugin's boardId setting — there's no CLI flag to override
	 * board scoping; see class doc comment).
	 * Throws JiraCliError on any failure (binary missing, auth failure, no active sprint,
	 * timeout, bad JSON) so JiraManager can fall back to the REST API path.
	 */
	async searchActiveSprintIssues(teamName?: string, maxResults: number = 100): Promise<JiraIssue[]> {
		const token = await resolveJiraApiToken(this.settings);
		if (!token) {
			throw new JiraCliError('Could not resolve JIRA_API_TOKEN from settings, environment, or shell');
		}

		const env = { ...buildSpawnEnv(), JIRA_API_TOKEN: token };

		const sprintIds = await this.getActiveSprintIds(env, teamName);
		if (sprintIds.length === 0) {
			throw new JiraCliError('No active sprint found for the board configured in the jira CLI (check `jira init` / board.id in ~/.config/.jira/.config.yml)');
		}

		// NOTE: `-q`/`--jql` must contain only the filter clause. jira-cli always appends
		// its own `ORDER BY <--order-by field> <ASC|DESC>` clause (default "created DESC")
		// after whatever JQL is supplied here — including an ORDER BY in this string causes
		// a duplicate/malformed clause and a 400 "Expecting either 'ASC' or 'DESC'" error.
		// Sorting/grouping by assignee happens downstream in groupIssuesByAssignee(), so no
		// ordering is needed here.
		const jql = `sprint in (${sprintIds.join(', ')})`;
		const args = ['issue', 'list', '-q', jql, '--raw', '--paginate', `0:${maxResults}`];

		const { stdout } = await this.runCli(args, env);

		let raw: RawJiraCliIssue[];
		try {
			raw = JSON.parse(stdout);
		} catch (error) {
			throw new JiraCliError(`Failed to parse jira CLI JSON output: ${(error as Error).message}`, error);
		}

		if (!Array.isArray(raw)) {
			throw new JiraCliError('jira CLI JSON output was not an array of issues');
		}

		return this.transformIssues(raw);
	}

	/**
	 * Resolve the active sprint ID(s) for the board configured in the jira CLI's config
	 * file. Usually there's exactly one active sprint (single-board setups like this
	 * one), but if the CLI reports several (e.g. a config change or multi-board project)
	 * and a teamName was supplied, prefer sprints whose name contains it — mirroring
	 * JiraApiClient's existing "prefer a sprint name matching the team" REST logic.
	 */
	private async getActiveSprintIds(env: NodeJS.ProcessEnv, teamName?: string): Promise<string[]> {
		const args = ['sprint', 'list', '--state', 'active', '--plain', '--no-headers', '--columns', 'ID,NAME,STATE'];
		const { stdout } = await this.runCli(args, env);

		const rows = stdout
			.split('\n')
			.map(line => line.trim())
			.filter(Boolean)
			.map(line => line.split('\t').filter(field => field.length > 0));

		if (rows.length === 0) {
			return [];
		}

		if (rows.length === 1 || !teamName) {
			return rows.map(row => row[0]);
		}

		const matching = rows.filter(row => row[1]?.toLowerCase().includes(teamName.toLowerCase()));
		return (matching.length > 0 ? matching : rows).map(row => row[0]);
	}

	private transformIssues(issues: RawJiraCliIssue[]): JiraIssue[] {
		return issues.map(issue => ({
			key: issue.key,
			summary: issue.fields?.summary || 'No summary',
			status: issue.fields?.status?.name || 'Unknown',
			issueType: issue.fields?.issuetype?.name || 'Task',
			assignee: issue.fields?.assignee?.accountId || null,
			assigneeDisplayName: issue.fields?.assignee?.displayName || 'Unassigned',
			url: `${this.settings.jiraBaseUrl}/browse/${issue.key}`,
		}));
	}

	private runCli(args: string[], env: NodeJS.ProcessEnv): Promise<{ stdout: string; stderr: string }> {
		return new Promise((resolve, reject) => {
			const cliPath = this.settings.jiraCliPath || 'jira';
			let settled = false;
			let stdout = '';
			let stderr = '';

			let child;
			try {
				child = spawn(cliPath, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
			} catch (error) {
				reject(new JiraCliError(`Failed to spawn jira CLI (${cliPath})`, error));
				return;
			}

			const timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				child.kill();
				reject(new JiraCliError(`jira CLI timed out after ${DEFAULT_TIMEOUT_MS}ms`));
			}, DEFAULT_TIMEOUT_MS);

			child.stdout?.on('data', (data: Buffer) => {
				stdout += data.toString();
			});
			child.stderr?.on('data', (data: Buffer) => {
				stderr += data.toString();
			});

			child.on('error', (error: Error & { code?: string }) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (error.code === 'ENOENT') {
					reject(new JiraCliError(`jira CLI not found at "${cliPath}"`, error));
				} else {
					reject(new JiraCliError(`Failed to spawn jira CLI: ${error.message}`, error));
				}
			});

			child.on('close', (code: number) => {
				if (settled) return;
				settled = true;
				clearTimeout(timeout);
				if (code !== 0) {
					reject(new JiraCliError(`jira CLI exited with code ${code}: ${stderr.trim() || '(no stderr output)'}`));
					return;
				}
				resolve({ stdout, stderr });
			});
		});
	}
}
