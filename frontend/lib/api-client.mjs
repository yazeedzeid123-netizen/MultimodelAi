const retryableStatuses = new Set([408, 425, 429]);

export class ApiRequestError extends Error {
  constructor(message, { kind, retryable = false, status = null, cause } = {}) {
    super(message, { cause });
    this.name = "ApiRequestError";
    this.kind = kind;
    this.retryable = retryable;
    this.status = status;
  }
}

function isRetryableStatus(status) {
  return retryableStatuses.has(status) || status >= 500;
}

function isYouTubeSearchUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "www.youtube.com" && url.pathname === "/results" && Boolean(url.searchParams.get("search_query"));
  } catch {
    return false;
  }
}

function isAnalysisPayload(value) {
  const stringArray = (items) => Array.isArray(items) && items.every((item) => typeof item === "string");
  const stress = value?.stress_estimate;
  const broadcast = value?.wellness_broadcast;
  const duaa = value?.islamic_support;
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.request_id === "string" &&
    typeof value.reflection_text === "string" &&
    stress && typeof stress === "object" &&
    ["Low", "Moderate", "High", "Unclear"].includes(stress.category) &&
    ["Low", "Medium", "High"].includes(stress.confidence) &&
    typeof stress.explanation === "string" &&
    stringArray(stress.supporting_evidence) &&
    typeof stress.uncertainty === "string" &&
    stringArray(value.reported_emotions) &&
    stringArray(value.challenges) &&
    stringArray(value.accomplishments) &&
    stringArray(value.quality_flags) &&
    stringArray(value.uncertainty_notes) &&
    typeof value.gentle_question === "string" &&
    typeof value.supportive_reminder === "string" &&
    typeof value.evidence_summary === "string" &&
    broadcast && typeof broadcast.title === "string" &&
    typeof broadcast.reason === "string" &&
    typeof broadcast.duration === "string" &&
    broadcast.link_type === "search" &&
    isYouTubeSearchUrl(broadcast.youtube_url) &&
    (duaa === null || (duaa && typeof duaa === "object" &&
      typeof duaa.arabic_text === "string" && duaa.arabic_text.length > 0 &&
      typeof duaa.english_meaning === "string" && duaa.english_meaning.length > 0 &&
      (duaa.transliteration === null || typeof duaa.transliteration === "string") &&
      ["Qur'an 20:25-28", "Qur'an 2:286", "Qur'an 27:19"].includes(duaa.source) &&
      typeof duaa.relevance === "string")) &&
    Array.isArray(value.provider_trace) &&
    Number.isFinite(value.timing_ms) &&
    typeof value.save_status === "string" &&
    Array.isArray(value.activities) &&
    value.activities.every((activity) =>
      activity && typeof activity.title === "string" &&
      typeof activity.why === "string" &&
      typeof activity.duration === "string" &&
      typeof activity.first_step === "string" &&
      isYouTubeSearchUrl(activity.youtube_url)
    ) &&
    value.modality_results && typeof value.modality_results === "object"
  );
}

export async function postAnalysis(formData, { fetchImpl = fetch, apiBase = "/api", maxAttempts = 2 } = {}) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(`${apiBase}/analyze`, {
        method: "POST",
        body: formData,
        signal: AbortSignal.timeout(60_000),
      });
    } catch (cause) {
      lastError = new ApiRequestError("AURA's analysis service could not be reached.", {
        kind: "network",
        retryable: true,
        cause,
      });
      if (attempt < maxAttempts) continue;
      throw lastError;
    }

    const raw = await response.text();
    let body;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch (cause) {
      throw new ApiRequestError("AURA returned a malformed response. Please retry.", {
        kind: "malformed",
        retryable: true,
        status: response.status,
        cause,
      });
    }

    if (!response.ok) {
      const message = typeof body?.detail === "string" ? body.detail : `AURA could not process this reflection (HTTP ${response.status}).`;
      lastError = new ApiRequestError(message, {
        kind: "http",
        retryable: isRetryableStatus(response.status),
        status: response.status,
      });
      if (lastError.retryable && attempt < maxAttempts) continue;
      throw lastError;
    }

    if (!isAnalysisPayload(body)) {
      throw new ApiRequestError("AURA returned an incomplete analysis response. Please retry.", {
        kind: "malformed",
        retryable: true,
        status: response.status,
      });
    }
    return body;
  }
  throw lastError || new ApiRequestError("AURA could not process this reflection.", { kind: "network", retryable: true });
}