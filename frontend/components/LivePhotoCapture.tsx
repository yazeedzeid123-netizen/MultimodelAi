"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Camera, RotateCcw, X } from "lucide-react";

type Props = { onConfirm: (file: File) => void; onCancel: () => void };

function permissionMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Allow camera access in your browser to take a photo.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "No camera was found. Connect a camera or use Photo to choose an existing image.";
  if (name === "NotReadableError" || name === "TrackStartError") return "The camera is busy or unavailable. Close other apps using it and try again.";
  return error instanceof Error ? error.message : "Could not access the camera. Check your browser permissions and try again.";
}

export default function LivePhotoCapture({ onConfirm, onCancel }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [capturedUrl, setCapturedUrl] = useState("");
  const [capturedFile, setCapturedFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [requesting, setRequesting] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mountedRef = useRef(true);

  function stopCamera() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (mountedRef.current) setStream(null);
  }

  async function openCamera() {
    setError("");
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setError("Camera access requires HTTPS or localhost and a supported browser.");
      return;
    }
    setRequesting(true);
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (!mountedRef.current) {
        camera.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = camera;
      setStream(camera);
    } catch (caught) {
      if (mountedRef.current) setError(permissionMessage(caught));
    } finally {
      if (mountedRef.current) setRequesting(false);
    }
  }

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      void videoRef.current.play().catch(() => undefined);
    }
  }, [stream]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (!capturedUrl) return;
    return () => URL.revokeObjectURL(capturedUrl);
  }, [capturedUrl]);

  async function capturePhoto() {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) {
      setError("The camera preview is not ready yet. Wait a moment and try again.");
      return;
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("This browser cannot capture the camera frame.");
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob(
        (value) => value ? resolve(value) : reject(new Error("The photo could not be created. Please try again.")),
        "image/jpeg",
        0.9,
      ));
      if (blob.size > 10 * 1024 * 1024) throw new Error("The captured photo is larger than 10 MB. Retake it and try again.");
      const file = new File([blob], `aura-photo-${Date.now()}.jpg`, { type: "image/jpeg" });
      const url = URL.createObjectURL(file);
      stopCamera();
      setCapturedFile(file);
      setCapturedUrl(url);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The photo could not be captured.");
    }
  }

  function retake() {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl("");
    setCapturedFile(null);
    setError("");
    void openCamera();
  }

  function cancel() {
    stopCamera();
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    setCapturedUrl("");
    setCapturedFile(null);
    onCancel();
  }

  return <section className="recorder-panel photo-capture-panel" aria-labelledby="photo-capture-title">
    <div className="recorder-heading">
      <div><h3 id="photo-capture-title">Take a photo</h3><span>The camera opens only after you choose to enable it.</span></div>
      <button type="button" className="icon-button" onClick={cancel} aria-label="Cancel photo capture" title="Cancel"><X size={17} /></button>
    </div>
    <p className="recorder-privacy">Your browser will ask permission to use the camera. Nothing is saved or sent when you capture a photo. Review it and choose “Use Photo” to attach it; it is submitted only when you press “Reflect with AURA”.</p>
    {capturedUrl
      ? <div className="captured-photo-preview"><Image src={capturedUrl} alt="Captured photo preview" width={640} height={480} unoptimized /></div>
      : <div className="camera-preview"><video ref={videoRef} autoPlay muted playsInline aria-label="Live camera preview" />{!stream && <span>Camera preview is off</span>}</div>}
    {error && <div className="form-error recorder-error" role="alert"><span>{error}</span></div>}
    <div className="recorder-actions">
      {!stream && !capturedFile && <button type="button" className="attach-button" onClick={openCamera} disabled={requesting}><Camera size={16} />{requesting ? "Requesting permission…" : "Open Camera"}</button>}
      {stream && !capturedFile && <button type="button" className="primary-button" onClick={capturePhoto}><Camera size={16} />Capture Photo</button>}
      {capturedFile && <>
        <button type="button" className="attach-button" onClick={retake}><RotateCcw size={15} />Retake</button>
        <button type="button" className="primary-button" onClick={() => onConfirm(capturedFile)}><Camera size={16} />Use Photo</button>
      </>}
    </div>
  </section>;
}