from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal
from urllib.parse import quote_plus

from pydantic import BaseModel, Field

from .providers import OpenAICompatibleProvider, ProviderError


StressCategory = Literal["Low", "Moderate", "High", "Unclear"]
Confidence = Literal["Low", "Medium", "High"]


class StressEstimate(BaseModel):
    category: StressCategory
    confidence: Confidence
    explanation: str
    supporting_evidence: list[str] = Field(default_factory=list)
    uncertainty: str


class WellnessActivity(BaseModel):
    title: str
    why: str
    duration: str
    first_step: str
    youtube_url: str


class AnalysisResult(BaseModel):
    reflection_text: str
    reported_emotions: list[str] = Field(default_factory=list)
    challenges: list[str] = Field(default_factory=list)
    accomplishments: list[str] = Field(default_factory=list)
    stress_estimate: StressEstimate
    activities: list[WellnessActivity]
    gentle_question: str
    supportive_reminder: str
    evidence_summary: str
    modality_results: dict[str, dict[str, Any]]
    fusion_verdict: Literal[
        "MATCH", "PARTIAL", "CONFLICT", "SINGLE_MODALITY", "UNCERTAIN",
        "NO_USABLE_INPUT", "PROVIDER_FAILURE",
    ]
    quality_flags: list[str] = Field(default_factory=list)
    uncertainty_notes: list[str] = Field(default_factory=list)
    provider_trace: list[dict[str, str | None]] = Field(default_factory=list)


@dataclass(frozen=True)
class UploadedMedia:
    filename: str
    content: bytes
    mime_type: str


HIGH_STRESS = (
    "overwhelmed", "can't cope", "cannot cope", "under intense pressure",
    "extreme pressure", "high stress", "severely stressed", "completely exhausted",
    "at breaking point", "falling apart", "can't manage", "unmanageable",
)
MODERATE_STRESS = (
    "stressed", "pressure", "hard to unwind", "difficult to relax", "can't relax",
    "too much to do", "too much on my plate", "anxious", "worried",
)
LOW_STRESS = ("felt calm", "feeling calm", "relaxed", "manageable", "at ease", "unpressured")
NEGATIONS = ("not", "never", "wasn't", "weren't", "isn't", "aren't", "don't", "didn't", "no longer")
EMOTION_TERMS = (
    "happy", "grateful", "proud", "excited", "calm", "sad", "angry", "worried",
    "anxious", "frustrated", "lonely", "hopeful", "overwhelmed", "relieved", "tired",
)
CHALLENGE_TERMS = ("difficult", "hard", "challenge", "struggle", "pressure", "deadline", "conflict", "tired", "stress")
ACCOMPLISHMENT_TERMS = ("finished", "completed", "accomplished", "achieved", "managed", "proud", "success", "successful", "made progress")
SEVERE_DISTRESS_TERMS = ("suicid", "self-harm", "hurt myself", "end my life", "can't keep myself safe", "cannot keep myself safe")


def _sentences(text: str) -> list[str]:
    return [part.strip() for part in re.split(r"(?<=[.!?])\s+|\n+", text) if part.strip()]


def _has_unnegated(text: str, phrase: str) -> bool:
    for match in re.finditer(re.escape(phrase), text, flags=re.IGNORECASE):
        prefix = text[max(0, match.start() - 34) : match.start()].casefold()
        words = re.findall(r"[a-z']+", prefix)
        if not any(word in NEGATIONS for word in words[-4:]):
            return True
    return False


def _matching_sentences(text: str, terms: tuple[str, ...]) -> list[str]:
    return [sentence for sentence in _sentences(text) if any(term in sentence.casefold() for term in terms)][:4]


def estimate_stress(text: str) -> StressEstimate:
    normalized = text.casefold()
    high = [term for term in HIGH_STRESS if _has_unnegated(normalized, term)]
    moderate = [term for term in MODERATE_STRESS if _has_unnegated(normalized, term)]
    low = [term for term in LOW_STRESS if _has_unnegated(normalized, term)]
    support = _matching_sentences(text, HIGH_STRESS + MODERATE_STRESS + LOW_STRESS)

    if low and (high or moderate):
        return StressEstimate(
            category="Unclear", confidence="Low",
            explanation="You described both manageable or calm feelings and signs of pressure; I cannot resolve that difference from the text alone.",
            supporting_evidence=support,
            uncertainty="These cues may refer to different parts of the day. Your own interpretation is more important than this tentative estimate.",
        )
    if high:
        return StressEstimate(
            category="High", confidence="High",
            explanation="You explicitly described feeling substantially strained.",
            supporting_evidence=support,
            uncertainty="This is based only on the words you shared, not a clinical or physiological measurement.",
        )
    if moderate:
        return StressEstimate(
            category="Moderate", confidence="Medium",
            explanation="You mentioned pressure, fatigue, or difficulty unwinding.",
            supporting_evidence=support,
            uncertainty="These words can mean different things to different people; workload alone was not used as evidence.",
        )
    if low:
        return StressEstimate(
            category="Low", confidence="Medium",
            explanation="You described feeling calm, at ease, or able to manage the day.",
            supporting_evidence=support,
            uncertainty="This reflects only the context you chose to share.",
        )
    return StressEstimate(
        category="Unclear", confidence="Low",
        explanation="There is not enough direct information about pressure or strain to estimate a category.",
        supporting_evidence=[],
        uncertainty="A busy schedule, an image, or an activity by itself does not establish stress.",
    )


def _activity(title: str, why: str, duration: str, first_step: str, query: str) -> WellnessActivity:
    return WellnessActivity(
        title=title,
        why=why,
        duration=duration,
        first_step=first_step,
        youtube_url=f"https://www.youtube.com/results?search_query={quote_plus(query)}",
    )


def recommend_activities(stress: StressEstimate, text: str, severe_distress: bool = False) -> list[WellnessActivity]:
    if severe_distress:
        return [
            _activity("Reach someone you trust", "You shared something that sounds especially difficult; you do not have to handle it alone.", "A few minutes", "Text or call someone you trust and tell them what support would help.", "how to reach out to a trusted person for support"),
            _activity("A quiet pause", "Keep the next step small and low-pressure while you get support.", "2 minutes", "Sit somewhere you feel safe and notice one comfortable breath without trying to change it.", "gentle grounding exercise 2 minutes"),
        ]
    category = stress.category
    lower = text.casefold()
    if category == "High":
        return [
            _activity("Step away for a moment", "You described substantial strain, so a short pause may create a little room without adding another demand.", "5 minutes", "Move to a quieter spot and let your shoulders rest.", "guided breathing exercise 5 minutes"),
            _activity("Gentle breathing", "A comfortable, unforced pause may feel more manageable than a demanding activity today.", "3 minutes", "Breathe naturally and let the exhale be easy; stop if it feels uncomfortable.", "gentle guided breathing exercise 3 minutes"),
            _activity("Reach out for support", "Sharing the load with someone you trust may help you feel less alone with it.", "5 minutes", "Send one person a short message about what would help right now.", "how to reach out to a trusted person for support"),
        ]
    if category == "Moderate":
        return [
            _activity("Take a short reset", "You mentioned pressure or tiredness; a brief pause can be a realistic first step.", "5 minutes", "Step away from your current task and get a glass of water.", "guided breathing exercise 5 minutes"),
            _activity("Gentle stretching", "A low-effort movement break may help break up a demanding day.", "5–10 minutes", "Try a few comfortable shoulder and neck stretches, stopping if anything hurts.", "beginner gentle stretching 10 minutes"),
            _activity("Choose one next priority", "If several responsibilities are competing for attention, naming one small next step may make them feel more workable.", "3 minutes", "Write down one thing that can wait and one thing you want to do next.", "how to choose one priority reduce overwhelm"),
        ]
    if category == "Low":
        accomplishment = next(iter(_matching_sentences(text, ACCOMPLISHMENT_TERMS)), "You described the day as manageable.")
        return [
            _activity("Mark one thing that went well", f"You shared: “{accomplishment[:140]}” Taking a moment to notice it can help you close the day on your own terms.", "2 minutes", "Write one detail you would like to remember.", "short gratitude reflection 2 minutes"),
            _activity("Enjoy a mindful walk", "A gentle change of scene can be a pleasant way to carry a manageable day forward.", "10 minutes", "Choose a comfortable route and notice a few things around you.", "guided mindful walking"),
        ]
    return [
        _activity("Take a quiet pause", "Your stress level is unclear, so start with an optional, low-pressure reset rather than assuming what you need.", "2 minutes", "Pause and ask yourself whether you want movement, rest, or company.", "gentle grounding exercise 2 minutes"),
        _activity("Step outside if it suits you", "A short change of scene is one option; you can skip it if rest feels better.", "5–10 minutes", "Notice the air and surroundings at a comfortable pace.", "guided mindful walking"),
    ]


def _extract_video(content: bytes, mime_type: str) -> tuple[list[bytes], bytes | None, list[str]]:
    if not shutil.which("ffmpeg") or not shutil.which("ffprobe"):
        return [], None, ["video_skipped_ffmpeg_unavailable"]
    suffix = {"video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"}.get(mime_type, ".video")
    with tempfile.TemporaryDirectory(prefix="aura-") as temporary:
        source = Path(temporary) / f"input{suffix}"
        source.write_bytes(content)
        try:
            probe = subprocess.run(
                ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type", "-of", "json", str(source)],
                capture_output=True, check=True, timeout=8,
            )
            probe_data = json.loads(probe.stdout)
            duration = float(probe_data.get("format", {}).get("duration", 0))
            has_audio_track = any(stream.get("codec_type") == "audio" for stream in probe_data.get("streams", []))
        except (subprocess.SubprocessError, ValueError, TypeError, json.JSONDecodeError):
            return [], None, ["video_probe_failed"]
        max_seconds = int(os.getenv("AURA_VIDEO_MAX_SECONDS", "60"))
        if duration <= 0 or duration > max_seconds:
            return [], None, ["video_duration_unsupported"]
        timestamps = sorted({0, int(duration * 0.33), int(duration * 0.66), max(0, int(duration - 0.5))})
        frames: list[bytes] = []
        for timestamp in timestamps:
            try:
                frame = subprocess.run(
                    ["ffmpeg", "-v", "error", "-ss", str(timestamp), "-i", str(source), "-frames:v", "1", "-vf", "scale=768:-2", "-f", "image2pipe", "-vcodec", "mjpeg", "pipe:1"],
                    capture_output=True, check=True, timeout=12,
                ).stdout
                if frame:
                    frames.append(frame)
            except subprocess.SubprocessError:
                continue
        try:
            audio = subprocess.run(
                ["ffmpeg", "-v", "error", "-i", str(source), "-vn", "-t", str(max_seconds), "-ac", "1", "-ar", "16000", "-f", "wav", "pipe:1"],
                capture_output=True, check=True, timeout=20,
            ).stdout
        except subprocess.SubprocessError:
            audio = b""
        flags = [] if frames else ["video_frame_extraction_failed"]
        if not has_audio_track:
            flags.append("video_has_no_audio_track")
        elif not audio:
            flags.append("video_audio_extraction_failed")
        return frames, audio or None, flags


def _fallback_reflection(text: str, transcripts: list[str], observations: list[str]) -> str:
    words = text.strip() or " ".join(transcripts).strip()
    parts: list[str] = []
    if words:
        excerpt = words[:320] + ("…" if len(words) > 320 else "")
        parts.append(f"You shared: “{excerpt}”")
    if observations:
        parts.append("The processed media showed: " + "; ".join(observations[:3]) + ". These are contextual observations, not evidence of how you felt.")
    if not parts:
        return "There is not enough processed information to offer a grounded reflection yet. You can add a few words about what this moment meant to you, or leave it here for now."
    return "\n\n".join(parts + ["That is what I can reflect back from the available evidence. You know best what the moment meant to you."])


async def analyze_inputs(
    text: str,
    media: dict[str, UploadedMedia | None],
    consent: bool,
    provider: OpenAICompatibleProvider,
) -> AnalysisResult:
    note = text.strip()
    modality_results: dict[str, dict[str, Any]] = {}
    quality_flags: list[str] = []
    uncertainty_notes: list[str] = []
    provider_trace: list[dict[str, str | None]] = []
    transcript_parts: list[str] = []
    observations: list[str] = []

    may_send = any((
        bool(note) and provider.can_process_text(),
        media.get("image") is not None and provider.can_process_image(),
        media.get("audio") is not None and provider.can_transcribe(),
        media.get("video") is not None and (provider.can_process_image() or provider.can_transcribe()),
    ))
    if may_send and not consent:
        raise PermissionError("Provider consent is required before sending journal text or media for processing.")

    if note:
        modality_results["text"] = {"status": "processed", "evidence_type": "user_statement"}

    image = media.get("image")
    if image:
        if provider.can_process_image() and consent:
            try:
                result = await provider.describe_image(image.content, image.mime_type, note)
                observations.extend(result["observations"])
                modality_results["image"] = {"status": "processed", "evidence_type": "direct_observation", **result}
                provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.vision_model, "status": "success", "reason": None})
            except ProviderError as error:
                modality_results["image"] = {"status": "failed", "reason": error.category}
                quality_flags.append("image_analysis_failed")
                uncertainty_notes.append("Image analysis failed; no image-based conclusions were used.")
                provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.vision_model, "status": "failure", "reason": error.category})
        else:
            modality_results["image"] = {"status": "skipped", "reason": "vision_provider_unavailable"}
            quality_flags.append("image_not_analyzed")

    audio = media.get("audio")
    if audio:
        if provider.can_transcribe() and consent:
            try:
                transcript = await provider.transcribe(audio.content, "journal-audio", audio.mime_type)
                if transcript:
                    transcript_parts.append(transcript)
                    modality_results["audio"] = {"status": "processed", "evidence_type": "transcription", "transcript": transcript}
                    provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.transcription_model, "status": "success", "reason": None})
                else:
                    modality_results["audio"] = {"status": "failed", "reason": "empty_transcript"}
                    quality_flags.append("audio_transcription_empty")
                    uncertainty_notes.append("Transcription returned no words; no transcript was invented.")
            except ProviderError as error:
                modality_results["audio"] = {"status": "failed", "reason": error.category}
                quality_flags.append("audio_transcription_failed")
                uncertainty_notes.append("Audio transcription failed; no transcript was invented or analyzed.")
                provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.transcription_model, "status": "failure", "reason": error.category})
        else:
            modality_results["audio"] = {"status": "skipped", "reason": "transcription_provider_unavailable"}
            quality_flags.append("audio_not_transcribed")

    video = media.get("video")
    if video:
        frames, extracted_audio, extraction_flags = _extract_video(video.content, video.mime_type)
        quality_flags.extend(extraction_flags)
        extraction_failed = any("failed" in flag or "probe" in flag for flag in extraction_flags)
        video_result: dict[str, Any] = {
            "status": "failed" if extraction_failed else "skipped",
            "reason": extraction_flags[0] if extraction_flags else "video_not_processed",
            "frames_processed": 0,
            "audio_transcribed": False,
        }
        if frames and provider.can_process_image() and consent:
            frame_observations: list[str] = []
            for index, frame in enumerate(frames):
                try:
                    result = await provider.describe_image(frame, "image/jpeg", note)
                    frame_observations.extend(result["observations"])
                except ProviderError as error:
                    quality_flags.append("video_frame_analysis_failed")
                    provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.vision_model, "status": "failure", "reason": error.category})
            observations.extend(frame_observations)
            video_result.update({"status": "processed" if frame_observations else "failed", "reason": None if frame_observations else "no_visual_observations_returned", "frames_processed": len(frames) if frame_observations else 0, "evidence_type": "sampled_frame_observation", "observations": frame_observations[:12]})
            if frame_observations:
                provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.vision_model, "status": "success", "reason": None})
        elif frames:
            video_result.update({"status": "skipped", "reason": "vision_provider_unavailable", "frames_extracted": len(frames)})
            quality_flags.append("video_frames_not_analyzed")
        if extracted_audio:
            if provider.can_transcribe() and consent:
                try:
                    transcript = await provider.transcribe(extracted_audio, "video-audio.wav", "audio/wav")
                    transcript_parts.append(transcript)
                    video_result.update({"audio_transcribed": True, "transcript": transcript})
                    provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.transcription_model, "status": "success", "reason": None})
                except ProviderError as error:
                    quality_flags.append("video_audio_transcription_failed")
                    uncertainty_notes.append("Video audio transcription failed; no transcript was invented.")
                    provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.transcription_model, "status": "failure", "reason": error.category})
            else:
                quality_flags.append("video_audio_not_transcribed")
        modality_results["video"] = video_result

    all_words = "\n".join(part for part in [note, *transcript_parts] if part)
    explicit_emotions = sorted({term for term in EMOTION_TERMS if _has_unnegated(all_words.casefold(), term)})
    challenges = _matching_sentences(all_words, CHALLENGE_TERMS)
    accomplishments = _matching_sentences(all_words, ACCOMPLISHMENT_TERMS)
    stress = estimate_stress(all_words)
    severe = any(term in all_words.casefold() for term in SEVERE_DISTRESS_TERMS)
    activities = recommend_activities(stress, all_words, severe)
    text_result: dict[str, Any] | None = None

    if (all_words or observations) and provider.can_process_text() and consent:
        try:
            evidence = {
                "user_text": note,
                "transcribed_speech": transcript_parts,
                "visible_context_observations": observations,
                "evidence_limit": "Visual observations are context only and cannot establish emotion or stress.",
            }
            text_result = await provider.reflect(evidence)
            provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.text_model, "status": "success", "reason": None})
        except ProviderError as error:
            quality_flags.append("text_reflection_provider_failed")
            uncertainty_notes.append("The reflection-generation provider failed; a clearly marked evidence-based fallback was used.")
            provider_trace.append({"provider": "openai-compatible", "model": provider.capabilities.text_model, "status": "failure", "reason": error.category})

    if text_result:
        reflection_text = text_result["reflection_text"][:2400]
        gentle_question = text_result["gentle_question"][:300] or "What part of today felt most demanding, if any?"
    else:
        reflection_text = _fallback_reflection(note, transcript_parts, observations)
        gentle_question = "Does this estimate fit how today felt to you, or would you describe it differently?"

    if severe:
        supportive = "This is not a clinical assessment. If you may be in immediate danger or cannot stay safe, contact local emergency services or someone you trust now."
    else:
        supportive = "This is a non-clinical reflection, not a medical assessment or diagnosis. You know your experience best and can disagree with or correct this estimate."

    processed = [name for name, result in modality_results.items() if result.get("status") == "processed"]
    if not all_words and not observations:
        verdict: Literal["MATCH", "PARTIAL", "CONFLICT", "SINGLE_MODALITY", "UNCERTAIN", "NO_USABLE_INPUT", "PROVIDER_FAILURE"] = "PROVIDER_FAILURE" if provider_trace and all(item["status"] == "failure" for item in provider_trace) else "UNCERTAIN"
    elif len(processed) <= 1:
        verdict = "SINGLE_MODALITY"
    else:
        verdict = "PARTIAL"
    if not processed and media:
        uncertainty_notes.append("No uploaded media produced usable semantic evidence.")
    if not all_words and not observations:
        uncertainty_notes.append("There is insufficient processed evidence to assess stress.")
    if not uncertainty_notes:
        uncertainty_notes.append("Visual context is not used as evidence of internal emotion or stress.")

    evidence_summary = "; ".join(
        f"{name}: {result.get('status')}" for name, result in modality_results.items()
    ) or "No input produced usable evidence."
    return AnalysisResult(
        reflection_text=reflection_text,
        reported_emotions=explicit_emotions,
        challenges=challenges,
        accomplishments=accomplishments,
        stress_estimate=stress,
        activities=activities,
        gentle_question=gentle_question,
        supportive_reminder=supportive,
        evidence_summary=evidence_summary,
        modality_results=modality_results,
        fusion_verdict=verdict,
        quality_flags=quality_flags,
        uncertainty_notes=uncertainty_notes,
        provider_trace=provider_trace,
    )