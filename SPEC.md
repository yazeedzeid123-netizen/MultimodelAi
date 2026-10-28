# AURA Product Specification

## Purpose

AURA helps a person reflect on their day using a written journal and any optional combination of image, audio, and video. It is a wellness reflection companion, not a medical product or diagnostic tool.

## Functional requirements

- Provide a responsive landing page, dashboard, daily reflection workspace, results, history, and privacy settings.
- Support text-only, media-only, and mixed-modality analysis. No modality is mandatory.
- Allow the user to preview and remove media before explicit submission.
- Present reflection, evidence summary, possible themes, strengths, challenges, suggestions, a question, and uncertainty separately.
- Let the user correct or reject an interpretation.
- Keep saving optional; provide deletion controls for saved reflections.
- Include a deterministic mock workflow that needs no API keys or model downloads.
- Display the exact footer text “Copyrights for Dr Shimaa Zeid” on every website page, with readable contrast and spacing at mobile and desktop sizes.

## Non-functional requirements

- Keep the teaching models, production adapters, backend, frontend, training, and evaluation concerns separated.
- Validate uploads by size, format, and basic integrity; use safe temporary files and avoid logging private content.
- Do not require external AI services for local startup or the test suite.
- Provide clear loading, success, empty, and error states and accessible keyboard controls.
- Do not fabricate histories, measurements, provider usage, or evaluation results.

## Evidence and uncertainty

Every observation must retain its source and category: direct observation, user statement, or tentative interpretation. Explicitly reported feelings remain user statements. Appearance, facial expression, voice, or posture cannot establish a person's internal state. Missing modalities are not negative evidence. Poor-quality or contradictory evidence narrows conclusions and must remain visible.

Fusion outcomes are `MATCH`, `PARTIAL`, `CONFLICT`, `SINGLE_MODALITY`, `UNCERTAIN`, `NO_USABLE_INPUT`, and `PROVIDER_FAILURE`. Fusion is deterministic and evidence-based; a language model may phrase a reflection but may not override evidence or uncertainty.

## Data handling

Development defaults should process media in temporary storage and not persist raw media. Reflections are not saved unless the user opts in. Any external provider data transfer must be disclosed before use when consent is required. Logs must exclude raw journal content, media, and credentials. Privacy promises must match verified implementation behavior.

## Model selection and limitations

The backend supports an optional OpenAI-compatible provider selected through server-only model identifier environment variables. Vision descriptions, speech transcription, and structured reflection are separate capabilities. No model identifier is enabled by default. Verify endpoint compatibility, current model terms, and provider data handling before configuration. Similarity scores and generated confidence values are not calibrated probabilities. No emotion classifier is a source of ground truth for internal feelings.

## Evaluation targets

Initial targets (not measured claims): deterministic tests pass; mock analysis works without credentials; missing modalities do not crash processing; invalid uploads fail clearly; provider failures have controlled fallback; and saved-record authorization is enforced when accounts are enabled. Report actual results and environment only after running the checks.

## Current implementation limitations

Without server-side provider configuration, written text uses a deterministic keyword-based stress estimate and media is marked skipped. Optional provider inference is consent-gated, but no real provider credential was available during development, so live inference was not verified. Video processing also requires FFmpeg/ffprobe and was tested with fake extraction only. Browser-saved history uses local storage and is not encrypted, synced, or account-protected. The API does not persist records. Authentication, transformer teaching code, training, evaluation, and production deployment configuration remain unimplemented.