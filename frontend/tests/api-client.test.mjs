import assert from "node:assert/strict";
import test from "node:test";
import { ApiRequestError, postAnalysis } from "../lib/api-client.mjs";

const validPayload = {
  request_id: "request-1",
  reflection_text: "You described a hard day.",
  stress_estimate: { category: "High", confidence: "Medium", explanation: "You said overwhelmed.", supporting_evidence: ["I felt overwhelmed"], uncertainty: "This is non-clinical." },
  reported_emotions: [],
  challenges: [],
  accomplishments: [],
  wellness_broadcast: { title: "Gentle breathing", reason: "Optional pause.", duration: "5 minutes", youtube_url: "https://www.youtube.com/results?search_query=gentle+breathing", link_type: "search" },
  islamic_support: null,
  activities: [{ title: "Pause", why: "A pause may help", duration: "5 minutes", first_step: "Sit down", youtube_url: "https://www.youtube.com/results?search_query=breathing" }],
  modality_results: { text: { status: "processed" } },
  gentle_question: "What feels most important?",
  supportive_reminder: "This is not a diagnosis.",
  evidence_summary: "Text processed.",
  fusion_verdict: "SINGLE_MODALITY",
  quality_flags: [],
  uncertainty_notes: [],
  provider_trace: [],
  timing_ms: 2,
  save_status: "not_saved",
};

test("posts multipart analysis through the same-origin API and accepts valid results", async () => {
  const form = new FormData();
  form.set("text", "I felt overwhelmed");
  let requestUrl = "";
  const result = await postAnalysis(form, {
    fetchImpl: async (url, options) => {
      requestUrl = url;
      assert.equal(options.method, "POST");
      assert.equal(options.body, form);
      return Response.json(validPayload);
    },
  });
  assert.equal(requestUrl, "/api/analyze");
  assert.equal(result.stress_estimate.category, "High");
});

test("retries one transient backend-unavailable failure then succeeds", async () => {
  let attempts = 0;
  const result = await postAnalysis(new FormData(), {
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError("Failed to fetch");
      return Response.json(validPayload);
    },
  });
  assert.equal(attempts, 2);
  assert.equal(result.request_id, "request-1");
});

test("reports backend unavailability after the bounded retry", async () => {
  let attempts = 0;
  await assert.rejects(
    postAnalysis(new FormData(), { fetchImpl: async () => { attempts += 1; throw new TypeError("Failed to fetch"); } }),
    (error) => error instanceof ApiRequestError && error.kind === "network" && error.retryable,
  );
  assert.equal(attempts, 2);
});

test("rejects malformed JSON and incomplete analysis schemas", async () => {
  await assert.rejects(
    postAnalysis(new FormData(), { fetchImpl: async () => new Response("not-json") }),
    (error) => error instanceof ApiRequestError && error.kind === "malformed" && error.retryable,
  );
  await assert.rejects(
    postAnalysis(new FormData(), { fetchImpl: async () => Response.json({ reflection_text: "incomplete" }) }),
    (error) => error instanceof ApiRequestError && error.kind === "malformed",
  );
  const unsafeLinks = { ...validPayload, activities: [{ ...validPayload.activities[0], youtube_url: "https://example.com/video" }] };
  await assert.rejects(
    postAnalysis(new FormData(), { fetchImpl: async () => Response.json(unsafeLinks) }),
    (error) => error instanceof ApiRequestError && error.kind === "malformed",
  );
  const missingBroadcast = { ...validPayload, wellness_broadcast: { title: "No link", reason: "", duration: "", youtube_url: "javascript:alert(1)" } };
  await assert.rejects(
    postAnalysis(new FormData(), { fetchImpl: async () => Response.json(missingBroadcast) }),
    (error) => error instanceof ApiRequestError && error.kind === "malformed",
  );
});

test("does not retry non-transient client errors", async () => {
  let attempts = 0;
  await assert.rejects(
    postAnalysis(new FormData(), { fetchImpl: async () => { attempts += 1; return Response.json({ detail: "Consent required" }, { status: 428 }); } }),
    (error) => error instanceof ApiRequestError && error.kind === "http" && !error.retryable,
  );
  assert.equal(attempts, 1);
});