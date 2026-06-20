# Core Transcript Ingestion

Status: locked for MVP

## Purpose

Carry receives streaming transcript chunks from an external transcript source and attaches them to a conversation session.

Carry does not own audio capture in the MVP. It receives text chunks from:

```text
Omi / pendant pipeline
browser or mobile transcription service
uploaded audio transcription pipeline
third-party transcription API
simulator
```

---

## Session creation

Carry supports both session creation patterns:

```text
1. Explicit session creation before chunks are sent
2. Automatic session creation on first chunk if enough metadata is provided
```

For MVP/demo, explicit session creation is preferred for clarity.

---

## Start session payload

A session represents one professional conversation.

Generic start payload:

```json
{
  "profession": "doctor",
  "entity_type": "patient",
  "entity_id": "patient_123",
  "source": "simulator",
  "metadata": {
    "encounter_type": "outpatient_visit",
    "location": "demo_clinic",
    "started_by": "demo_user"
  }
}
```

### Required fields for generic core

```text
profession
source
```

### Optional fields for generic core

```text
entity_type
entity_id
metadata
```

### Doctor MVP rule

For the Doctor demo, `entity_id` should be provided when available.

Architecturally, unknown-patient sessions are allowed, but demo flow should use a known patient/entity where possible.

```text
Required for demo: entity_type=patient, entity_id=patient_123
Optional in architecture: unknown patient session
```

---

## Session object

Conceptual session record:

```json
{
  "session_id": "session_001",
  "profession": "doctor",
  "entity_type": "patient",
  "entity_id": "patient_123",
  "source": "simulator",
  "status": "active",
  "started_at": "2026-06-20T10:30:00Z",
  "ended_at": null,
  "metadata": {}
}
```

Session statuses:

```text
created
active
processing
completed
failed
archived
```

---

## Transcript chunk payload

Carry receives chunks as the transcript stream progresses.

Payload:

```json
{
  "session_id": "session_001",
  "chunk_id": "chunk_001",
  "speaker": "Person 1",
  "text": "What brings you in today?",
  "start_ms": 0,
  "end_ms": 2100,
  "confidence": 0.91,
  "is_final": true,
  "received_at": "2026-06-20T10:30:02Z"
}
```

### Required fields

```text
session_id
chunk_id
speaker
text
```

### Optional fields

```text
start_ms
end_ms
confidence
is_final
received_at
metadata
```

If `received_at` is missing, Carry should set it at ingestion time.

---

## Speaker labels

Carry accepts arbitrary speaker labels from the transcript source.

Examples:

```text
Person 1
Person 2
Speaker A
Speaker B
unknown
clinician
patient
```

Internally, Carry may normalize speakers to stable IDs:

```text
speaker_1
speaker_2
speaker_3
```

The original source speaker label should still be preserved.

Example normalized representation:

```json
{
  "speaker_id": "speaker_1",
  "source_speaker_label": "Person 1",
  "text": "What brings you in today?"
}
```

Profession-specific logic can later infer semantic roles, e.g.

```text
speaker_1 → clinician_likely
speaker_2 → patient_likely
```

---

## Chunk updates and mutation

Streaming transcription systems may revise earlier transcript chunks.

Carry supports replacement/update by `chunk_id`.

Rules:

```text
If a new chunk_id is received → insert chunk
If an existing chunk_id is received → update/replace prior chunk
If is_final=false → chunk may be revised later
If is_final=true → chunk is considered stable, but updates are still accepted if source sends them
```

All updates should be auditable.

Conceptual fields:

```text
version
created_at
updated_at
superseded_at
```

For MVP, keeping only latest text per `chunk_id` is acceptable, but audit logging should record that an update happened.

---

## Idempotency

Ingestion is idempotent by `chunk_id` within a session.

If the same `session_id + chunk_id` arrives multiple times with identical content, Carry should not duplicate it.

If the same `session_id + chunk_id` arrives with changed content, Carry should treat it as an update.

---

## Conversation end signaling

Carry supports multiple ways to end a session:

```text
1. Explicit end_session call
2. Transcript event chunk with event_type=session_end
3. Timeout after inactivity
```

All three should be supported architecturally.

For MVP, explicit end session is preferred, with timeout as fallback.

### End session payload

```json
{
  "session_id": "session_001",
  "ended_at": "2026-06-20T10:45:00Z",
  "reason": "source_completed"
}
```

When a session ends, Carry must trigger the final processing pass.

---

## Processing triggers

Incremental processing is triggered by both chunk count and debounce interval.

A processing pass should run when:

```text
enough new chunks have arrived
AND debounce interval has elapsed
```

Example config:

```yaml
processing:
  incremental_enabled: true
  incremental_debounce_ms: 8000
  min_new_chunks_for_incremental_pass: 4
  final_pass_on_session_end: true
```

This prevents excessive LLM calls while still keeping the session state updated during the conversation.

---

## Raw transcript handling

Raw transcript retention is configurable.

Options:

```text
retain_raw_encrypted
retain_raw_until_privacy_filter_then_delete
never_store_raw
```

Default MVP recommendation:

```text
retain_raw_until_privacy_filter_then_delete
```

However, during local development/demo, raw transcript retention may be enabled for debugging.

Regardless of raw retention policy, Carry should store:

```text
sanitized transcript text
privacy labels/redaction metadata
processing outputs
audit events
```

---

## Privacy handoff

Every ingested chunk is immediately sent to the privacy layer before any LLM/profession processing.

Flow:

```text
receive chunk
  → validate payload
  → normalize speaker
  → privacy filter
  → store sanitized chunk
  → update session buffer
  → schedule processing pass
```

The profession processor should consume sanitized chunks by default.

---

## Transcript session buffer

Carry maintains a session buffer containing the ordered transcript state.

The buffer is rebuilt from stored chunks ordered by:

```text
start_ms if available
received_at otherwise
chunk sequence otherwise
```

The session buffer is what incremental and final processing passes use.

Conceptual representation:

```json
[
  {
    "speaker_id": "speaker_1",
    "source_speaker_label": "Person 1",
    "text": "What brings you in today?",
    "start_ms": 0,
    "end_ms": 2100
  },
  {
    "speaker_id": "speaker_2",
    "source_speaker_label": "Person 2",
    "text": "I've had a fever for three days.",
    "start_ms": 2200,
    "end_ms": 5200
  }
]
```

---

## Simulator requirements

The simulator should support both modes:

```text
1. Full transcript at once
2. Streaming chunks with delays
```

Default simulator behavior should mimic streaming chunks.

Simulator should be able to produce:

```text
session start event
multiple transcript chunks
optional chunk updates
session end event
```

For Doctor MVP, simulator should emit anonymous speakers:

```text
Person 1
Person 2
```

DoctorBrain should infer who is likely clinician vs patient later.

---

## Example streaming simulator sequence

```json
{
  "event_type": "session_start",
  "profession": "doctor",
  "entity_type": "patient",
  "entity_id": "patient_demo_001",
  "source": "simulator"
}
```

```json
{
  "event_type": "transcript_chunk",
  "session_id": "session_001",
  "chunk_id": "chunk_001",
  "speaker": "Person 1",
  "text": "Hi, what brings you in today?",
  "is_final": true
}
```

```json
{
  "event_type": "transcript_chunk",
  "session_id": "session_001",
  "chunk_id": "chunk_002",
  "speaker": "Person 2",
  "text": "I've had a sore throat and fever for about three days.",
  "is_final": true
}
```

```json
{
  "event_type": "session_end",
  "session_id": "session_001",
  "reason": "simulator_completed"
}
```

---

## Non-goals

Transcript ingestion does not define:

```text
audio capture
speech-to-text provider selection
speaker diarization implementation
profession-specific extraction
patient identity matching logic
RAG retrieval
artifact generation
Scalekit execution payloads
```

Those are handled in later sections.
