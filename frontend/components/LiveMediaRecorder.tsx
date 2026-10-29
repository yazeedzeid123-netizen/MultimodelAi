"use client";

import { useEffect, useRef, useState } from "react";
import { Mic, Pause, Play, RotateCcw, Square, Video, X } from "lucide-react";
import {
  createRecordingFile,
  mediaPermissionMessage,
  RECORDING_LIMITS,
  selectRecorderOptions,
  type RecordingKind,
} from "../lib/recording.mjs";

type Phase = "idle" | "requesting" | "preview" | "recording" | "paused" | "recorded" | "error";

type Props = {
  kind: RecordingKind;
  onConfirm: (file: File) => void;
  onCancel: () => void;
};

function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

export default function LiveMediaRecorder({ kind, onConfirm, onCancel }: Props) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [recordingFile, setRecordingFile] = useState<File | null>(null);
  const [playbackUrl, setPlaybackUrl] = useState("");
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const byteCountRef = useRef(0);
  const elapsedRef = useRef(0);
  const intervalRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLVideoElement>(null);
  const playbackRef = useRef<HTMLAudioElement | HTMLVideoElement>(null);
  const mountedRef = useRef(true);

  const isVideo = kind === "video";
  const label = isVideo ? "video" : "audio";
  const limit = RECORDING_LIMITS[kind];

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) setPreviewStream(null);
  }

  function stopTimer() {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  function startTimer() {
    stopTimer();
    intervalRef.current = window.setInterval(() => {
      const next = elapsedRef.current + 1;
      elapsedRef.current = next;
      if (mountedRef.current) setElapsed(next);
      if (next >= limit.maxSeconds) {
        setError(`Maximum recording time reached (${formatTime(limit.maxSeconds)}). Review the clip before using it.`);
        const recorder = recorderRef.current;
        if (recorder?.state === "recording") recorder.stop();
      }
    }, 1000);
  }

  async function requestStream() {
    const devices = navigator.mediaDevices;
    if (!window.isSecureContext || !devices?.getUserMedia) {
      throw new Error("Recording requires a secure page (HTTPS or localhost) and a browser with media-device support.");
    }
    if (typeof MediaRecorder === "undefined") {
      throw new Error("This browser does not support MediaRecorder. Try a current version of Chrome, Edge, Firefox, or Safari.");
    }
    const selection = selectRecorderOptions(kind);
    if (!selection.supported) {
      throw new Error(`This browser does not support a recording format accepted for ${label}.`);
    }
    const stream = await devices.getUserMedia(isVideo ? { audio: true, video: true } : { audio: true });
    streamRef.current = stream;
    if (mountedRef.current) setPreviewStream(stream);
    return { stream, selection };
  }

  async function enablePreview() {
    setError("");
    setPhase("requesting");
    try {
      const { stream } = await requestStream();
      if (mountedRef.current) setPhase("preview");
      if (previewRef.current) {
        previewRef.current.srcObject = stream;
        await previewRef.current.play().catch(() => undefined);
      }
    } catch (caught) {
      stopTracks();
      if (mountedRef.current) {
        setPhase("error");
        setError(caught instanceof Error && !["NotAllowedError", "NotFoundError", "NotReadableError", "AbortError"].includes((caught as DOMException).name)
          ? caught.message
          : mediaPermissionMessage(caught, kind));
      }
    }
  }

  async function startRecording() {
    setError("");
    setPhase("requesting");
    try {
      const current = streamRef.current;
      const { stream, selection } = current
        ? { stream: current, selection: selectRecorderOptions(kind) }
        : await requestStream();
      if (!selection.supported) throw new Error(`This browser does not support a recording format accepted for ${label}.`);
      const recorder = new MediaRecorder(stream, selection.options);
      chunksRef.current = [];
      byteCountRef.current = 0;
      recorderRef.current = recorder;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (!event.data.size) return;
        chunksRef.current.push(event.data);
        byteCountRef.current += event.data.size;
        if (byteCountRef.current > limit.maxBytes && recorder.state === "recording") {
          setError(`The recording exceeded ${Math.round(limit.maxBytes / 1024 / 1024)} MB and was stopped. Please try a shorter clip.`);
          recorder.stop();
        }
      };
      recorder.onerror = () => {
        stopTimer();
        stopTracks();
        if (mountedRef.current) {
          setPhase("error");
          setError("The browser could not record this media. Please try again.");
        }
      };
      recorder.onstop = () => {
        stopTimer();
        stopTracks();
        if (!mountedRef.current) return;
        try {
          const file = createRecordingFile(chunksRef.current, { kind, mimeType: recorder.mimeType });
          setRecordingFile(file);
          setPlaybackUrl(URL.createObjectURL(file));
          setPhase("recorded");
        } catch (caught) {
          setPhase("error");
          setError(caught instanceof Error ? caught.message : "The recording could not be prepared.");
        }
      };
      elapsedRef.current = 0;
      setElapsed(0);
      recorder.start(1000);
      setPhase("recording");
      startTimer();
    } catch (caught) {
      stopTracks();
      if (mountedRef.current) {
        setPhase("error");
        const name = caught instanceof DOMException ? caught.name : "";
        setError(name ? mediaPermissionMessage(caught, kind) : caught instanceof Error ? caught.message : "Could not start recording.");
      }
    }
  }

  function stopRecording() {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }

  function pauseOrResume() {
    const recorder = recorderRef.current;
    if (!recorder) return;
    if (recorder.state === "recording") {
      recorder.pause();
      stopTimer();
      setPhase("paused");
    } else if (recorder.state === "paused") {
      recorder.resume();
      setPhase("recording");
      startTimer();
    }
  }

  function retake() {
    stopTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") {
      recorder.onstop = null;
      recorder.ondataavailable = null;
      recorder.stop();
    }
    stopTracks();
    chunksRef.current = [];
    byteCountRef.current = 0;
    setRecordingFile(null);
    setError("");
    setElapsed(0);
    elapsedRef.current = 0;
    if (playbackUrl) URL.revokeObjectURL(playbackUrl);
    setPlaybackUrl("");
    setPhase("idle");
  }

  async function playRecording() {
    try {
      await playbackRef.current?.play();
    } catch {
      setError("Playback could not start. Use the player controls to try again.");
    }
  }

  function confirmRecording() {
    if (!recordingFile) return;
    onConfirm(recordingFile);
  }

  function cancel() {
    retake();
    onCancel();
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stopTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        recorder.onstop = null;
        recorder.ondataavailable = null;
        recorder.stop();
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!playbackUrl) return;
    return () => URL.revokeObjectURL(playbackUrl);
  }, [playbackUrl]);

  useEffect(() => {
    if (previewRef.current && previewStream) previewRef.current.srcObject = previewStream;
  }, [previewStream]);

  return <section className="recorder-panel" aria-labelledby={`${kind}-recorder-title`}>
    <div className="recorder-heading">
      <div><h3 id={`${kind}-recorder-title`}>{isVideo ? "Record a video" : "Record audio"}</h3><span>{isVideo ? "Up to 01:00 · 20 MB maximum" : "Up to 05:00 · 20 MB maximum"}</span></div>
      <button type="button" className="icon-button" onClick={cancel} aria-label={`Cancel ${label} recording`} title="Cancel"><X size={17} /></button>
    </div>
    <p className="recorder-privacy">Your browser will ask permission to use the {isVideo ? "camera and microphone" : "microphone"}. Nothing is sent while recording. Review it and choose “Use recording” to add it to this reflection; it is submitted only when you press “Reflect with AURA”.</p>

    {isVideo && phase !== "recorded" && <div className="camera-preview">
      <video ref={previewRef} autoPlay muted playsInline aria-label="Live camera preview" />
      {phase !== "preview" && phase !== "recording" && phase !== "paused" && <span>Camera preview is off</span>}
    </div>}
    {phase === "recorded" && playbackUrl && <div className="recorded-preview">
      {isVideo
        ? <video ref={playbackRef as React.RefObject<HTMLVideoElement>} src={playbackUrl} controls playsInline aria-label="Recorded video preview" />
        : <audio ref={playbackRef as React.RefObject<HTMLAudioElement>} src={playbackUrl} controls aria-label="Recorded audio playback" />}
    </div>}

    <div className="recorder-controls">
      <span className={`recording-status${phase === "recording" ? " is-recording" : ""}`} role="status" aria-live="polite">
        {phase === "requesting" ? "Requesting permission…" : phase === "recording" ? "Recording" : phase === "paused" ? "Paused" : phase === "recorded" ? "Ready to review" : phase === "preview" ? "Camera ready" : phase === "error" ? "Recording unavailable" : "Ready"}
      </span>
      <span className="recording-timer" aria-label={`Elapsed time ${formatTime(elapsed)}`}>{formatTime(elapsed)} / {formatTime(limit.maxSeconds)}</span>
    </div>
    {error && <div className="form-error recorder-error" role="alert"><span>{error}</span></div>}

    <div className="recorder-actions">
      {phase === "idle" && isVideo && <button type="button" className="attach-button" onClick={enablePreview}><Video size={16} />Enable camera preview</button>}
      {(phase === "idle" && !isVideo || phase === "preview" || phase === "error") && <button type="button" className="primary-button" onClick={startRecording}><Mic size={16} />Start Recording</button>}
      {(phase === "recording" || phase === "paused") && <>
        <button type="button" className="attach-button" onClick={pauseOrResume}><Pause size={15} />{phase === "paused" ? "Resume" : "Pause"}</button>
        <button type="button" className="primary-button" onClick={stopRecording}><Square size={14} />Stop Recording</button>
      </>}
      {phase === "recorded" && <>
        <button type="button" className="attach-button" onClick={playRecording}><Play size={15} />Play {isVideo ? "Preview" : "Recording"}</button>
        <button type="button" className="attach-button" onClick={retake}><RotateCcw size={15} />Retake</button>
        <button type="button" className="primary-button" onClick={confirmRecording}><CheckIcon />Use recording</button>
      </>}
    </div>
  </section>;
}

function CheckIcon() {
  return <span aria-hidden="true">✓</span>;
}