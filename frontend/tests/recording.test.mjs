import assert from "node:assert/strict";
import test from "node:test";
import { createRecordingFile, mediaPermissionMessage, RECORDING_LIMITS, selectRecorderOptions } from "../lib/recording.mjs";

test("selects the first browser-supported audio or video MIME type", () => {
  class Recorder {
    static isTypeSupported(type) { return type === "video/webm" || type === "audio/mp4;codecs=mp4a.40.2"; }
  }
  assert.deepEqual(selectRecorderOptions("audio", Recorder), { supported: true, options: { mimeType: "audio/mp4;codecs=mp4a.40.2" } });
  assert.deepEqual(selectRecorderOptions("video", Recorder), { supported: true, options: { mimeType: "video/webm" } });
});

test("reports unsupported browsers and recorder formats", () => {
  assert.equal(selectRecorderOptions("audio", undefined).supported, false);
  class UnsupportedRecorder { static isTypeSupported() { return false; } }
  assert.equal(selectRecorderOptions("video", UnsupportedRecorder).supported, false);
});

test("creates backend-compatible recorded files with audio/video filenames and MIME types", () => {
  const audio = createRecordingFile([new Blob(["voice"], { type: "audio/webm" })], { kind: "audio", mimeType: "audio/webm;codecs=opus", now: 123 });
  const video = createRecordingFile([new Blob(["clip"], { type: "video/webm" })], { kind: "video", mimeType: "video/webm;codecs=vp8,opus", now: 456 });
  assert.equal(audio.name, "aura-audio-123.webm");
  assert.equal(audio.type, "audio/webm");
  assert.equal(video.name, "aura-video-456.webm");
  assert.equal(video.type, "video/webm");
});

test("rejects empty recordings, unsupported MIME types, and oversize blobs", () => {
  assert.throws(() => createRecordingFile([], { kind: "audio", mimeType: "audio/webm" }), /empty/);
  assert.throws(() => createRecordingFile([new Blob(["x"])], { kind: "video", mimeType: "video/unknown" }), /unsupported/);
  assert.throws(() => createRecordingFile([new Blob([new Uint8Array(RECORDING_LIMITS.audio.maxBytes + 1)])], { kind: "audio", mimeType: "audio/webm" }), /larger than 20 MB/);
});

test("maps permission and missing-device errors to actionable messages", () => {
  assert.match(mediaPermissionMessage({ name: "NotAllowedError" }, "audio"), /microphone access/);
  assert.match(mediaPermissionMessage({ name: "NotFoundError" }, "video"), /No camera or microphone/);
});