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

test("camera photo capture supports preview, retake, confirmation, and the existing image upload field", async ({ page }) => {
  let submittedBody = "";
  page.on("request", (request) => {
    if (request.url().endsWith("/api/analyze")) submittedBody = request.postData() || "";
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Take a Photo" }).click();
  await page.getByRole("button", { name: "Open Camera" }).click();
  await expect(page.locator("video[aria-label='Live camera preview']")).toBeVisible();
  await page.getByRole("button", { name: "Capture Photo" }).click();
  await expect(page.locator("img[alt='Captured photo preview']")).toBeVisible();
  await page.getByRole("button", { name: "Retake" }).click();
  await expect(page.locator("video[aria-label='Live camera preview']")).toBeVisible();
  await page.getByRole("button", { name: "Capture Photo" }).click();
  await page.getByRole("button", { name: "Use Photo" }).click();
  await expect(page.getByText(/aura-photo-.*\.jpg/)).toBeVisible();
  await page.getByLabel("YOUR NOTES").fill("A walk after work.");
  await page.getByRole("button", { name: "Reflect with AURA" }).click();
  await expect(page.locator(".modality-row").filter({ hasText: "Image" })).toContainText("Not processed");
  expect(submittedBody).toContain('name="image"');
  expect(submittedBody).toContain('filename="aura-photo-');
  expect(submittedBody).toContain("image/jpeg");
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
  await page.getByRole("button", { name: "Cancel video recording" }).click();
  await page.getByRole("button", { name: "Take a Photo" }).click();
  await page.getByRole("button", { name: "Open Camera" }).click();
  await expect(page.getByRole("alert")).toContainText("Allow camera access");
  await expect(page.locator(".attachment-item")).toHaveCount(0);
});

test("Islamic support is hidden by default and follows the user's saved preference", async ({ page }) => {
  await page.goto("/");
  await page.locator("#journal-entry").fill("I feel overwhelmed by my responsibilities.");
  await page.getByRole("button", { name: "Reflect with AURA" }).click();
  await expect(page.locator(".result-panel")).toBeVisible();
  await expect(page.locator(".duaa-card")).toHaveCount(0);

  await page.getByRole("button", { name: "Privacy & settings" }).click();
  const supportToggle = page.getByRole("checkbox", { name: "Show Islamic spiritual support" });
  await supportToggle.check();
  await page.getByRole("button", { name: "Today" }).click();
  await page.getByRole("button", { name: "Reflect with AURA" }).click();
  await expect(page.locator(".duaa-card")).toBeVisible();
  await expect(page.locator(".duaa-card [lang='ar'][dir='rtl']")).toBeVisible();

  await page.getByRole("button", { name: "Privacy & settings" }).click();
  await supportToggle.uncheck();
  await page.getByRole("button", { name: "Today" }).click();
  await expect(page.locator(".duaa-card")).toHaveCount(0);
});