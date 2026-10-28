import asyncio
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from app.analysis import StressEstimate, UploadedMedia, WellnessActivity, analyze_inputs, estimate_stress, recommend_activities
from app.main import app
from app.providers import OpenAICompatibleProvider, ProviderError

client = TestClient(app)


def test_health_and_ready_are_mocked() -> None:
    assert client.get("/").json()["docs"] == "/docs"
    assert client.get("/health").json() == {"status": "ok", "mode": "mock"}
    assert client.get("/ready").json()["ready"] is True


def test_text_only_analysis_uses_user_statement() -> None:
    response = client.post("/analyze", data={"text": "I enjoyed a quiet walk after work."})
    assert response.status_code == 200
    payload = response.json()
    assert payload["fusion_verdict"] == "SINGLE_MODALITY"
    assert payload["modality_results"]["text"]["evidence_type"] == "user_statement"
    assert payload["save_status"] == "not_saved"
    assert "quiet walk" in payload["reflection_text"]


def test_media_only_analysis_discloses_uncertainty() -> None:
    response = client.post(
        "/analyze",
        files={"image": ("moment.png", b"\x89PNG\r\n\x1a\nexample", "image/png")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["fusion_verdict"] == "UNCERTAIN"
    assert payload["modality_results"]["image"]["status"] == "skipped"
    assert payload["modality_results"]["image"]["reason"] == "vision_provider_unavailable"


def test_no_input_is_rejected() -> None:
    response = client.post("/analyze", data={})
    assert response.status_code == 422


def test_mismatched_media_signature_is_rejected() -> None:
    response = client.post("/analyze", files={"image": ("not-image.png", b"plain text", "image/png")})
    assert response.status_code == 400


def test_unsupported_mime_is_rejected() -> None:
    response = client.post("/analyze", files={"image": ("script.svg", b"<svg />", "image/svg+xml")})
    assert response.status_code == 415


def test_reflection_storage_is_explicitly_disabled() -> None:
    assert client.get("/reflections").json()["storage"] == "disabled"
    assert client.get("/reflections/example-id").status_code == 404


def test_busy_but_successful_day_does_not_imply_stress() -> None:
    result = estimate_stress("I had a busy day, finished my presentation, and felt proud of the result.")
    assert result.category == "Unclear"
    assert result.confidence == "Low"


def test_explicit_overwhelm_is_high_with_grounded_evidence() -> None:
    result = estimate_stress("I felt overwhelmed by the pressure and could not manage another task.")
    assert result.category == "High"
    assert result.confidence == "High"
    assert result.supporting_evidence


def test_requested_journal_with_image_keeps_text_analysis_when_vision_unavailable() -> None:
    journal = (
        "Honestly, today has been extremely overwhelming. I had so many tasks to finish at work, and even though I kept trying to manage everything, I felt like I was constantly running out of time. "
        "I barely took any breaks, skipped lunch because I was trying to meet a deadline, and kept thinking about all the things I still needed to do. My shoulders felt tense, I had a headache, and I found it difficult to concentrate on one task at a time. "
        "Even after finishing some of my work, I couldn't relax because I was worried about what I might have forgotten. I feel mentally exhausted, and I don't want to do anything else today. I just want some peace, to switch off my mind for a while, and to stop feeling like I have to keep pushing myself. "
        "I know I completed a lot, but right now I feel drained rather than satisfied."
    )
    response = client.post(
        "/analyze",
        data={"text": journal},
        files={"image": ("moment.png", b"\x89PNG\r\n\x1a\nplaceholder", "image/png")},
    )
    payload = response.json()
    assert response.status_code == 200
    assert payload["stress_estimate"]["category"] == "High"
    assert payload["stress_estimate"]["confidence"] in {"Medium", "High"}
    assert any("overwhelming" in item.casefold() for item in payload["stress_estimate"]["supporting_evidence"])
    assert payload["modality_results"]["text"]["status"] == "processed"
    assert payload["modality_results"]["image"]["status"] == "skipped"
    assert len(payload["activities"]) == 3
    assert payload["activities"][2]["title"] == "A slow, comfortable walk"
    assert payload["activities"][2]["youtube_url"].startswith("https://www.youtube.com/results?search_query=")


def test_vision_failure_does_not_hide_high_text_stress() -> None:
    result = asyncio.run(analyze_inputs(
        "I feel overwhelmed by the deadline and can't relax.",
        {"image": UploadedMedia("photo.png", b"image", "image/png"), "audio": None, "video": None},
        True,
        FakeProvider(image_error=True),
    ))
    assert result.stress_estimate.category == "High"
    assert result.modality_results["image"]["status"] == "failed"
    assert result.uncertainty_notes


def test_contradictory_stress_cues_are_unclear() -> None:
    result = estimate_stress("I felt calm this morning, but overwhelmed by the afternoon.")
    assert result.category == "Unclear"
    assert result.confidence == "Low"


def test_moderate_stress_is_based_on_explicit_pressure() -> None:
    result = estimate_stress("I felt pressure from several deadlines and found it hard to unwind.")
    assert result.category == "Moderate"
    assert result.supporting_evidence


def test_fatigue_without_reported_pressure_is_unclear() -> None:
    result = estimate_stress("I am tired after a long day.")
    assert result.category == "Unclear"


def test_generated_activities_use_youtube_search_links() -> None:
    response = client.post("/analyze", data={"text": "I felt calm and relaxed after finishing my work."})
    activity = response.json()["activities"][0]
    assert activity["title"]
    assert activity["duration"]
    assert activity["first_step"]
    assert activity["youtube_url"].startswith("https://www.youtube.com/results?search_query=")


@pytest.mark.parametrize(
    ("category", "text", "first_titles", "third_title", "query_phrase"),
    [
        ("High", "I feel overwhelmed and want to switch off.", ["Step away for a moment", "Gentle breathing"], "walk", "gentle+slow+walking"),
        ("Moderate", "I feel pressure and would prefer walking.", ["Take a short reset", "Gentle stretching"], "walk", "10+minute+walking"),
        ("Low", "I feel calm and enjoy cycling.", ["Mark one thing that went well", "Enjoy a mindful walk"], "cycle", "beginner+easy+cycling"),
        ("Unclear", "Today was unusual.", ["Take a quiet pause", "Step outside if it suits you"], "walk", "10+minute+walking"),
    ],
)
def test_third_activity_matches_stress_category_and_preserves_first_two(
    category: str,
    text: str,
    first_titles: list[str],
    third_title: str,
    query_phrase: str,
) -> None:
    estimate = StressEstimate(category=category, confidence="Low", explanation="Test estimate.", uncertainty="Optional suggestion.")
    activities = recommend_activities(estimate, text)
    assert [activity.title for activity in activities[:2]] == first_titles
    third = activities[2]
    assert third_title in third.title.casefold()
    assert third.duration
    assert third.why
    assert third.first_step
    assert third.youtube_url.startswith("https://www.youtube.com/results?search_query=")
    assert query_phrase in third.youtube_url


def test_high_stress_activity_accounts_for_physical_limitations() -> None:
    estimate = StressEstimate(category="High", confidence="High", explanation="Explicit report.", uncertainty="Non-clinical.")
    third = recommend_activities(estimate, "I feel overwhelmed and have a knee injury.")[2]
    assert third.title == "Comfortable seated movement"
    assert "stop if it hurts" in third.first_step
    assert "seated+stretching" in third.youtube_url


def test_physical_pain_uses_the_seated_low_intensity_option() -> None:
    estimate = StressEstimate(category="Moderate", confidence="Medium", explanation="Reported pressure.", uncertainty="Non-clinical.")
    third = recommend_activities(estimate, "I feel pressure and hurt my knee yesterday.")[2]
    assert third.title == "Comfortable seated movement"
    assert "stop if it hurts" in third.first_step


def test_unclear_activity_says_it_is_not_a_stress_conclusion() -> None:
    estimate = StressEstimate(category="Unclear", confidence="Low", explanation="Insufficient evidence.", uncertainty="Unclear.")
    third = recommend_activities(estimate, "A photo of my commute.")[2]
    assert "not based on a conclusion about your stress level" in third.why


def test_activity_schema_rejects_non_youtube_and_direct_video_links() -> None:
    with pytest.raises(ValueError):
        WellnessActivity(title="Walk", why="Optional movement.", duration="5 minutes", first_step="Step outside.", youtube_url="https://example.com/")
    with pytest.raises(ValueError):
        WellnessActivity(title="Walk", why="Optional movement.", duration="5 minutes", first_step="Step outside.", youtube_url="https://www.youtube.com/watch?v=unverified")


def test_severe_distress_keeps_existing_first_two_and_adds_gentle_movement() -> None:
    estimate = StressEstimate(category="High", confidence="High", explanation="Explicit report.", uncertainty="Non-clinical.")
    activities = recommend_activities(estimate, "I feel overwhelmed.", severe_distress=True)
    assert [item.title for item in activities[:2]] == ["Reach someone you trust", "A quiet pause"]
    assert activities[2].title == "A slow, comfortable walk"
    assert activities[2].youtube_url.startswith("https://www.youtube.com/results?search_query=")


class FakeProvider:
    capabilities = SimpleNamespace(vision_model="fake-vision", transcription_model="fake-transcription", text_model="fake-text")

    def __init__(self, *, image_error: bool = False, transcription_error: bool = False):
        self.image_error = image_error
        self.transcription_error = transcription_error

    def can_process_image(self) -> bool:
        return True

    def can_transcribe(self) -> bool:
        return True

    def can_process_text(self) -> bool:
        return True

    async def describe_image(self, content: bytes, mime_type: str, context: str = "") -> dict[str, object]:
        if self.image_error:
            raise ProviderError("fake_vision_failure")
        return {"observations": ["A person is sitting at a desk."], "limitations": ["Context cannot establish stress."], "summary": "A desk is visible."}

    async def transcribe(self, content: bytes, filename: str, mime_type: str) -> str:
        if self.transcription_error:
            raise ProviderError("fake_transcription_failure")
        return "I felt tired but proud of finishing my work."

    async def reflect(self, evidence: dict[str, object]) -> dict[str, object]:
        return {"reflection_text": "You described a full day and a completed project.", "reported_emotions": [], "challenges": [], "accomplishments": [], "gentle_question": "What felt most meaningful?"}


def test_text_and_image_use_fake_vision_evidence(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProvider()
    monkeypatch.setattr("app.main.OpenAICompatibleProvider", lambda: fake)
    response = client.post(
        "/analyze",
        data={"text": "It was a busy day but I finished my project.", "consent_to_provider": "true"},
        files={"image": ("desk.png", b"\x89PNG\r\n\x1a\ncontent", "image/png")},
    )
    payload = response.json()
    assert response.status_code == 200
    assert payload["modality_results"]["image"]["status"] == "processed"
    assert "A person is sitting at a desk." in payload["modality_results"]["image"]["observations"]
    assert payload["stress_estimate"]["category"] == "Unclear"


def test_image_only_evidence_can_generate_a_reflection() -> None:
    result = asyncio.run(analyze_inputs(
        "",
        {"image": UploadedMedia("photo.png", b"image", "image/png"), "audio": None, "video": None},
        True,
        FakeProvider(),
    ))
    assert result.stress_estimate.category == "Unclear"
    assert result.modality_results["image"]["status"] == "processed"
    assert result.reflection_text == "You described a full day and a completed project."


def test_provider_processing_requires_explicit_consent(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.main.OpenAICompatibleProvider", FakeProvider)
    response = client.post("/analyze", data={"text": "A quiet day."})
    assert response.status_code == 428


def test_image_provider_failure_is_not_reported_as_processed() -> None:
    fake = FakeProvider(image_error=True)
    result = asyncio.run(analyze_inputs(
        "I finished a task.",
        {"image": UploadedMedia("photo.png", b"image", "image/png"), "audio": None, "video": None},
        True,
        fake,
    ))
    assert result.modality_results["image"]["status"] == "failed"
    assert "image_analysis_failed" in result.quality_flags
    assert "Image analysis failed" in result.uncertainty_notes[0]


def test_transcription_failure_does_not_invent_transcript() -> None:
    fake = FakeProvider(transcription_error=True)
    result = asyncio.run(analyze_inputs(
        "",
        {"image": None, "audio": UploadedMedia("voice.mp3", b"ID3data", "audio/mpeg"), "video": None},
        True,
        fake,
    ))
    assert result.modality_results["audio"]["status"] == "failed"
    assert "transcript" not in result.modality_results["audio"]
    assert "audio_transcription_failed" in result.quality_flags


def test_audio_video_and_transcript_can_be_combined(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProvider()
    monkeypatch.setattr("app.analysis._extract_video", lambda content, mime: ([b"frame"], None, []))
    result = asyncio.run(analyze_inputs(
        "My day was busy but successful.",
        {
            "image": None,
            "audio": UploadedMedia("voice.mp3", b"ID3data", "audio/mpeg"),
            "video": UploadedMedia("walk.mp4", b"video", "video/mp4"),
        },
        True,
        fake,
    ))
    assert result.modality_results["audio"]["status"] == "processed"
    assert result.modality_results["video"]["status"] == "processed"
    assert result.modality_results["video"]["frames_processed"] == 1
    assert "video" in result.evidence_summary


def test_video_is_skipped_when_ffmpeg_is_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.analysis._extract_video", lambda content, mime: ([], None, ["video_skipped_ffmpeg_unavailable"]))
    result = asyncio.run(analyze_inputs(
        "A quiet day.",
        {"image": None, "audio": None, "video": UploadedMedia("walk.mp4", b"video", "video/mp4")},
        True,
        FakeProvider(),
    ))
    assert result.modality_results["video"]["status"] == "skipped"
    assert result.modality_results["video"]["reason"] == "video_skipped_ffmpeg_unavailable"


def test_readiness_discloses_missing_provider_credentials(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in ("AURA_OPENAI_API_KEY", "AURA_OPENAI_VISION_MODEL", "AURA_OPENAI_TRANSCRIPTION_MODEL", "AURA_OPENAI_TEXT_MODEL"):
        monkeypatch.delenv(key, raising=False)
    response = client.get("/ready")
    assert response.status_code == 200
    assert response.json()["providers_configured"] is False


def test_mock_mode_disables_configured_provider_until_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AURA_OPENAI_API_KEY", "test-placeholder")
    monkeypatch.setenv("AURA_OPENAI_TEXT_MODEL", "test-text")
    monkeypatch.setenv("AURA_MODE", "mock")
    assert OpenAICompatibleProvider().ready is False
    monkeypatch.setenv("AURA_MODE", "provider")
    assert OpenAICompatibleProvider().ready is True


class FailingTextProvider(FakeProvider):
    async def reflect(self, evidence: dict[str, object]) -> dict[str, object]:
        raise ProviderError("fake_text_failure")


def test_text_provider_failure_uses_grounded_fallback() -> None:
    result = asyncio.run(analyze_inputs(
        "I felt overwhelmed by the deadline.",
        {"image": None, "audio": None, "video": None},
        True,
        FailingTextProvider(),
    ))
    assert "deadline" in result.reflection_text
    assert result.stress_estimate.category == "High"
    assert "text_reflection_provider_failed" in result.quality_flags


class UnsupportedClaimsProvider(FakeProvider):
    async def reflect(self, evidence: dict[str, object]) -> dict[str, object]:
        return {
            "reflection_text": "You described finishing a task.",
            "reported_emotions": ["joyful"],
            "challenges": ["A major conflict occurred."],
            "accomplishments": ["You won an award."],
            "gentle_question": "What felt important?",
        }


def test_model_cannot_invent_evidence_labels() -> None:
    result = asyncio.run(analyze_inputs(
        "I finished a task.",
        {"image": None, "audio": None, "video": None},
        True,
        UnsupportedClaimsProvider(),
    ))
    assert result.reported_emotions == []
    assert result.challenges == []
    assert result.accomplishments == ["I finished a task."]