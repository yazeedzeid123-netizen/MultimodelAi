from __future__ import annotations

import base64
import json
import os
from dataclasses import dataclass
from typing import Any

import httpx


class ProviderError(Exception):
    def __init__(self, category: str):
        super().__init__(category)
        self.category = category


@dataclass(frozen=True)
class ProviderCapabilities:
    vision_model: str | None
    transcription_model: str | None
    text_model: str | None

    @property
    def configured(self) -> bool:
        return any((self.vision_model, self.transcription_model, self.text_model))


class OpenAICompatibleProvider:
    """Optional provider adapter; credentials remain server-side."""

    def __init__(self) -> None:
        self.api_key = os.getenv("AURA_OPENAI_API_KEY", "").strip()
        self.base_url = os.getenv("AURA_OPENAI_BASE_URL", "https://api.openai.com/v1").rstrip("/")
        self.capabilities = ProviderCapabilities(
            vision_model=os.getenv("AURA_OPENAI_VISION_MODEL", "").strip() or None,
            transcription_model=os.getenv("AURA_OPENAI_TRANSCRIPTION_MODEL", "").strip() or None,
            text_model=os.getenv("AURA_OPENAI_TEXT_MODEL", "").strip() or None,
        )

    @property
    def ready(self) -> bool:
        mode = os.getenv("AURA_MODE", "mock").strip().casefold()
        return mode == "provider" and bool(self.api_key and self.capabilities.configured)

    def can_process_text(self) -> bool:
        return bool(self.ready and self.capabilities.text_model)

    def can_process_image(self) -> bool:
        return bool(self.ready and self.capabilities.vision_model)

    def can_transcribe(self) -> bool:
        return bool(self.ready and self.capabilities.transcription_model)

    async def _chat(self, model: str, messages: list[dict[str, Any]]) -> str:
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                response = await client.post(
                    f"{self.base_url}/chat/completions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    json={
                        "model": model,
                        "messages": messages,
                        "response_format": {"type": "json_object"},
                        "temperature": 0.2,
                    },
                )
            if response.is_error:
                raise ProviderError(f"provider_http_{response.status_code}")
            payload = response.json()
            content = payload["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise ProviderError("provider_malformed_response")
            return content
        except ProviderError:
            raise
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as error:
            raise ProviderError("provider_request_or_response_error") from error

    async def describe_image(self, content: bytes, mime_type: str, context: str = "") -> dict[str, Any]:
        model = self.capabilities.vision_model
        if not self.ready or not model:
            raise ProviderError("vision_provider_not_configured")
        encoded = base64.b64encode(content).decode("ascii")
        prompt = (
            "Describe only directly visible contextual details that may help the user reflect on their day. "
            "Do not infer stress, emotion, personality, health, or intent from a face, appearance, or scene. "
            "Return JSON with keys observations (array of short strings), limitations (array of strings), and summary (string). "
            "If context is unclear, say so. User-provided context: " + (context[:1200] or "none")
        )
        raw = await self._chat(model, [{
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {"type": "image_url", "image_url": {"url": f"data:{mime_type};base64,{encoded}", "detail": "low"}},
            ],
        }])
        try:
            result = json.loads(raw)
            observations = result["observations"]
            limitations = result.get("limitations", [])
            summary = result["summary"]
            if not isinstance(observations, list) or not all(isinstance(item, str) for item in observations):
                raise ValueError("invalid observations")
            if not isinstance(limitations, list) or not all(isinstance(item, str) for item in limitations):
                raise ValueError("invalid limitations")
            if not isinstance(summary, str):
                raise ValueError("invalid summary")
            return {"observations": observations[:8], "limitations": limitations[:6], "summary": summary[:700]}
        except (json.JSONDecodeError, KeyError, ValueError, TypeError) as error:
            raise ProviderError("vision_malformed_output") from error

    async def transcribe(self, content: bytes, filename: str, mime_type: str) -> str:
        model = self.capabilities.transcription_model
        if not self.ready or not model:
            raise ProviderError("transcription_provider_not_configured")
        try:
            async with httpx.AsyncClient(timeout=60) as client:
                response = await client.post(
                    f"{self.base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    data={"model": model, "response_format": "json"},
                    files={"file": (filename, content, mime_type)},
                )
            if response.is_error:
                raise ProviderError(f"transcription_http_{response.status_code}")
            transcript = response.json().get("text")
            if not isinstance(transcript, str):
                raise ProviderError("transcription_malformed_response")
            return transcript[:12000].strip()
        except ProviderError:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as error:
            raise ProviderError("transcription_request_or_response_error") from error

    async def reflect(self, evidence: dict[str, Any]) -> dict[str, Any]:
        model = self.capabilities.text_model
        if not self.ready or not model:
            raise ProviderError("text_provider_not_configured")
        system = (
            "You are a non-clinical wellness reflection companion. Use only the supplied evidence. "
            "Never diagnose or infer internal emotion from image appearance. Explicit user-reported feelings take precedence. "
            "Do not treat workload alone as stress. Be warm, concise, non-prescriptive, preserve uncertainty and contradictions. "
            "Return JSON with keys reflection_text (string), reported_emotions (array), challenges (array), accomplishments (array), and gentle_question (string). "
            "Use empty arrays where evidence is absent; do not invent facts."
        )
        raw = await self._chat(model, [
            {"role": "system", "content": system},
            {"role": "user", "content": json.dumps(evidence, ensure_ascii=True)},
        ])
        try:
            result = json.loads(raw)
            for key in ("reflection_text", "gentle_question"):
                if not isinstance(result.get(key), str):
                    raise ValueError(f"invalid {key}")
            for key in ("reported_emotions", "challenges", "accomplishments"):
                value = result.get(key, [])
                if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
                    raise ValueError(f"invalid {key}")
                result[key] = value[:8]
            return result
        except (json.JSONDecodeError, ValueError, TypeError) as error:
            raise ProviderError("text_malformed_output") from error