export const RECORDING_LIMITS = {
  audio: { maxBytes: 20 * 1024 * 1024, maxSeconds: 300 },
  video: { maxBytes: 20 * 1024 * 1024, maxSeconds: 60 },
};

const formats = {
  audio: ["audio/webm;codecs=opus", "audio/mp4;codecs=mp4a.40.2", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"],
  video: ["video/webm;codecs=vp8,opus", "video/webm;codecs=vp9,opus", "video/mp4", "video/webm"],
};

const supportedOutputTypes = {
  audio: new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"]),
  video: new Set(["video/webm", "video/mp4", "video/quicktime"]),
};

const extensions = {
  "audio/webm": "webm",
  "audio/mp4": "m4a",
  "audio/ogg": "ogg",
  "audio/wav": "wav",
  "audio/mpeg": "mp3",
  "video/webm": "webm",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

export function selectRecorderOptions(kind, Recorder = globalThis.MediaRecorder) {
  if (!Recorder) return { supported: false, options: {} };
  if (typeof Recorder.isTypeSupported !== "function") return { supported: true, options: {} };
  const mimeType = formats[kind]?.find((candidate) => Recorder.isTypeSupported(candidate));
  return mimeType ? { supported: true, options: { mimeType } } : { supported: false, options: {} };
}

export function createRecordingFile(chunks, { kind, mimeType = "", now = Date.now(), FileClass = globalThis.File } = {}) {
  const detectedType = (mimeType || chunks.find((chunk) => chunk?.type)?.type || "").split(";")[0].toLowerCase();
  if (!supportedOutputTypes[kind]?.has(detectedType)) {
    throw new Error(`The browser produced an unsupported ${kind} recording format.`);
  }
  if (typeof FileClass !== "function") {
    throw new Error("This browser cannot prepare a recording file.");
  }
  const extension = extensions[detectedType];
  const file = new FileClass(chunks, `aura-${kind}-${now}.${extension}`, { type: detectedType, lastModified: now });
  if (!file.size) throw new Error("The recording is empty. Please record again.");
  if (file.size > RECORDING_LIMITS[kind].maxBytes) {
    throw new Error(`The recording is larger than ${Math.round(RECORDING_LIMITS[kind].maxBytes / 1024 / 1024)} MB. Please record a shorter clip.`);
  }
  return file;
}

export function mediaPermissionMessage(error, kind) {
  if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
    return `Allow ${kind === "audio" ? "microphone" : "camera and microphone"} access in your browser to record.`;
  }
  if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
    return `No ${kind === "audio" ? "microphone" : "camera or microphone"} was found. Connect a device and try again.`;
  }
  if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
    return "The media device is busy or unavailable. Close other apps using it and try again.";
  }
  if (error?.name === "AbortError") return "The recording device could not start. Please try again.";
  return "Could not access the recording device. Check your browser permissions and try again.";
}