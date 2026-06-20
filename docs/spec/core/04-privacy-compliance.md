# Core Privacy + Compliance

Status: locked for MVP

## Principle

Carry is privacy-first, but privacy/compliance behavior is configurable.

The platform should support deployments where privacy filtering is enabled, disabled, or replaced by a different implementation. For Doctor Mode, the intended default is privacy filtering enabled.

Important positioning:

```text
Carry provides a privacy-first / compliance-oriented architecture.
It is not, by itself, a legal compliance guarantee.
```

Do not claim “HIPAA-compliant” unless the deployment, hosting, BAAs, access controls, policies, audit procedures, and organizational controls are actually in place.

---

## Privacy filter provider

MVP uses OpenAI Privacy Filter:

```text
https://huggingface.co/openai/privacy-filter
```

The privacy provider should be configurable.

Default architecture:

```text
configurable provider
local default
```

Supported/future provider modes:

```text
local_python_transformers
local_transformers_js
external_service
noop_disabled
```

For MVP, implementation can choose the fastest local path depending on backend stack, but the spec expects the privacy layer to be provider-driven.

---

## What Privacy Filter detects

OpenAI Privacy Filter detects these categories:

```text
account_number
private_address
private_email
private_person
private_phone
private_url
private_date
secret
```

These map well to the core generic privacy layer.

Profession-specific packs can add more domain-specific rules.

Example:

```text
Doctor Mode adds healthcare PHI rules.
Lawyer Mode may add privileged matter/client identifiers.
Founder Mode may add customer/contact/company confidentiality rules.
```

---

## Privacy pipeline

Every transcript chunk goes through the privacy layer immediately after ingestion.

Flow:

```text
raw transcript chunk
  → privacy filter
  → detected spans
  → redaction/tokenization
  → sanitized transcript chunk
  → profession processor / LLM
```

If privacy is enabled, downstream LLM processing should use sanitized transcript text by default.

If privacy is disabled, downstream LLM processing may receive raw transcript text.

Locked behavior:

```text
privacy enabled → sanitized transcript sent to LLM
privacy disabled → raw transcript can be sent to LLM
```

---

## Redaction style

Detected sensitive spans should be replaced with stable numbered placeholders.

Example:

```text
Raw:
My name is Ravi Sharma and my phone number is 98765 43210.

Sanitized:
My name is [PRIVATE_PERSON_1] and my phone number is [PRIVATE_PHONE_1].
```

Do not use unnumbered placeholders like `[PRIVATE_PERSON]` because the LLM may need to track multiple people consistently.

Do not simply remove spans because sentence structure and clinical/business meaning may be lost.

---

## Placeholder stability

Placeholders should be stable within a session.

If the same entity appears multiple times in a conversation, it should ideally receive the same placeholder.

Example:

```text
Ravi Sharma → [PRIVATE_PERSON_1]
Ravi → [PRIVATE_PERSON_1] if confidently linked
```

For MVP, exact entity linking can be best-effort.

---

## Redaction map

Carry should support storing a redaction map.

The redaction map links placeholders to original values.

Example:

```json
{
  "[PRIVATE_PERSON_1]": {
    "label": "private_person",
    "value": "Ravi Sharma",
    "confidence": 0.99
  },
  "[PRIVATE_PHONE_1]": {
    "label": "private_phone",
    "value": "98765 43210",
    "confidence": 0.98
  }
}
```

Redaction map storage is configurable by retention policy.

MVP default:

```text
store redaction map in SQLite for demo/debug
mark as restricted/sensitive
```

Production direction:

```text
encrypt redaction maps
restrict access
support deletion/retention policies
separate identity vault from normal app data
```

---

## Raw transcript retention

Raw transcript retention is configurable.

Default MVP policy:

```text
retain_raw_until_privacy_filter_then_delete
```

Available policies:

```text
never_store_raw
retain_raw_until_privacy_filter_then_delete
retain_raw_encrypted
retain_raw_for_debug_local_only
```

For demo/local development, raw transcript may be retained only if explicitly configured.

When raw transcript is deleted, Carry should still retain:

```text
sanitized transcript
privacy labels
redaction metadata if enabled
audit events
```

---

## Healthcare-specific PHI rules

Core privacy layer handles generic PII.

Healthcare-specific PHI is handled by Doctor Mode configuration and Doctor-specific privacy rules.

Doctor Mode may add recognizers/rules for:

```text
medical_record_number
insurance_id
policy_number
national_id / Aadhaar / SSN
hospital_patient_id
facility / clinic names
room / bed numbers
pharmacy identifiers
lab accession numbers
rare disease references that may identify a person
```

Core should provide extension hooks for profession-specific privacy policies.

---

## Dates and clinical durations

Dates are sensitive, but in many professions they can also be operationally important.

Locked behavior:

```text
date handling is profession-specific
```

For Doctor Mode:

```text
preserve relative clinical durations
preserve clinically necessary timing
redact direct identifiers such as exact DOB when appropriate
```

Examples:

```text
"fever for three days" → keep
"symptoms started yesterday" → keep or normalize clinically
"follow up in one week" → keep, because it drives follow-up action
"DOB 12 Jan 1980" → redact or transform to age/age band
```

This avoids destroying clinical meaning while still minimizing direct identifiers.

---

## Privacy failure behavior

If privacy filtering fails, behavior is configurable.

Default when privacy is enabled:

```text
block downstream LLM processing
```

Do not silently continue with raw transcript when privacy is enabled.

Allowed modes:

```yaml
privacy:
  on_failure: block # block | allow_raw | allow_with_warning
```

MVP default:

```yaml
privacy:
  on_failure: block
```

If privacy is disabled, privacy filter failure is irrelevant because the filter is not in the pipeline.

---

## Audit logging

Privacy events must be audited without logging raw sensitive values.

Audit event should include:

```text
session_id
chunk_id
privacy_provider
privacy_enabled
labels_detected
counts_by_label
redaction_count
raw_retention_policy
raw_deleted: true/false
failure/success status
timestamp
```

Do not log raw private values in the audit log.

Example:

```json
{
  "event_type": "privacy_filter_completed",
  "session_id": "session_001",
  "chunk_id": "chunk_003",
  "labels_detected": ["private_person", "private_phone"],
  "counts_by_label": {
    "private_person": 1,
    "private_phone": 1
  },
  "redaction_count": 2,
  "raw_deleted": true
}
```

---

## Rehydration

Some approved external actions may require restoring private values.

Example:

```text
Gmail draft to a patient requires the real patient email.
Calendar invite may require patient name or email.
```

Rehydration should happen only at the execution boundary and only if allowed by policy.

Flow:

```text
LLM generates draft using placeholders
  → action policy checks destination and risk
  → approved action requests rehydration
  → executor replaces placeholders for that destination only
  → tool call executed
  → audit event recorded
```

Rehydration should not modify the stored sanitized transcript.

---

## Config example

`config/app.yml`:

```yaml
privacy:
  enabled: true
  provider: openai_privacy_filter
  runtime: local_default
  mode: deidentify_before_llm
  placeholder_style: stable_numbered
  store_redaction_map: true
  raw_retention_policy: retain_raw_until_privacy_filter_then_delete
  send_raw_text_to_llm: false
  on_failure: block
```

`config/professions/doctor.yml`:

```yaml
privacy:
  enabled: true
  healthcare_phi_rules_enabled: true
  preserve_clinical_durations: true
  preserve_relative_dates: true
  redact_direct_identifiers: true
  date_policy: preserve_clinical_redact_identity_dates
```

---

## Compliance positioning

Carry should be described as:

```text
privacy-first
compliance-oriented
privacy-by-design
redaction/minimization-aware
approval-gated
```

Avoid saying:

```text
HIPAA-compliant
fully anonymized
guaranteed safe
compliance solved
```

Recommended wording:

```text
Carry uses a privacy-first architecture: transcript chunks pass through a privacy filter before LLM processing, sensitive spans are replaced with stable placeholders, raw retention is configurable, actions are audit-logged, and rehydration only happens at approved execution boundaries.
```

---

## Locked answers summary

```text
1. Privacy filter runtime: configurable, local default
2. LLM input: sanitized when privacy enabled, raw when disabled
3. Raw storage default: retain_raw_until_privacy_filter_then_delete
4. Redaction style: stable numbered placeholders
5. Redaction map storage: configurable, stored for MVP/demo
6. Healthcare PHI rules: profession-specific Doctor layer
7. Dates: profession-specific, Doctor preserves clinical durations
8. Compliance wording: privacy-first/compliance-oriented, not guarantee
9. Audit privacy events: yes, no raw sensitive values in audit logs
10. Failure mode: configurable, default block when privacy enabled
```
