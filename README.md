# AURA — Your Daily Wellness Reflection Companion

AURA is a non-clinical reflection experience. The existing responsive website now posts its existing composer inputs to the FastAPI analysis endpoint. With no provider configured, text is assessed using cautious deterministic rules and media is clearly marked skipped. Optional OpenAI-compatible vision, transcription, and text-generation models can be configured server-side.

## Current status

- Implemented: existing Today composer and upload controls; backend multipart submission; opt-in consent before external model calls; configurable image descriptions, speech transcription, video frame/audio extraction (when FFmpeg is installed), deterministic evidence-aware stress estimate, grounded reflection fallback, activity recommendations with YouTube search links, browser-local save/reload/delete, privacy settings disclosure, and responsive footer showing **“Copyrights for Dr Shimaa Zeid”**.
- Not implemented: authentication, server persistence, cross-device history, transformer teaching models, training/evaluation jobs, Colab server, verified specific YouTube videos, or production deployment configuration.
- The current environment has no provider credential and no FFmpeg/ffprobe. Real provider inference and real video extraction were not smoke-tested here. Mock/fake-provider tests cover processing, fallback, uncertainty, and failures.

See [SPEC.md](SPEC.md) for product and evidence constraints.

## Requirements

- Node.js 20.9 or newer (the current environment uses Node 24).
- Python 3.14 or another Python version supported by the pinned packages.

## Install

From the repository root:

```bash
npm --prefix frontend ci
python -m venv .venv
source .venv/bin/activate
python -m pip install -r backend/requirements.txt
```

On Windows PowerShell, activate with `.venv\\Scripts\\Activate.ps1`.

## Run

Start the website:

```bash
npm --prefix frontend run dev
```

Open http://localhost:3000. Start the API in a second terminal:

```bash
source .venv/bin/activate
uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
```

The API health check is http://127.0.0.1:8000/health. The frontend calls the same-origin `/api` path; Next.js proxies it to `AURA_BACKEND_URL` server-side (default `http://127.0.0.1:8000`). This avoids browser loopback and cross-origin failures in forwarded development environments. The frontend shows a clearly labeled local fallback only when the backend cannot be reached.

## Test and build

```bash
PYTHONPATH=backend pytest backend/tests -q
npm --prefix frontend run build
npm --prefix frontend test
npm --prefix frontend run test:e2e
npm --prefix frontend run lint
npm --prefix frontend audit --omit=dev
```

The opt-in Playwright suite uses Chromium fake media devices for live recording tests. Install Chromium with `npx --prefix frontend playwright install chromium`; on Linux images missing browser system libraries, install them with administrator privileges using `npx --prefix frontend playwright install-deps chromium`. Real camera/microphone access requires HTTPS or localhost and explicit browser permission.

## Configure real providers

Copy `.env.example` to `.env`, set `AURA_MODE=provider`, choose provider-supported model identifiers for the three model variables, and add your API key. Keep this file server-side; never expose `AURA_OPENAI_API_KEY` in the frontend. `AURA_MODE=mock` is the default and disables all provider calls. Source `.env` in both the API and frontend shell before starting them:

```bash
set -a
source .env
set +a
```

The frontend displays a consent checkbox when the backend reports an active provider. Without consent, provider processing is rejected. The adapter sends requests to `AURA_OPENAI_BASE_URL` using the configured vision, transcription, and text model identifiers. The provider model IDs must support the requested endpoint and JSON response format; this project does not assume or bundle a model ID.

Test the request through the same URL the browser uses:

```bash
curl http://127.0.0.1:3000/api/ready
curl -F 'text=I felt overwhelmed by the deadline.' http://127.0.0.1:3000/api/analyze
```

FFmpeg and ffprobe are optional. If installed, short supported videos are duration-checked, sampled at up to four representative points, and their audio is extracted for transcription. If extraction tools are missing or extraction fails, the result records the video as skipped/failed.

## Data behavior

Analysis requests send selected journal text and media to the configured AURA backend. When an external provider capability will process the submitted data, the user must opt in on that request. Provider retention is governed by that provider. The API does not persist uploaded media or reflections. “Save to this browser” stores the complete reflection response in local storage; it is not encrypted, synced, or account-protected. Do not use shared browsers for sensitive entries.

## Configuration

`config/config.yaml` contains non-secret development defaults. `.env.example` contains empty secret/model settings and a harmless base URL. Review provider terms and data handling before entering a credential. The stress estimate is a text-grounded heuristic, not a medical or physiological measurement; workload and visual cues alone do not raise its category.