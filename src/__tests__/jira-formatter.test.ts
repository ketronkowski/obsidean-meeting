import { JiraFormatter } from '../jira/formatter';
import { JiraIssuesByAssignee } from '../jira/client';

describe('JiraFormatter', () => {
	it('includes a legend explaining the icons and emoji, above the assignee groups', () => {
		const formatter = new JiraFormatter();
		const grouped: JiraIssuesByAssignee = {
			'Ila Piddington': [
				{
					key: 'GLCP-1',
					summary: 'Do the thing',
					status: 'In Progress',
					issueType: 'Task',
					assignee: 'ila.piddington',
					assigneeDisplayName: 'Ila Piddington',
					url: 'https://hpe.atlassian.net/browse/GLCP-1',
				},
			],
		};

		const section = formatter.createJiraSection(grouped);

		expect(section).toContain('**Key:**');
		// Issue-type icons
		expect(section).toContain('📋 Story');
		expect(section).toContain('🐛 Bug');
		expect(section).toContain('☑️ Task');
		expect(section).toContain('🎯 Epic');
		expect(section).toContain('📝 Subtask');
		// Status emoji
		expect(section).toContain('✅ Done');
		expect(section).toContain('🟢 In Progress');
		expect(section).toContain('🟡 In Review');
		expect(section).toContain('🔴 Blocked');
		expect(section).toContain('🔵 To Do');

		// Legend must appear before the per-assignee groups
		const keyIndex = section.indexOf('**Key:**');
		const assigneeIndex = section.indexOf('### Ila Piddington');
		expect(keyIndex).toBeGreaterThan(-1);
		expect(assigneeIndex).toBeGreaterThan(keyIndex);
	});

	it('does not emit a legend line that could be mistaken for a checkbox item by the extractor', () => {
		const formatter = new JiraFormatter();
		const section = formatter.createJiraSection({});

		// The legend line must not start a markdown checkbox, or JiraKeyExtractor's
		// checkbox-updating regex could misfire on it.
		const legendLine = section.split('\n').find(line => line.includes('**Key:**'));
		expect(legendLine).toBeDefined();
		expect(legendLine!.trim().startsWith('- [')).toBe(false);
	});
});
