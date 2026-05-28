import { expect, test } from "@playwright/test";
import JSZip from "jszip";

function bmpFixture(width: number, height: number, red: number, green: number, blue: number): Buffer {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const pixelSize = rowSize * height;
  const fileSize = 54 + pixelSize;
  const buffer = Buffer.alloc(fileSize);
  buffer.write("BM", 0);
  buffer.writeUInt32LE(fileSize, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);
  buffer.writeUInt32LE(pixelSize, 34);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = 54 + y * rowSize + x * 3;
      buffer[offset] = blue;
      buffer[offset + 1] = green;
      buffer[offset + 2] = red;
    }
  }
  return buffer;
}

test("renders uploaded images and exports PDF/PNG", async ({ page }) => {
  await page.goto("/");
  await page.setInputFiles("#image-input", [
    { name: "1.bmp", mimeType: "image/bmp", buffer: bmpFixture(24, 18, 220, 70, 70) },
    { name: "2.bmp", mimeType: "image/bmp", buffer: bmpFixture(20, 26, 55, 140, 90) },
    { name: "10.bmp", mimeType: "image/bmp", buffer: bmpFixture(28, 20, 60, 110, 210) }
  ]);

  await expect(page.locator(".page-preview canvas")).toHaveCount(2);
  await expect(page.locator("#download-pdf")).toBeEnabled();
  await expect(page.locator("#download-pngs")).toBeEnabled();
  await expect(page.locator("#layout-summary")).toContainText("@ 300 DPI");

  const [pdfDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-pdf").click()
  ]);
  expect(pdfDownload.suggestedFilename()).toBe("cheatsheet.pdf");
  const pdfStream = await pdfDownload.createReadStream();
  expect(pdfStream).not.toBeNull();

  const [pngDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.locator("#download-pngs").click()
  ]);
  expect(pngDownload.suggestedFilename()).toBe("cheatsheet-page-1.png");
});

test("extracts images from ZIP uploads", async ({ page }) => {
  const zip = new JSZip();
  zip.file("week-1/1.bmp", bmpFixture(24, 18, 220, 70, 70), { date: new Date("2026-01-01T00:00:00Z") });
  zip.file("week-1/2.bmp", bmpFixture(20, 26, 55, 140, 90), { date: new Date("2026-01-02T00:00:00Z") });
  zip.file("readme.txt", "not an image");
  const zipBuffer = await zip.generateAsync({ type: "nodebuffer" });

  await page.goto("/");
  await page.setInputFiles("#image-input", {
    name: "notes.zip",
    mimeType: "application/zip",
    buffer: zipBuffer
  });

  await expect(page.locator(".page-preview canvas")).toHaveCount(2);
  await expect(page.locator("#file-meta")).toHaveText("2 images selected");
  await expect(page.locator("#download-pdf")).toBeEnabled();
});
