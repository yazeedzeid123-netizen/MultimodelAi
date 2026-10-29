"use client";

import {
  ArrowDownRight, ArrowRight, AudioLines, Check, ChevronDown, CircleHelp,
  Camera, Clock3, FileAudio, FileVideo, ImagePlus, LockKeyhole, Menu, Mic,
  PenLine, Plus, RotateCcw, Settings2, ShieldCheck, Sparkles, Trash2,
  Video, X,
} from "lucide-react";
import Image from "next/image";
import { ChangeEvent, FormEvent, useEffect, useRef, useState } from "react";
import { ApiRequestError, postAnalysis } from "../lib/api-client.mjs";
import LiveMediaRecorder from "../components/LiveMediaRecorder";
import LivePhotoCapture from "../components/LivePhotoCapture";

type Section = "today" | "history" | "privacy";
type MediaKind = "image" | "audio" | "video";
type RecordingKind = Exclude<MediaKind, "image">;
type Attachment = { file: File; kind: MediaKind; preview?: string };
type StressEstimate = {
  category: "Low" | "Moderate" | "High" | "Unclear";
  confidence: "Low" | "Medium" | "High";
  explanation: string;
  supporting_evidence: string[];
  uncertainty: string;
};
type Activity = { title: string; why: string; duration: string; first_step: string; youtube_url: string };
type WellnessBroadcast = { title: string; reason: string; duration: string; youtube_url: string; link_type: "search" };
type IslamicSupport = { arabic_text: string; english_meaning: string; transliteration: string | null; source: string; relevance: string };
type AnalysisResult = {
  request_id: string;
  reflection_text: string;
  reported_emotions: string[];
  challenges: string[];
  accomplishments: string[];
  stress_estimate: StressEstimate;
  activities: Activity[];
  wellness_broadcast?: WellnessBroadcast;
  islamic_support?: IslamicSupport | null;
  gentle_question: string;
  supportive_reminder: string;
  evidence_summary: string;
  modality_results: Record<string, { status: string; reason?: string; evidence_type?: string; transcript?: string; summary?: string; observations?: string[]; limitations?: string[]; frames_processed?: number; audio_transcribed?: boolean }>;
  fusion_verdict: string;
  quality_flags: string[];
  uncertainty_notes: string[];
  provider_trace: Array<{ provider: string; model?: string | null; status: string; reason?: string | null }>;
  timing_ms: number;
  save_status: string;
};
type Reflection = {
  id: string;
  createdAt: string;
  text: string;
  modalities: string[];
  response: string;
  analysis?: AnalysisResult;
};
type BackendStatus = { providers_configured: boolean; vision: boolean; transcription: boolean; text_generation: boolean };

const apiBase = "/api";

const maxBytes: Record<MediaKind, number> = { image: 10_485_760, audio: 20_971_520, video: 20_971_520 };
const accepted: Record<MediaKind, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp", "image/gif"],
  audio: ["audio/mpeg", "audio/wav", "audio/mp4", "audio/ogg", "audio/webm", "audio/x-m4a"],
  video: ["video/mp4", "video/webm", "video/quicktime"],
};

function makeReflection(text: string, attachments: Attachment[]): Reflection {
  const note = text.trim();
  const modalities = [...(note ? ["Text"] : []), ...attachments.map(({ kind }) => `${kind[0].toUpperCase()}${kind.slice(1)}`)];
  const response = note
    ? `You took a moment to put this into words: “${note.slice(0, 240)}${note.length > 240 ? "…" : ""}”\n\nThat is what I can reflect back from this note. I have not interpreted your attached media in this local demo, and I won't guess what you may be feeling. If a particular feeling or moment stands out to you, you can add that context in your own words.`
    : `You shared ${attachments.length === 1 ? "one piece of media" : `${attachments.length} pieces of media`}, but the local demo does not inspect media contents. I don't have enough context to offer a grounded reflection yet. You can add a sentence about what this moment means to you, or leave it here for now.`;
  return { id: crypto.randomUUID(), createdAt: new Date().toISOString(), text: note, modalities, response };
}

function describeStatus(status: string): string {
  if (status === "processed") return "Processed";
  if (status === "failed") return "Processing failed";
  if (status === "skipped") return "Not processed";
  return status;
}

function Footer() {
  return <footer className="site-footer">
    <span className="footer-brand">AURA <span>REFLECTION COMPANION</span></span>
    <span className="copyright">Copyrights for Dr Shimaa Zeid</span>
    <a href="mailto:hello@aura.example">Contact <ArrowRight size={13} aria-hidden="true" /></a>
  </footer>;
}

export default function Home() {
  const [section, setSection] = useState<Section>("today");
  const [journal, setJournal] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [error, setError] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [result, setResult] = useState<Reflection | null>(null);
  const [history, setHistory] = useState<Reflection[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [selected, setSelected] = useState<Reflection | null>(null);
  const [saved, setSaved] = useState(false);
  const [backendStatus, setBackendStatus] = useState<BackendStatus | null>(null);
  const [backendUnavailable, setBackendUnavailable] = useState(false);
  const [providerConsent, setProviderConsent] = useState(false);
  const [retryable, setRetryable] = useState(false);
  const [recorderKind, setRecorderKind] = useState<RecordingKind | null>(null);
  const [photoCaptureOpen, setPhotoCaptureOpen] = useState(false);
  const [showIslamicSupport, setShowIslamicSupport] = useState(false);
  const [copiedDuaa, setCopiedDuaa] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const stored = localStorage.getItem("aura-reflections");
        if (stored) setHistory(JSON.parse(stored) as Reflection[]);
      } catch { setHistory([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setShowIslamicSupport(localStorage.getItem("aura-show-islamic-support") === "true"); }
      catch { setShowIslamicSupport(false); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${apiBase}/ready`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("Backend readiness check failed");
        return response.json() as Promise<BackendStatus>;
      })
      .then((status) => { setBackendStatus(status); setBackendUnavailable(false); })
      .catch(() => { if (!controller.signal.aborted) setBackendUnavailable(true); });
    return () => controller.abort();
  }, []);

  function addFile(event: ChangeEvent<HTMLInputElement>, kind: MediaKind) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError("");
    setRetryable(false);
    if (!file.size) { setError("That file is empty. Choose a different file."); return; }
    if (file.size > maxBytes[kind]) { setError(`${kind[0].toUpperCase()}${kind.slice(1)} files must be smaller than ${kind === "image" ? "10" : "20"} MB.`); return; }
    if (!accepted[kind].includes(file.type)) { setError(`That ${kind} format is not supported. Choose a supported ${kind} file.`); return; }
    const preview = kind === "image" ? URL.createObjectURL(file) : undefined;
    setAttachments((current) => [...current.filter((item) => item.kind !== kind), { file, kind, preview }]);
  }

  function removeFile(kind: MediaKind) {
    setAttachments((current) => {
      const removed = current.find((item) => item.kind === kind);
      if (removed?.preview) URL.revokeObjectURL(removed.preview);
      return current.filter((item) => item.kind !== kind);
    });
  }

  function confirmRecording(kind: MediaKind, file: File) {
    setError("");
    if (!file.size) { setError("The recording is empty. Record it again before submitting."); return; }
    if (file.size > maxBytes[kind]) { setError(`The ${kind} recording is larger than ${kind === "image" ? "10" : "20"} MB.`); return; }
    if (!accepted[kind].includes(file.type)) { setError(`This browser produced an unsupported ${kind} recording format (${file.type || "unknown"}).`); return; }
    setAttachments((current) => [...current.filter((item) => item.kind !== kind), { file, kind }]);
    setRecorderKind(null);
  }

  function confirmPhotoCapture(file: File) {
    addConfirmedFile(file, "image");
    setPhotoCaptureOpen(false);
  }

  function addConfirmedFile(file: File, kind: MediaKind) {
    setError("");
    if (!file.size) { setError(`The ${kind} file is empty. Choose or capture it again.`); return; }
    if (file.size > maxBytes[kind]) { setError(`The ${kind} file is larger than ${kind === "image" ? "10" : "20"} MB.`); return; }
    if (!accepted[kind].includes(file.type)) { setError(`This ${kind} format is not supported (${file.type || "unknown"}).`); return; }
    const preview = kind === "image" ? URL.createObjectURL(file) : undefined;
    setAttachments((current) => {
      const previous = current.find((item) => item.kind === kind);
      if (previous?.preview) URL.revokeObjectURL(previous.preview);
      return [...current.filter((item) => item.kind !== kind), { file, kind, preview }];
    });
  }

  function setIslamicSupportPreference(enabled: boolean) {
    setShowIslamicSupport(enabled);
    try { localStorage.setItem("aura-show-islamic-support", String(enabled)); } catch { /* preference remains available for this session */ }
  }

  async function copyDuaa(value: string, label: string) {
    if (!navigator.clipboard?.writeText) {
      setCopiedDuaa("Clipboard is unavailable in this browser context");
      return;
    }
    try {
      await navigator.clipboard.writeText(value);
      setCopiedDuaa(`${label} copied`);
    } catch {
      setCopiedDuaa(`Could not copy ${label.toLowerCase()}`);
    }
  }

  async function analyze(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!journal.trim() && !attachments.length) { setError("Add a few words or attach a photo, recording, or video to begin."); return; }
    setAnalyzing(true);
    setResult(null);
    setSaved(false);
    const payload = new FormData();
    if (journal.trim()) payload.append("text", journal.trim());
    attachments.forEach((item) => payload.append(item.kind, item.file, item.file.name));
    payload.append("consent_to_provider", String(providerConsent));
    payload.append("show_islamic_support", String(showIslamicSupport));
    try {
      const analysis = await postAnalysis(payload) as AnalysisResult;
      const modalities = Object.entries(analysis.modality_results)
        .filter(([, value]) => value.status === "processed")
        .map(([name]) => `${name[0].toUpperCase()}${name.slice(1)}`);
      setResult({
        id: analysis.request_id,
        createdAt: new Date().toISOString(),
        text: journal.trim(),
        modalities,
        response: analysis.reflection_text,
        analysis,
      });
      setBackendUnavailable(false);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Unable to reach the AURA backend.";
      if (caught instanceof ApiRequestError && caught.kind === "network") {
        setBackendUnavailable(true);
        setError("AURA's analysis service is unavailable. Showing a local fallback; attached media was not analyzed.");
        setRetryable(true);
        const fallback = makeReflection(journal, attachments);
        fallback.analysis = {
          request_id: fallback.id,
          reflection_text: fallback.response,
          reported_emotions: [],
          challenges: [],
          accomplishments: [],
          stress_estimate: { category: "Unclear", confidence: "Low", explanation: "The analysis service was unavailable, so no stress estimate was made.", supporting_evidence: [], uncertainty: "This local fallback does not analyze text or media for stress." },
          activities: [],
          gentle_question: "What part of today, if any, felt most demanding?",
          supportive_reminder: "This local fallback is not a clinical assessment. No AI analysis was performed.",
          evidence_summary: "Only a local fallback response was generated; no modality was semantically analyzed.",
          modality_results: Object.fromEntries(attachments.map((item) => [item.kind, { status: "skipped", reason: "backend_unavailable" }])),
          fusion_verdict: "UNCERTAIN",
          quality_flags: ["backend_unavailable", "media_not_analyzed"],
          uncertainty_notes: ["The backend could not be reached. No AI analysis was performed."],
          provider_trace: [],
          timing_ms: 0,
          save_status: "not_saved",
        };
        setResult(fallback);
      } else {
        setError(message);
        setRetryable(caught instanceof ApiRequestError && caught.retryable);
      }
    } finally {
      setAnalyzing(false);
    }
    window.setTimeout(() => document.getElementById("reflection-result")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  function saveReflection(item: Reflection) {
    const next = [item, ...history.filter((record) => record.id !== item.id)];
    setHistory(next);
    localStorage.setItem("aura-reflections", JSON.stringify(next));
    setSaved(true);
  }

  function deleteReflection(id: string) {
    const next = history.filter((item) => item.id !== id);
    setHistory(next);
    localStorage.setItem("aura-reflections", JSON.stringify(next));
    if (selected?.id === id) setSelected(null);
  }

  function navigate(target: Section) {
    setSection(target);
    setSelected(null);
    setMenuOpen(false);
  }

  function reset() {
    attachments.forEach((item) => item.preview && URL.revokeObjectURL(item.preview));
    setJournal(""); setAttachments([]); setResult(null); setError(""); setSaved(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }).toUpperCase();
  const title: Record<Section, string> = { today: "Today", history: "Your reflections", privacy: "Privacy & settings" };
  const consentNeeded = Boolean(backendStatus && (
    (journal.trim() && backendStatus.text_generation) ||
    (attachments.some((item) => item.kind === "image") && backendStatus.vision) ||
    (attachments.some((item) => item.kind === "audio") && backendStatus.transcription) ||
    (attachments.some((item) => item.kind === "video") && (backendStatus.vision || backendStatus.transcription))
  ));

  return <div className="app-shell">
    <aside className={`sidebar${menuOpen ? " sidebar-open" : ""}`}>
      <button className="brand-lockup" onClick={() => navigate("today")} aria-label="AURA home">
        <span className="brand-mark"><AudioLines size={21} strokeWidth={2.2} /></span><span>AURA<small>DAILY REFLECTION</small></span>
      </button>
      <div className="nav-caption">YOUR SPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        <button className={`nav-link${section === "today" ? " active" : ""}`} onClick={() => navigate("today")}><PenLine size={17} />Today</button>
        <button className={`nav-link${section === "history" ? " active" : ""}`} onClick={() => navigate("history")}><Clock3 size={17} />Your reflections</button>
        <button className={`nav-link${section === "privacy" ? " active" : ""}`} onClick={() => navigate("privacy")}><ShieldCheck size={17} />Privacy & settings</button>
      </nav>
      <div className="sidebar-bottom">
        <div className="privacy-mini"><LockKeyhole size={15} /><span>Your space, at your pace.</span></div>
        <button className="profile-button" onClick={() => navigate("privacy")}><span className="avatar">S</span><span className="profile-copy">Guest space<small>Demo mode</small></span><ChevronDown size={15} /></button>
      </div>
    </aside>

    <div className="main-column">
      <header className="topbar">
        <button className="mobile-menu icon-button" onClick={() => setMenuOpen((open) => !open)} aria-label="Toggle navigation">{menuOpen ? <X size={20} /> : <Menu size={20} />}</button>
        <div className="breadcrumbs"><span>YOUR SPACE</span><ArrowRight size={13} /><strong>{title[section]}</strong></div>
        <div className="topbar-right"><span className="demo-indicator"><span />{backendStatus?.providers_configured ? "AI PROVIDER" : backendUnavailable ? "LOCAL FALLBACK" : "MOCK MODE"}</span><button className="help-button" title="About AURA" onClick={() => navigate("privacy")}><CircleHelp size={18} /></button></div>
      </header>

      <main className="page-content">
        {section === "today" && <>
          <section className="welcome-row">
            <div><div className="eyebrow"><span className="eyebrow-line" />{today}</div>
              <h1>Understand Your Day.<br /><span>Find Your Balance.</span></h1>
              <p className="welcome-description">A little space to notice what mattered. Start with a sentence, a moment, or simply how today felt to you.</p>
            </div>
            <div className="welcome-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-sun" /><div className="art-leaf leaf-one" /><div className="art-leaf leaf-two" /><span className="art-caption">A MOMENT, JUST FOR YOU</span></div>
          </section>

          <div className="section-heading"><div><span className="section-index">01</span><h2>Today, as it was</h2></div><span className="optional-note">No perfect words needed <ArrowDownRight size={15} /></span></div>

          <form className="composer" onSubmit={analyze}>
            <div className="composer-topline"><label htmlFor="journal-entry">YOUR NOTES <span>OPTIONAL</span></label><span className="privacy-inline"><LockKeyhole size={13} />Not saved unless you choose</span></div>
            <textarea id="journal-entry" value={journal} onChange={(event) => setJournal(event.target.value)} placeholder="What stayed with you today? A conversation, a small win, something you are still thinking about..." rows={5} maxLength={5000} />
            <div className="textarea-foot"><span>{journal.length.toLocaleString()} / 5,000</span><span>Only share what feels right.</span></div>
            <div className="prompt-row"><span className="prompt-label">A place to begin</span>
              <button type="button" className="prompt-chip" onClick={() => setJournal((text) => `${text}${text ? "\n\n" : ""}One moment I want to remember is...`)}>One moment I want to remember</button>
              <button type="button" className="prompt-chip" onClick={() => setJournal((text) => `${text}${text ? "\n\n" : ""}Something that felt challenging today was...`)}>Something that felt challenging</button>
            </div>
            <div className="attach-area">
              <div className="attach-header"><span>ADD CONTEXT <span className="optional-tag">OPTIONAL</span></span><span>Text alone is always enough.</span></div>
              <div className="attach-actions">
                <button type="button" className="attach-button" onClick={() => imageInput.current?.click()}><ImagePlus size={17} /><span>Photo</span><Plus size={14} className="attach-plus" /></button>
                <button type="button" className="attach-button" onClick={() => { setError(""); setPhotoCaptureOpen(true); }}><Camera size={17} /><span>Take a Photo</span></button>
                <button type="button" className="attach-button" onClick={() => { setError(""); setRecorderKind("audio"); }}><Mic size={17} /><span>Record audio</span><Plus size={14} className="attach-plus" /></button>
                <button type="button" className="attach-button" onClick={() => { setError(""); setRecorderKind("video"); }}><Video size={17} /><span>Record video</span><Plus size={14} className="attach-plus" /></button>
                <input ref={imageInput} type="file" accept={accepted.image.join(",")} className="visually-hidden" onChange={(event) => addFile(event, "image")} aria-label="Choose an image" />
              </div>
              {photoCaptureOpen && <LivePhotoCapture onConfirm={confirmPhotoCapture} onCancel={() => setPhotoCaptureOpen(false)} />}
              {recorderKind && <LiveMediaRecorder kind={recorderKind} onConfirm={(file) => confirmRecording(recorderKind, file)} onCancel={() => setRecorderKind(null)} />}
              {attachments.length > 0 && <div className="attachment-list" aria-label="Attached files">{attachments.map((item) => <div className="attachment-item" key={item.kind}>
                {item.preview ? <Image src={item.preview} alt="Selected image preview" width={30} height={30} unoptimized /> : item.kind === "audio" ? <FileAudio size={19} /> : <FileVideo size={19} />}
                <span><strong>{item.file.name}</strong><small>{(item.file.size / 1024 / 1024).toFixed(1)} MB · {item.kind}</small></span>
                <button type="button" className="remove-file" aria-label={`Remove ${item.kind}`} onClick={() => removeFile(item.kind)}><X size={16} /></button>
              </div>)}</div>}
            </div>
            {consentNeeded && <label className="provider-consent">
              <input type="checkbox" checked={providerConsent} onChange={(event) => setProviderConsent(event.target.checked)} />
              <span>I agree to send the text and selected media in this reflection to the configured AI provider for processing. The provider may retain data under its own policies.</span>
            </label>}
            {error && <div role="alert" className="form-error"><CircleHelp size={16} /><span>{error}</span>{retryable && <button type="submit" className="retry-button" disabled={analyzing}>Retry</button>}</div>}
            <div className="composer-submit"><span className="submit-note"><ShieldCheck size={15} />No diagnosis. Your words lead.</span>
              <button type="submit" className="primary-button" disabled={analyzing || Boolean(consentNeeded && !providerConsent)}>{analyzing ? <><span className="spinner" />Taking a moment...</> : <>Reflect with AURA <ArrowRight size={16} /></>}</button>
            </div>
          </form>

          {analyzing && <div className="processing-state" role="status"><span className="processing-pulse" /><div><strong>Making space for your reflection</strong><small>{backendStatus?.providers_configured ? "Processing with the configured provider you consented to." : "Using configured analysis capabilities; skipped modalities will be identified."}</small></div></div>}
          {result && !analyzing && <section className="result-panel" id="reflection-result" aria-live="polite">
            <div className="result-heading"><div><span className="eyebrow"><Sparkles size={14} />YOUR REFLECTION</span><h2>A moment to take with you</h2></div><button className="text-button" onClick={reset}><RotateCcw size={15} />Start again</button></div>
            <div className="result-copy">{(result.analysis?.reflection_text || result.response).split("\n\n").map((part, index) => <p key={index}>{part}</p>)}</div>
            {result.analysis && <>
              {(result.analysis.reported_emotions.length > 0 || result.analysis.accomplishments.length > 0 || result.analysis.challenges.length > 0) && <div className="reported-context">
                {result.analysis.reported_emotions.length > 0 && <p><strong>Your reported feelings</strong><span>{result.analysis.reported_emotions.join(" · ")}</span></p>}
                {result.analysis.accomplishments.length > 0 && <p><strong>What went well</strong><span>{result.analysis.accomplishments.join(" ")}</span></p>}
                {result.analysis.challenges.length > 0 && <p><strong>What felt challenging</strong><span>{result.analysis.challenges.join(" ")}</span></p>}
              </div>}
              <section className={`stress-card stress-${result.analysis.stress_estimate.category.toLowerCase()}`}>
                <div className="result-section-kicker">YOUR POSSIBLE STRESS LEVEL <span className="nonclinical-label">NON-CLINICAL ESTIMATE</span></div>
                <div className="stress-title-row"><strong>{result.analysis.stress_estimate.category}</strong><span>Confidence: {result.analysis.stress_estimate.confidence}</span></div>
                <p>{result.analysis.stress_estimate.explanation}</p>
                {result.analysis.stress_estimate.supporting_evidence.length > 0 && <ul>{result.analysis.stress_estimate.supporting_evidence.map((item, index) => <li key={index}>“{item}”</li>)}</ul>}
                <p className="uncertainty-copy">{result.analysis.stress_estimate.uncertainty}</p>
              </section>
              {result.analysis.wellness_broadcast && <section className="broadcast-card">
                <div className="result-section-kicker">YOUR PERSONALIZED WELLNESS BROADCAST</div>
                <div className="broadcast-heading"><h3>{result.analysis.wellness_broadcast.title}</h3><span>{result.analysis.wellness_broadcast.duration}</span></div>
                <p>{result.analysis.wellness_broadcast.reason}</p>
                <a className="broadcast-link" href={result.analysis.wellness_broadcast.youtube_url} target="_blank" rel="noopener noreferrer">Watch on YouTube <ArrowRight size={14} /></a>
                <span className="broadcast-link-note">YouTube search results; no specific video is claimed as verified.</span>
              </section>}
              {showIslamicSupport && result.analysis.islamic_support && <section className="duaa-card">
                <div className="result-section-kicker">A DUAA FOR YOUR HEART <span lang="ar" dir="rtl">| دعاء لقلبك</span></div>
                <p className="duaa-arabic" lang="ar" dir="rtl">{result.analysis.islamic_support.arabic_text}</p>
                <p className="duaa-meaning"><strong>English meaning</strong><br />{result.analysis.islamic_support.english_meaning}</p>
                {result.analysis.islamic_support.transliteration && <p className="duaa-transliteration"><strong>Transliteration</strong><br />{result.analysis.islamic_support.transliteration}</p>}
                <p className="duaa-source"><strong>Source:</strong> {result.analysis.islamic_support.source}</p>
                <p>{result.analysis.islamic_support.relevance}</p>
                <div className="duaa-actions">
                  <button type="button" className="text-button" onClick={() => { void copyDuaa(result.analysis!.islamic_support!.arabic_text, "Arabic"); }}>Copy Arabic</button>
                  <button type="button" className="text-button" onClick={() => { void copyDuaa(result.analysis!.islamic_support!.english_meaning, "Meaning"); }}>Copy meaning</button>
                  {copiedDuaa && <span role="status">{copiedDuaa}</span>}
                </div>
                <p className="duaa-optional-note">Optional spiritual support, only shown because you enabled it. It is not a diagnosis or a replacement for other support.</p>
              </section>}
              <section className="evidence-section">
                <div className="result-section-kicker">WHAT THIS IS BASED ON</div>
                <p className="evidence-summary">{result.analysis.evidence_summary}</p>
                <div className="modality-evidence">{Object.entries(result.analysis.modality_results).map(([name, item]) => <article className="modality-row" key={name}>
                  <span className={`modality-status status-${item.status}`}>{describeStatus(item.status)}</span>
                  <div><strong>{name[0].toUpperCase()}{name.slice(1)}</strong>
                    {item.reason && <p>{item.reason.replaceAll("_", " ")}</p>}
                    {item.summary && <p>{item.summary}</p>}
                    {item.observations && item.observations.length > 0 && <p>{item.observations.join(" · ")}</p>}
                    {item.transcript && <p>Transcript: “{item.transcript}”</p>}
                    {item.frames_processed !== undefined && item.status === "processed" && <p>{item.frames_processed} sampled video frames processed.</p>}
                    {item.audio_transcribed !== undefined && <p>Video audio transcript: {item.audio_transcribed ? "processed" : "not available or not processed"}.</p>}
                  </div>
                </article>)}</div>
                {result.analysis.uncertainty_notes.map((note, index) => <p className="uncertainty-note" key={index}>{note}</p>)}
              </section>
              {result.analysis.activities.length > 0 && <section className="activities-section">
                <div className="result-section-kicker">SMALL THINGS YOU COULD TRY TODAY</div>
                <div className="activity-list">{result.analysis.activities.map((activity, index) => <article className="activity-item" key={`${activity.title}-${index}`}>
                  <div className="activity-number">0{index + 1}</div><div className="activity-body"><div className="activity-title-row"><h3>{activity.title}</h3><span>{activity.duration}</span></div>
                    <p>{activity.why}</p><p className="activity-first-step"><strong>First step:</strong> {activity.first_step}</p>
                    <a href={activity.youtube_url} target="_blank" rel="noreferrer">Find a guided resource on YouTube <ArrowRight size={13} /></a>
                  </div>
                </article>)}</div>
              </section>}
              <section className="gentle-question"><div className="result-section-kicker">ONE GENTLE QUESTION</div><p>{result.analysis.gentle_question}</p></section>
              <p className="supportive-reminder"><ShieldCheck size={16} />{result.analysis.supportive_reminder}</p>
            </>}
            <div className="result-actions"><button className="save-button" onClick={() => saveReflection(result)}><Check size={16} />{saved ? "Saved in this browser" : "Save to this browser"}</button><button className="text-button" onClick={() => navigator.clipboard?.writeText(result.response)}><PenLine size={15} />Copy reflection</button></div>
            <p className="saved-note"><LockKeyhole size={13} />Saving keeps a copy in this browser. Analysis requests are sent to the configured AURA backend; external provider processing requires your consent.</p>
          </section>}
          <div className="bottom-note"><span className="note-mark">“</span><p>Reflection is not a checklist. Come back when it feels useful.</p><span className="note-attribution">AURA, FOR YOUR EVERYDAY</span></div>
        </>}

        {section === "history" && <section className="inner-page">
          <div className="eyebrow"><span className="eyebrow-line" />YOUR PRIVATE ARCHIVE</div>
          <div className="inner-title-row"><div><h1>Your reflections</h1><p className="welcome-description">A record you chose to keep. There is no streak to maintain and no pace to meet.</p></div><button className="primary-button compact" onClick={() => navigate("today")}><Plus size={16} />New reflection</button></div>
          {selected ? <article className="history-detail"><button className="text-button" onClick={() => setSelected(null)}>← All reflections</button><div className="history-date">{new Date(selected.createdAt).toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" })}</div><h2>A moment to take with you</h2><p>{selected.response}</p>{selected.analysis && <><div className="saved-analysis-summary"><strong>Possible stress level: {selected.analysis.stress_estimate.category}</strong><span>Confidence: {selected.analysis.stress_estimate.confidence}</span><p>{selected.analysis.stress_estimate.explanation}</p><p>{selected.analysis.stress_estimate.uncertainty}</p></div><h3>Small things you could try</h3><div className="saved-activities">{selected.analysis.activities.map((activity, index) => <article key={`${activity.title}-${index}`}><strong>{activity.title}</strong><span>{activity.duration}</span><p>{activity.why}</p><a href={activity.youtube_url} target="_blank" rel="noreferrer">Find a guided resource on YouTube <ArrowRight size={13} /></a></article>)}</div><p className="supportive-reminder">{selected.analysis.supportive_reminder}</p></>}<div className="history-tags">{selected.modalities.map((tag) => <span key={tag}>{tag}</span>)}</div><button className="delete-button" onClick={() => deleteReflection(selected.id)}><Trash2 size={15} />Delete this reflection</button></article> : history.length === 0 ? <div className="empty-state"><div className="empty-icon"><PenLine size={23} /></div><h2>Nothing saved yet</h2><p>When you choose to save a reflection, it will appear here. Your entries stay in this browser.</p><button className="text-button" onClick={() => navigate("today")}>Start a reflection <ArrowRight size={15} /></button></div> : <div className="history-list">{history.map((item) => <article className="history-item" key={item.id}><div className="history-date">{new Date(item.createdAt).toLocaleDateString(undefined, { dateStyle: "long" })}<span>{item.modalities.join(" · ") || "Reflection"}</span></div><p>{item.text || "A media-only reflection"}</p><div className="history-item-actions"><button className="text-button" onClick={() => setSelected(item)}>Read reflection <ArrowRight size={14} /></button><button className="icon-button delete-icon" aria-label="Delete reflection" onClick={() => deleteReflection(item.id)}><Trash2 size={15} /></button></div></article>)}</div>}
        </section>}

        {section === "privacy" && <section className="inner-page">
          <div className="eyebrow"><span className="eyebrow-line" />YOUR CHOICES</div>
          <div className="inner-title-row"><div><h1>Privacy, by design</h1><p className="welcome-description">Clear about what happens here, and what does not.</p></div></div>
          <div className="privacy-status"><span className="status-icon"><ShieldCheck size={21} /></span><div><span className="status-label">CURRENT MODE</span><h2>{backendUnavailable ? "Backend unavailable" : backendStatus?.providers_configured ? "Configured AI provider" : "AURA mock analysis"}</h2><p>Reflection requests are sent to the configured AURA backend. {backendStatus?.providers_configured ? "Selected inputs may be sent to its AI provider only after you opt in for that request." : backendUnavailable ? "No analysis request can be completed until the backend is available; local fallback is clearly marked." : "No third-party AI provider is configured; media understanding and transcription are unavailable."}</p></div><span className="status-pill">{backendStatus?.providers_configured ? "CONSENT REQUIRED" : backendUnavailable ? "OFFLINE" : "NO AI PROVIDER"}</span></div>
          <div className="settings-list">
            <article className="settings-row"><div className="settings-icon"><span aria-hidden="true">دعاء</span></div><div><h3>Islamic spiritual support</h3><p>Choose whether AURA may include a short Qur&apos;anic supplication with its verified verse reference in your results. This is optional and can be turned off at any time.</p></div><label className="support-toggle"><input type="checkbox" checked={showIslamicSupport} onChange={(event) => setIslamicSupportPreference(event.target.checked)} /><span>Show Islamic spiritual support</span></label></article>
            <article className="settings-row"><div className="settings-icon"><LockKeyhole size={18} /></div><div><h3>Your journal and media</h3><p>Inputs are sent to the AURA backend for the analysis request. When an AI capability is configured, the page asks for your consent before sending selected inputs to that provider. Unconfigured or failed modalities are identified in the result.</p></div><span className="settings-value">Per-request consent</span></article>
            <article className="settings-row"><div className="settings-icon"><Check size={18} /></div><div><h3>Saved reflections</h3><p>Only saved when you choose “Save to this browser”. Saved entries use this browser&apos;s local storage and are not encrypted or synced.</p></div><span className="settings-value">Opt in</span></article>
            <article className="settings-row"><div className="settings-icon"><Settings2 size={18} /></div><div><h3>Clear saved data</h3><p>Remove all reflections stored in this browser. This cannot be undone.</p></div><button className="outline-button" onClick={() => { setHistory([]); setSelected(null); localStorage.removeItem("aura-reflections"); }}>Clear data</button></article>
          </div>
          <div className="privacy-caution"><CircleHelp size={17} /><p>This demo does not provide authentication, encrypted cloud storage, or account-level deletion. Do not use a shared browser for sensitive journal entries.</p></div>
        </section>}
      </main>
      <Footer />
    </div>
  </div>;
}