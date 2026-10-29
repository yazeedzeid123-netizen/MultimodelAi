import { expect, test } from "@playwright/test";

async function waitForRecording(page: import("@playwright/test").Page) {
  await expect(page.getByRole("status").filter({ hasText: "Recording" })).toBeVisible();
  await expect(page.getByLabel(/Elapsed time/)).not.toHaveText(/^00:00/, { timeout: 8_000 });
}

test("audio can record, pause/resume, play, retake, and submit only after confirmation", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Record audio" }).click();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await waitForRecording(page);
  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Paused" })).toBeVisible();
  await page.getByRole("button", { name: "Resume" }).click();
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await page.getByRole("button", { name: "Play Recording" }).waitFor();
  await page.locator("audio[aria-label='Recorded audio playback']").waitFor();
  await page.getByRole("button", { name: "Retake" }).click();
  await expect(page.getByRole("button", { name: "Start Recording" })).toBeVisible();

  await page.getByRole("button", { name: "Start Recording" }).click();
  await waitForRecording(page);
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await page.getByRole("button", { name: "Use recording" }).click();
  await expect(page.getByText(/aura-audio-.*\.webm/)).toBeVisible();
  await page.getByRole("button", { name: "Reflect with AURA" }).click();
  await expect(page.getByText("Audio", { exact: true })).toBeVisible();
  await expect(page.locator(".modality-row").filter({ hasText: "Audio" })).toContainText("Not processed");
});

test("video previews, records, plays, retakes, and submits a confirmed clip", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Record video" }).click();
  await page.getByRole("button", { name: "Enable camera preview" }).click();
  await expect(page.locator("video[aria-label='Live camera preview']")).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Camera ready" })).toBeVisible();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await waitForRecording(page);
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await page.getByRole("button", { name: "Play Preview" }).waitFor();
  await page.locator("video[aria-label='Recorded video preview']").waitFor();
  await page.getByRole("button", { name: "Retake" }).click();
  await page.getByRole("button", { name: "Enable camera preview" }).click();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await waitForRecording(page);
  await page.getByRole("button", { name: "Stop Recording" }).click();
  await page.getByRole("button", { name: "Use recording" }).click();
  await expect(page.getByText(/aura-video-.*\.webm/)).toBeVisible();
  await page.getByRole("button", { name: "Reflect with AURA" }).click();
  await expect(page.locator(".modality-row").filter({ hasText: "Video" })).toContainText("Not processed");
});

test("permission denial gives a clear message without creating an attachment", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => { throw new DOMException("denied", "NotAllowedError"); } },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Record audio" }).click();
  await page.getByRole("button", { name: "Start Recording" }).click();
  await expect(page.getByRole("alert")).toContainText("Allow microphone access");
  await expect(page.locator(".attachment-item")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel audio recording" }).click();
  await page.getByRole("button", { name: "Record video" }).click();
  await page.getByRole("button", { name: "Enable camera preview" }).click();
  await expect(page.getByRole("alert")).toContainText("Allow camera and microphone access");
  await expect(page.locator(".attachment-item")).toHaveCount(0);
});