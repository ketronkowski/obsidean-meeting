# Transcript Cleaning Skill

## Purpose
Clean up meeting transcripts from various sources, removing timestamps, URLs, and formatting artifacts while preserving conversation flow.

## Supported Formats

### Format 1: Direct Teams Paste
**Characteristics:**
- Speaker name on its own line
- Timestamp on next line with profile URL
- Verbose format: "HH:MM:SS AM/MM → https://teams.microsoft.com/..."

**Cleaning:**
- Remove timestamp lines entirely
- Keep speaker names
- Keep spoken content
- Remove blank lines between messages

### Format 2: Downloaded from Teams
**Characteristics:**
- Combined speaker and timestamp: "**Speaker Name** HH:MM AM"
- Bold formatting on speaker name

**Cleaning:**
- Extract speaker name
- Remove timestamps
- Remove bold formatting
- Preserve content

### Format 3: .docx Exported
**Characteristics:**
- Plain text with leading spaces
- No special formatting
- Speaker and time may be on same line

**Cleaning:**
- Remove leading/trailing whitespace
- Remove timestamps
- Normalize spacing

### Format 4: Simple/Generic
**Characteristics:**
- Minimal formatting
- Various timestamp patterns

**Cleaning:**
- Remove common timestamp patterns
- Clean up spacing
- Preserve speaker attribution

## Output Format
```
Speaker Name
Content of what they said

Another Speaker
Content of what they said
```

Clean, readable format with speaker names and content only.
