# Core Config

Status: locked for MVP

## Principles

Carry uses two configuration layers:

```text
.env files → secrets and current environment credentials
YAML config → product behavior, defaults, models, prompts, processing rules, feature toggles
```

The `.env` file should be kept as it currently is. Do not move existing secrets or connection names yet.

Current `.env` contains:

```text
FASTROUTER_API_KEY
SCALEKIT_ENVIRONMENT_URL
SCALEKIT_CLIENT_ID
SCALEKIT_CLIENT_SECRET
NOTION_CONNECTION_NAME
GOOGLE_CALENDAR_CONNECTION_NAME
```

No secret values should be committed or printed.

---

## Config file layout

MVP uses:

```text
config/app.yml
config/professions/doctor.yml
```

### `config/app.yml`

Global Carry backend configuration.

Contains:

```text
backend settings
LLM defaults
privacy defaults
processing scheduler settings
storage settings
action execution defaults
Scalekit behavior defaults
logging/audit defaults
```

### `config/professions/doctor.yml`

Doctor-specific configuration.

Contains:

```text
DoctorBrain model overrides
DoctorBrain prompt references
Doctor-specific privacy policy
Doctor-specific memory policy
Doctor-specific action policy
Doctor-specific artifact sections
Doctor-specific tool mappings
```

---

## Environment variables

### Required secrets

```env
FASTROUTER_API_KEY=
SCALEKIT_CLIENT_ID=
SCALEKIT_CLIENT_SECRET=
SCALEKIT_ENVIRONMENT_URL=
```

The code may also support `SCALEKIT_ENV_URL` as an alias, but the current `.env` uses:

```env
SCALEKIT_ENVIRONMENT_URL=
```

### Current connection names

For MVP, connection names remain in `.env` because that is how the current Scalekit setup is configured.

```env
NOTION_CONNECTION_NAME=
GOOGLE_CALENDAR_CONNECTION_NAME=
```

Future connection names may be moved to workspace/database configuration, but not now.

### Not currently present, but may be added later

```env
GMAIL_CONNECTION_NAME=
SLACK_CONNECTION_NAME=
GITHUB_CONNECTION_NAME=
GOOGLE_SHEETS_CONNECTION_NAME=
```

---

## LLM configuration

LLM settings are config-driven, not environment-driven.

The API key comes from `.env`, but model behavior comes from YAML.

### Global default

`config/app.yml` should define global defaults:

```yaml
llm:
  provider: fastrouter
  base_url: https://api.fastrouter.ai/api/v1
  default_model: anthropic/claude-opus-4.7
  temperature: 0.1
  max_tokens: 6000
  response_format: json
```

### Profession override

`config/professions/doctor.yml` can override global defaults:

```yaml
llm:
  model: anthropic/claude-opus-4.7
  temperature: 0.05
  max_tokens: 7000
```

Resolution order:

```text
profession-specific config
  → global config default
  → startup validation error if required value missing
```

---

## Prompt configuration

Prompts should live in separate prompt files, referenced by YAML.

Do not hardcode large prompts directly in code.

Example:

```yaml
prompts:
  incremental_pass: prompts/doctor/incremental_pass.md
  final_pass: prompts/doctor/final_pass.md
  memory_update: prompts/doctor/memory_update.md
  action_planner: prompts/doctor/action_planner.md
```

Benefits:

```text
prompts can be edited without changing code
profession packs can own their own prompts
prompt versions can be tracked
demo prompts can differ from production prompts
```

---

## Processing configuration

Streaming processing must be configurable.

`config/app.yml` example:

```yaml
processing:
  incremental_enabled: true
  incremental_debounce_ms: 8000
  min_new_chunks_for_incremental_pass: 4
  max_incremental_passes_per_session: 20
  final_pass_on_session_end: true
  final_pass_required: true
```

Meaning:

```text
incremental_enabled → run draft processing while conversation is active
incremental_debounce_ms → wait this long after new chunks before processing
min_new_chunks_for_incremental_pass → avoid processing every tiny update
final_pass_on_session_end → run a final full-session refinement
final_pass_required → completed sessions must have a final pass
```

---

## Privacy configuration

Privacy behavior is toggleable.

Global default lives in `config/app.yml`:

```yaml
privacy:
  enabled: true
  provider: openai_privacy_filter
  mode: deidentify_before_llm
  store_redaction_map: true
  send_raw_text_to_llm: false
```

Profession override lives in `config/professions/doctor.yml`:

```yaml
privacy:
  enabled: true
  healthcare_phi_rules_enabled: true
  preserve_clinical_durations: true
  preserve_relative_dates: true
  redact_direct_identifiers: true
```

Behavior:

```text
If privacy.enabled=false, transcript chunks skip privacy filtering.
If privacy.enabled=true, transcript chunks pass through PrivacyFilterService before LLM processing.
```

Doctor Mode should normally keep privacy enabled, but the platform supports toggling it for testing or local-only deployments.

---

## Memory configuration

Memory is profession-specific, but the core still has an enable/disable toggle.

`config/app.yml`:

```yaml
memory:
  enabled: true
  mode: automatic
  storage: sqlite
```

`config/professions/doctor.yml`:

```yaml
memory:
  enabled: true
  agent_decides_what_to_store: true
  store_patient_timeline: true
  store_followups: true
  store_allergy_statements: true
  store_medication_mentions: true
  store_unresolved_questions: true
```

MVP rule:

```text
The profession agent decides what to store, update, ignore, or keep session-only.
```

---

## Action execution configuration

Action execution is toggleable.

`config/app.yml`:

```yaml
actions:
  execution_enabled: false
  proposed_actions_always_generated: true
  executor: scalekit
```

Behavior:

```text
execution_enabled=false → generate proposed actions only
execution_enabled=true → execute actions if allowed by action/risk policy
```

Tool configuration can reference connection names from env.

Example:

```yaml
tools:
  notion:
    enabled: true
    connection_name_env: NOTION_CONNECTION_NAME
  google_calendar:
    enabled: true
    connection_name_env: GOOGLE_CALENDAR_CONNECTION_NAME
  gmail:
    enabled: false
    connection_name_env: GMAIL_CONNECTION_NAME
  google_sheets:
    enabled: false
    connection_name_env: GOOGLE_SHEETS_CONNECTION_NAME
  slack:
    enabled: false
    connection_name_env: SLACK_CONNECTION_NAME
  github:
    enabled: false
    connection_name_env: GITHUB_CONNECTION_NAME
```

---

## Storage configuration

SQLite is the MVP storage layer.

`config/app.yml`:

```yaml
storage:
  provider: sqlite
  sqlite_path: data/carry.sqlite
```

SQLite stores:

```text
sessions
transcript chunks
privacy redaction maps
sanitized chunks
incremental states
final outputs
memory items
action plans
action execution results
audit events
```

---

## Scalekit configuration

Scalekit secrets come from `.env`.

`config/app.yml` controls behavior:

```yaml
scalekit:
  enabled: true
  environment_url_env: SCALEKIT_ENVIRONMENT_URL
  client_id_env: SCALEKIT_CLIENT_ID
  client_secret_env: SCALEKIT_CLIENT_SECRET
```

Tool-specific connection names currently come from env via `connection_name_env` fields.

---

## Config validation

Backend should fail fast on startup if required config or secrets are missing.

Strict validation should check:

```text
FASTROUTER_API_KEY exists if LLM calls are enabled
SCALEKIT_CLIENT_ID exists if Scalekit is enabled
SCALEKIT_CLIENT_SECRET exists if Scalekit is enabled
SCALEKIT_ENVIRONMENT_URL or SCALEKIT_ENV_URL exists if Scalekit is enabled
required prompt files exist
configured model names exist
SQLite path parent directory is creatable
connection name env vars exist for enabled tools
```

If an optional tool is disabled, its connection env var is not required.

---

## Environment profiles

No separate profiles for MVP.

Use a single config set:

```text
config/app.yml
config/professions/doctor.yml
```

Profiles such as `dev`, `demo`, and `prod` can be added later.

---

## Example MVP config

### `config/app.yml`

```yaml
app:
  name: Carry
  mode: backend

llm:
  provider: fastrouter
  base_url: https://api.fastrouter.ai/api/v1
  default_model: anthropic/claude-opus-4.7
  temperature: 0.1
  max_tokens: 6000

processing:
  incremental_enabled: true
  incremental_debounce_ms: 8000
  min_new_chunks_for_incremental_pass: 4
  final_pass_on_session_end: true
  final_pass_required: true

privacy:
  enabled: true
  provider: openai_privacy_filter
  mode: deidentify_before_llm
  store_redaction_map: true
  send_raw_text_to_llm: false

memory:
  enabled: true
  mode: automatic
  storage: sqlite

actions:
  execution_enabled: false
  proposed_actions_always_generated: true
  executor: scalekit

storage:
  provider: sqlite
  sqlite_path: data/carry.sqlite

scalekit:
  enabled: true
  environment_url_env: SCALEKIT_ENVIRONMENT_URL
  client_id_env: SCALEKIT_CLIENT_ID
  client_secret_env: SCALEKIT_CLIENT_SECRET

tools:
  notion:
    enabled: true
    connection_name_env: NOTION_CONNECTION_NAME
  google_calendar:
    enabled: true
    connection_name_env: GOOGLE_CALENDAR_CONNECTION_NAME
```

### `config/professions/doctor.yml`

```yaml
profession: doctor

llm:
  model: anthropic/claude-opus-4.7
  temperature: 0.05
  max_tokens: 7000

prompts:
  incremental_pass: prompts/doctor/incremental_pass.md
  final_pass: prompts/doctor/final_pass.md
  memory_update: prompts/doctor/memory_update.md
  action_planner: prompts/doctor/action_planner.md

privacy:
  enabled: true
  healthcare_phi_rules_enabled: true
  preserve_clinical_durations: true
  preserve_relative_dates: true
  redact_direct_identifiers: true

memory:
  enabled: true
  agent_decides_what_to_store: true
  store_patient_timeline: true
  store_followups: true
  store_allergy_statements: true
  store_medication_mentions: true
  store_unresolved_questions: true

artifacts:
  generate:
    - speaker_role_inference
    - clinical_fact_extraction
    - soap_note
    - missing_information
    - safety_flags
    - icd10_suggestions
    - patient_summary
    - follow_up_plan
    - action_plan
```
