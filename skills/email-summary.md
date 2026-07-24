# Email Summary Skill

## Purpose
Generate a structured summary of an email thread, surfacing what was discussed, any decisions reached, action items, and open questions.

## Output Format

Produce the following sections. Omit a section entirely if it has no content (do not output empty sections or placeholder text).

**What was discussed**
A 2-4 sentence narrative overview of the email thread topic and context.

**Key decisions**
Bullet list of any decisions or conclusions explicitly stated or clearly implied in the thread.

**Action items**
Bullet list of tasks, next steps, or follow-ups mentioned. Attribute each to a person if named (e.g. "Will to investigate PCE metrics").

**Open questions**
Bullet list of unresolved questions or issues still pending at the end of the thread.

## Style Guidelines

- Write in clear, professional English.
- Be concise — each bullet should be one sentence.
- Do not invent information not present in the thread.
- Do not include email metadata (dates, subject lines) in the summary.
- Do not wrap output in code fences or add extra markdown headers beyond those specified.

## Example Output

**What was discussed**
A customer reported that no statistics from their Private Cloud Enterprise (PCE) environment are showing in SIC. The SIC team investigated metrics availability and determined that hpe_pdu3_input_power_watts is not being reported from the customer's OpsRamp tenant.

**Key decisions**
- The missing metric is hpe_pdu3_input_power_watts in the customer's OpsRamp tenant
- PCE is identified as the next team to engage for further investigation

**Action items**
- PCE team to investigate why hpe_pdu3_input_power_watts metric is not being produced in the customer's OpsRamp tenant

**Open questions**
- Whether PCE or OpsRamp is responsible for enabling the missing metric
