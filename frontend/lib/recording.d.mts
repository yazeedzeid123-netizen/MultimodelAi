export type RecordingKind = "audio" | "video";
export const RECORDING_LIMITS: Record<RecordingKind, { maxBytes: number; maxSeconds: number }>;
export function selectRecorderOptions(kind: RecordingKind, Recorder?: typeof MediaRecorder): { supported: boolean; options: MediaRecorderOptions };
export function createRecordingFile(chunks: Blob[], options: { kind: RecordingKind; mimeType?: string; now?: number; FileClass?: typeof File }): File;
export function mediaPermissionMessage(error: unknown, kind: RecordingKind): string;