# General Meeting Processing Skill

## Purpose
Process general (non-standup) meeting notes through a complete workflow.

## Workflow

### 1. Attendee Extraction
**From Screenshots:**
- Detect `![[SCR-*.png]]` references in the meeting note
- Use vision capabilities to extract names from Teams screenshots
- Create missing People profiles
- Update `## Attendees` section with bullet list of names linked to profiles

**From Content (no screenshots):**
- Extract names mentioned in meeting content
- Search existing People profiles for matches
- Link known attendees

### 2. Transcript Cleaning
**Skip if:** Meeting has `## Copilot Summary` with content (Teams already processed it)

**Otherwise:**
- Detect transcript format (4 variants)
- Apply appropriate cleaning logic
- Remove timestamps, profile URLs, and formatting artifacts
- Preserve speaker names and conversation flow

### 3. Summary Generation
- Analyze cleaned transcript or existing content
- Generate concise summary with:
  - Key discussion points
  - Decisions made
  - Action items
  - Follow-up items
- Insert into `## Summary` section

## Output Format
Update the meeting file with:
- Populated `## Attendees` section
- Cleaned `## Transcript` section (if applicable)
- Generated `## Summary` section
