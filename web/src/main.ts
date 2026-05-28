import { createIcons, Download, FileArchive, FileImage, FolderOpen, RefreshCw, Trash2 } from "lucide";
import { PDFDocument } from "pdf-lib";
import "./styles.css";

type PaperName = "letter" | "legal" | "a4";
type Orientation = "auto" | "portrait" | "landscape";
type SortMode = "name" | "oldest" | "newest";

type Asset = {
  file: File;
  bitmap: ImageBitmap;
  source: CanvasImageSource;
  width: number;
  height: number;
  index: number;
};

type PlacedAsset = {
  asset: Asset;
  baseHeight: number;
};

type Column = {
  page: number;
  index: number;
  items: PlacedAsset[];
  baseImageHeight: number;
};

type Layout = {
  columns: number;
  orientation: Exclude<Orientation, "auto">;
  pageWidth: number;
  pageHeight: number;
  marginPx: number;
  gapPx: number;
  numberLabels: boolean;
  baseColWidth: number;
  scale: number;
  bins: Column[];
  score: number;
};

type Settings = {
  pages: number;
  paper: PaperName;
  dpi: number;
  orientation: Orientation;
  maxColumns: number;
  margin: number;
  gap: number;
  sort: SortMode;
  trim: boolean;
  numbers: boolean;
};

const PAPER_SIZES_IN: Record<PaperName, [number, number]> = {
  letter: [8.5, 11],
  legal: [8.5, 14],
  a4: [8.27, 11.69]
};

const IMAGE_TYPES = new Set(["image/bmp", "image/gif", "image/jpeg", "image/png", "image/tiff", "image/webp"]);

const state: {
  settings: Settings;
  assets: Asset[];
  layout: Layout | null;
  renderedPages: HTMLCanvasElement[];
} = {
  settings: {
    pages: 2,
    paper: "letter",
    dpi: 300,
    orientation: "auto",
    maxColumns: 6,
    margin: 0.22,
    gap: 0.05,
    sort: "name",
    trim: true,
    numbers: true
  },
  assets: [],
  layout: null,
  renderedPages: []
};

const app = document.querySelector<HTMLDivElement>("#app");
const repoUrl = String(import.meta.env.VITE_REPO_URL ?? "https://github.com/");

if (!app) {
  throw new Error("App root not found.");
}

app.innerHTML = `
  <main class="app-shell">
    <aside class="sidebar" aria-label="Controls">
      <div class="brand-block">
        <h1>Cheat Sheet Stitcher</h1>
        <a class="repo-link" href="${repoUrl}" target="_blank" rel="noreferrer">Want the CLI version?</a>
        <a class="creator-link" href="https://github.com/kemsig" target="_blank" rel="noreferrer">Created by kemsig</a>
      </div>

      <section class="control-group upload-group">
        <label class="file-drop" for="image-input">
          <i data-lucide="folder-open"></i>
          <span>Choose images</span>
          <input id="image-input" type="file" accept="image/*" multiple />
        </label>
        <div class="file-meta" id="file-meta">No images selected</div>
      </section>

      <section class="control-group">
        <div class="field">
          <label for="pages">Pages</label>
          <input id="pages" type="number" min="1" max="12" step="1" value="2" />
        </div>
        <div class="field">
          <label for="paper">Paper</label>
          <select id="paper">
            <option value="letter">US Letter</option>
            <option value="legal">US Legal</option>
            <option value="a4">A4</option>
          </select>
        </div>
        <div class="field">
          <label for="orientation">Orientation</label>
          <select id="orientation">
            <option value="auto">Auto</option>
            <option value="portrait">Portrait</option>
            <option value="landscape">Landscape</option>
          </select>
        </div>
        <div class="field">
          <label for="sort">Sort</label>
          <select id="sort">
            <option value="name">Name</option>
            <option value="oldest">Oldest</option>
            <option value="newest">Newest</option>
          </select>
        </div>
      </section>

      <section class="control-group">
        <div class="field">
          <label for="dpi">DPI</label>
          <input id="dpi" type="number" min="72" max="450" step="1" value="300" />
        </div>
        <div class="field">
          <label for="max-columns">Max columns</label>
          <input id="max-columns" type="number" min="1" max="12" step="1" value="6" />
        </div>
        <div class="field">
          <label for="margin">Margin, in</label>
          <input id="margin" type="number" min="0" max="2" step="0.01" value="0.22" />
        </div>
        <div class="field">
          <label for="gap">Gap, in</label>
          <input id="gap" type="number" min="0" max="1" step="0.01" value="0.05" />
        </div>
      </section>

      <section class="control-group toggles">
        <label><input id="trim" type="checkbox" checked /> Trim transparent edges</label>
        <label><input id="numbers" type="checkbox" checked /> Reading-order numbers</label>
      </section>

      <section class="control-group actions">
        <button id="render" type="button"><i data-lucide="refresh-cw"></i><span>Render</span></button>
        <button id="download-pdf" type="button" disabled><i data-lucide="download"></i><span>PDF</span></button>
        <button id="download-pngs" type="button" disabled><i data-lucide="file-image"></i><span>PNGs</span></button>
        <button id="clear" type="button"><i data-lucide="trash-2"></i><span>Clear</span></button>
      </section>

      <div class="status" id="status">Select images to start.</div>
    </aside>

    <section class="workspace" aria-label="Page previews">
      <div class="preview-toolbar">
        <div>
          <h2>Preview</h2>
          <p id="layout-summary">Waiting for images</p>
        </div>
        <div class="artifact-count" id="artifact-count">0 pages</div>
      </div>
      <div class="preview-grid" id="preview-grid">
        <div class="empty-state">
          <i data-lucide="file-archive"></i>
          <span>Your generated pages will appear here.</span>
        </div>
      </div>
    </section>
  </main>
`;

createIcons({ icons: { Download, FileArchive, FileImage, FolderOpen, RefreshCw, Trash2 } });

const controls = {
  input: mustGet<HTMLInputElement>("image-input"),
  fileMeta: mustGet<HTMLDivElement>("file-meta"),
  pages: mustGet<HTMLInputElement>("pages"),
  paper: mustGet<HTMLSelectElement>("paper"),
  orientation: mustGet<HTMLSelectElement>("orientation"),
  sort: mustGet<HTMLSelectElement>("sort"),
  dpi: mustGet<HTMLInputElement>("dpi"),
  maxColumns: mustGet<HTMLInputElement>("max-columns"),
  margin: mustGet<HTMLInputElement>("margin"),
  gap: mustGet<HTMLInputElement>("gap"),
  trim: mustGet<HTMLInputElement>("trim"),
  numbers: mustGet<HTMLInputElement>("numbers"),
  render: mustGet<HTMLButtonElement>("render"),
  downloadPdf: mustGet<HTMLButtonElement>("download-pdf"),
  downloadPngs: mustGet<HTMLButtonElement>("download-pngs"),
  clear: mustGet<HTMLButtonElement>("clear"),
  status: mustGet<HTMLDivElement>("status"),
  summary: mustGet<HTMLParagraphElement>("layout-summary"),
  artifactCount: mustGet<HTMLDivElement>("artifact-count"),
  previewGrid: mustGet<HTMLDivElement>("preview-grid")
};

controls.input.addEventListener("change", async () => {
  const files = Array.from(controls.input.files ?? []).filter(isSupportedImage);
  await loadFiles(files);
});

for (const element of [
  controls.pages,
  controls.paper,
  controls.orientation,
  controls.sort,
  controls.dpi,
  controls.maxColumns,
  controls.margin,
  controls.gap,
  controls.trim,
  controls.numbers
]) {
  element.addEventListener("input", () => {
    readSettings();
    void render();
  });
}

controls.render.addEventListener("click", () => {
  readSettings();
  void render();
});

controls.downloadPdf.addEventListener("click", () => {
  void downloadPdf();
});

controls.downloadPngs.addEventListener("click", () => {
  void downloadPngs();
});

controls.clear.addEventListener("click", () => {
  state.assets = [];
  state.layout = null;
  state.renderedPages = [];
  controls.input.value = "";
  updateStatus("Cleared images.");
  updatePreview();
});

function mustGet<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing element: ${id}`);
  }
  return element as T;
}

function isSupportedImage(file: File): boolean {
  return IMAGE_TYPES.has(file.type) || /\.(bmp|gif|jpe?g|png|tiff?|webp)$/i.test(file.name);
}

async function loadFiles(files: File[]): Promise<void> {
  if (!files.length) {
    updateStatus("No supported images selected.");
    return;
  }

  updateStatus(`Loading ${files.length} image${files.length === 1 ? "" : "s"}...`);
  state.assets.forEach((asset) => asset.bitmap.close());
  state.assets = [];

  const loaded: Asset[] = [];
  for (const file of sortFiles(files, state.settings.sort)) {
    const bitmap = await createImageBitmap(file);
    const canvas = state.settings.trim ? trimTransparentEdges(bitmap) : imageBitmapToCanvas(bitmap);
    bitmap.close();
    const normalized = await createImageBitmap(canvas);
    loaded.push({
      file,
      bitmap: normalized,
      source: normalized,
      width: normalized.width,
      height: normalized.height,
      index: loaded.length
    });
  }

  state.assets = loaded;
  updateStatus(`Loaded ${loaded.length} image${loaded.length === 1 ? "" : "s"}.`);
  await render();
}

function readSettings(): void {
  state.settings = {
    pages: clamp(parseInt(controls.pages.value, 10), 1, 12),
    paper: controls.paper.value as PaperName,
    dpi: clamp(parseInt(controls.dpi.value, 10), 72, 450),
    orientation: controls.orientation.value as Orientation,
    maxColumns: clamp(parseInt(controls.maxColumns.value, 10), 1, 12),
    margin: clamp(parseFloat(controls.margin.value), 0, 2),
    gap: clamp(parseFloat(controls.gap.value), 0, 1),
    sort: controls.sort.value as SortMode,
    trim: controls.trim.checked,
    numbers: controls.numbers.checked
  };
}

async function render(): Promise<void> {
  readSettings();
  if (!state.assets.length) {
    updatePreview();
    return;
  }

  state.assets = sortAssets(state.assets, state.settings.sort).map((asset, index) => ({ ...asset, index }));
  const marginPx = Math.ceil(state.settings.margin * state.settings.dpi);
  const gapPx = Math.ceil(state.settings.gap * state.settings.dpi);
  const layout = chooseLayout(
    state.assets,
    state.settings.pages,
    state.settings.paper,
    state.settings.dpi,
    state.settings.orientation,
    state.settings.maxColumns,
    marginPx,
    gapPx
  );
  layout.numberLabels = state.settings.numbers;
  state.layout = layout;
  state.renderedPages = Array.from({ length: state.settings.pages }, (_, page) => renderPage(layout, page));
  updatePreview();
}

function sortFiles(files: File[], sort: SortMode): File[] {
  return [...files].sort((a, b) => compareFileLike(a.name, a.lastModified, b.name, b.lastModified, sort));
}

function sortAssets(assets: Asset[], sort: SortMode): Asset[] {
  return [...assets].sort((a, b) =>
    compareFileLike(a.file.name, a.file.lastModified, b.file.name, b.file.lastModified, sort)
  );
}

function compareFileLike(aName: string, aModified: number, bName: string, bModified: number, sort: SortMode): number {
  if (sort === "oldest" && aModified !== bModified) {
    return aModified - bModified;
  }
  if (sort === "newest" && aModified !== bModified) {
    return bModified - aModified;
  }
  return naturalCompare(aName, bName);
}

function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

function trimTransparentEdges(image: ImageBitmap): HTMLCanvasElement {
  const canvas = imageBitmapToCanvas(image);
  const ctx = mustContext(canvas);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  let minX = canvas.width;
  let minY = canvas.height;
  let maxX = -1;
  let maxY = -1;

  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const alpha = data.data[(y * canvas.width + x) * 4 + 3];
      if (alpha > 0) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  if (maxX < minX || maxY < minY) {
    return canvas;
  }

  const cropped = document.createElement("canvas");
  cropped.width = maxX - minX + 1;
  cropped.height = maxY - minY + 1;
  const croppedCtx = mustContext(cropped);
  croppedCtx.fillStyle = "#ffffff";
  croppedCtx.fillRect(0, 0, cropped.width, cropped.height);
  croppedCtx.drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
  return cropped;
}

function imageBitmapToCanvas(image: ImageBitmap): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = mustContext(canvas);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  return canvas;
}

function pageDimensions(paper: PaperName, dpi: number, orientation: Exclude<Orientation, "auto">): [number, number] {
  let [widthIn, heightIn] = PAPER_SIZES_IN[paper];
  if (orientation === "landscape") {
    [widthIn, heightIn] = [heightIn, widthIn];
  }
  return [Math.round(widthIn * dpi), Math.round(heightIn * dpi)];
}

function chooseLayout(
  assets: Asset[],
  pages: number,
  paper: PaperName,
  dpi: number,
  orientation: Orientation,
  maxColumns: number,
  marginPx: number,
  gapPx: number
): Layout {
  const orientations: Array<Exclude<Orientation, "auto">> = orientation === "auto" ? ["portrait", "landscape"] : [orientation];
  const candidates: Layout[] = [];

  for (const candidateOrientation of orientations) {
    for (let columns = 1; columns <= maxColumns; columns += 1) {
      const layout = packLayout(assets, pages, columns, candidateOrientation, paper, dpi, marginPx, gapPx);
      if (layout) {
        candidates.push(layout);
      }
    }
  }

  if (!candidates.length) {
    throw new Error("No valid layout could be created. Try smaller margins, smaller gaps, or more pages.");
  }

  return candidates.reduce((best, current) => (current.score > best.score ? current : best), candidates[0]);
}

function packLayout(
  assets: Asset[],
  pages: number,
  columns: number,
  orientation: Exclude<Orientation, "auto">,
  paper: PaperName,
  dpi: number,
  marginPx: number,
  gapPx: number
): Layout | null {
  const [pageWidth, pageHeight] = pageDimensions(paper, dpi, orientation);
  const availableWidth = pageWidth - marginPx * 2;
  const availableHeight = pageHeight - marginPx * 2;
  if (availableWidth <= 0 || availableHeight <= 0) {
    return null;
  }

  const baseColWidth = (availableWidth - gapPx * (columns - 1)) / columns;
  if (baseColWidth <= 0) {
    return null;
  }

  const bins: Column[] = [];
  for (let page = 0; page < pages; page += 1) {
    for (let index = 0; index < columns; index += 1) {
      bins.push({ page, index, items: [], baseImageHeight: 0 });
    }
  }

  const placeables = assets.map((asset) => ({
    asset,
    baseHeight: asset.height * (baseColWidth / asset.width)
  }));

  for (const item of [...placeables].sort((a, b) => b.baseHeight - a.baseHeight)) {
    const target = bins.reduce((best, column) =>
      columnHeightAt(column, 1, gapPx) < columnHeightAt(best, 1, gapPx) ? column : best
    );
    target.items.push(item);
    target.baseImageHeight += item.baseHeight;
  }

  let scale = 1;
  for (const column of bins) {
    if (!column.items.length) {
      continue;
    }
    const gapHeight = gapPx * (column.items.length - 1);
    const allowedImageHeight = availableHeight - gapHeight;
    if (allowedImageHeight <= 0) {
      return null;
    }
    scale = Math.min(scale, allowedImageHeight / column.baseImageHeight);
  }

  if (scale <= 0) {
    return null;
  }

  const renderedColWidth = baseColWidth * scale;
  const usedArea = bins.reduce(
    (total, column) =>
      total + column.items.reduce((inner, item) => inner + item.baseHeight * baseColWidth * scale * scale, 0),
    0
  );
  const pageArea = pageWidth * pageHeight * pages;
  const fillRatio = pageArea ? usedArea / pageArea : 0;
  const tallestRatio = Math.max(...bins.map((column) => columnHeightAt(column, scale, gapPx) / availableHeight), 0);
  const balancePenalty = Math.abs(0.82 - Math.min(tallestRatio, 0.82)) * 50;
  const score = renderedColWidth + fillRatio * 20 - balancePenalty;

  return {
    columns,
    orientation,
    pageWidth,
    pageHeight,
    marginPx,
    gapPx,
    numberLabels: false,
    baseColWidth,
    scale,
    bins,
    score
  };
}

function columnHeightAt(column: Column, scale: number, gapPx: number): number {
  if (!column.items.length) {
    return 0;
  }
  return column.baseImageHeight * scale + gapPx * (column.items.length - 1);
}

function renderPage(layout: Layout, pageNumber: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = layout.pageWidth;
  canvas.height = layout.pageHeight;
  const ctx = mustContext(canvas);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const pageColumns = layout.bins.filter((column) => column.page === pageNumber);
  const renderedColWidth = layout.baseColWidth * layout.scale;
  const gridWidth = renderedColWidth * layout.columns + layout.gapPx * (layout.columns - 1);
  const availableWidth = layout.pageWidth - layout.marginPx * 2;
  const availableHeight = layout.pageHeight - layout.marginPx * 2;
  const startX = layout.marginPx + (availableWidth - gridWidth) / 2;

  for (const column of pageColumns) {
    const columnHeight = columnHeightAt(column, layout.scale, layout.gapPx);
    let y = layout.marginPx + Math.max(0, (availableHeight - columnHeight) / 2);
    const x = startX + column.index * (renderedColWidth + layout.gapPx);

    for (const placed of [...column.items].sort((a, b) => a.asset.index - b.asset.index)) {
      const targetWidth = Math.max(1, Math.round(renderedColWidth));
      const targetHeight = Math.max(1, Math.round(placed.asset.height * (targetWidth / placed.asset.width)));
      const pasteX = Math.round(x);
      const pasteY = Math.round(y);
      ctx.drawImage(placed.asset.source, pasteX, pasteY, targetWidth, targetHeight);

      const border = Math.max(1, Math.round(layout.pageWidth / 1600));
      ctx.strokeStyle = "rgb(210, 210, 210)";
      ctx.lineWidth = border;
      ctx.strokeRect(pasteX + border / 2, pasteY + border / 2, targetWidth - border, targetHeight - border);

      if (layout.numberLabels) {
        const labelOffset = Math.max(4, border + 3);
        const [labelX, labelY] = chooseNumberLabelPosition(placed.asset.source, targetWidth, targetHeight, placed.asset.index + 1, labelOffset);
        drawNumberLabel(ctx, pasteX + labelX, pasteY + labelY, placed.asset.index + 1);
      }

      y += targetHeight + layout.gapPx;
    }
  }

  return canvas;
}

function numberLabelMetrics(number: number): { textWidth: number; textHeight: number; padX: number; padY: number; boxWidth: number; boxHeight: number } {
  const measure = document.createElement("canvas");
  const ctx = mustContext(measure);
  ctx.font = "18px system-ui, sans-serif";
  const text = String(number);
  const metrics = ctx.measureText(text);
  const textWidth = Math.ceil(metrics.width);
  const textHeight = 18;
  const padX = 8;
  const padY = 5;
  return {
    textWidth,
    textHeight,
    padX,
    padY,
    boxWidth: textWidth + padX * 2,
    boxHeight: textHeight + padY * 2
  };
}

function chooseNumberLabelPosition(
  source: CanvasImageSource,
  width: number,
  height: number,
  number: number,
  offset: number
): [number, number] {
  const metrics = numberLabelMetrics(number);
  const maxX = Math.max(0, width - metrics.boxWidth - offset);
  const maxY = Math.max(0, height - metrics.boxHeight - offset);
  const xCandidates = [
    offset,
    Math.round(width * 0.25 - metrics.boxWidth / 2),
    Math.round(width * 0.5 - metrics.boxWidth / 2),
    Math.round(width * 0.75 - metrics.boxWidth / 2),
    maxX
  ];
  const yCandidates = [offset, Math.round(height * 0.04), Math.round(height * 0.08), Math.round(height * 0.16), Math.round(height * 0.28)];
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = height;
  const scratchCtx = mustContext(scratch);
  scratchCtx.drawImage(source, 0, 0, width, height);

  let best: [number, number] = [offset, offset];
  let bestScore = Number.POSITIVE_INFINITY;
  const seen = new Set<string>();
  for (const candidateY of yCandidates) {
    const y = Math.min(Math.max(offset, candidateY), maxY);
    for (const candidateX of xCandidates) {
      const x = Math.min(Math.max(offset, candidateX), maxX);
      const key = `${x}:${y}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      const contentScore = labelContentScore(scratchCtx, x, y, metrics.boxWidth, metrics.boxHeight);
      const topPenalty = (y / Math.max(1, height)) * 80;
      const leftPenalty = (x / Math.max(1, width)) * 2;
      const score = contentScore + topPenalty + leftPenalty;
      if (score < bestScore) {
        bestScore = score;
        best = [x, y];
      }
    }
  }
  return best;
}

function labelContentScore(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number): number {
  const imageData = ctx.getImageData(x, y, Math.max(1, Math.min(width, ctx.canvas.width - x)), Math.max(1, Math.min(height, ctx.canvas.height - y)));
  const pixels = imageData.width * imageData.height;
  if (!pixels) {
    return Number.POSITIVE_INFINITY;
  }
  let darkPixels = 0;
  let inkPixels = 0;
  for (let index = 0; index < imageData.data.length; index += 4) {
    const gray = imageData.data[index] * 0.299 + imageData.data[index + 1] * 0.587 + imageData.data[index + 2] * 0.114;
    if (gray < 180) {
      darkPixels += 1;
    }
    if (gray < 245) {
      inkPixels += 1;
    }
  }
  return (darkPixels / pixels) * 1200 + (inkPixels / pixels) * 400;
}

function drawNumberLabel(ctx: CanvasRenderingContext2D, x: number, y: number, number: number): void {
  const metrics = numberLabelMetrics(number);
  ctx.save();
  roundRect(ctx, x, y, metrics.boxWidth, metrics.boxHeight, 5);
  ctx.fillStyle = "#ffffff";
  ctx.fill();
  ctx.strokeStyle = "rgb(40, 40, 40)";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#000000";
  ctx.font = "18px system-ui, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(String(number), x + metrics.padX, y + metrics.padY - 1);
  ctx.restore();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

async function downloadPdf(): Promise<void> {
  if (!state.layout || !state.renderedPages.length) {
    return;
  }

  updateStatus("Building PDF...");
  const pdf = await PDFDocument.create();
  const widthPt = state.layout.pageWidth / state.settings.dpi * 72;
  const heightPt = state.layout.pageHeight / state.settings.dpi * 72;

  for (const canvas of state.renderedPages) {
    const page = pdf.addPage([widthPt, heightPt]);
    const blob = await canvasToBlob(canvas, "image/jpeg", 0.96);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const image = await pdf.embedJpg(bytes);
    page.drawImage(image, { x: 0, y: 0, width: widthPt, height: heightPt });
  }

  const bytes = await pdf.save();
  const pdfBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(pdfBuffer).set(bytes);
  downloadBlob(new Blob([pdfBuffer], { type: "application/pdf" }), "cheatsheet.pdf");
  updateStatus("Downloaded cheatsheet.pdf.");
}

async function downloadPngs(): Promise<void> {
  if (!state.renderedPages.length) {
    return;
  }

  for (const [index, canvas] of state.renderedPages.entries()) {
    const blob = await canvasToBlob(canvas, "image/png");
    downloadBlob(blob, `cheatsheet-page-${index + 1}.png`);
    await wait(140);
  }
  updateStatus(`Downloaded ${state.renderedPages.length} PNG page${state.renderedPages.length === 1 ? "" : "s"}.`);
}

function updatePreview(): void {
  controls.fileMeta.textContent = state.assets.length
    ? `${state.assets.length} image${state.assets.length === 1 ? "" : "s"} selected`
    : "No images selected";
  controls.downloadPdf.disabled = !state.renderedPages.length;
  controls.downloadPngs.disabled = !state.renderedPages.length;
  controls.artifactCount.textContent = `${state.renderedPages.length} page${state.renderedPages.length === 1 ? "" : "s"}`;

  if (!state.layout || !state.renderedPages.length) {
    controls.summary.textContent = state.assets.length ? "Ready to render" : "Waiting for images";
    controls.previewGrid.innerHTML = `
      <div class="empty-state">
        <i data-lucide="file-archive"></i>
        <span>Your generated pages will appear here.</span>
      </div>
    `;
    createIcons({ icons: { FileArchive } });
    return;
  }

  controls.summary.textContent = `${state.layout.orientation}, ${state.layout.columns} column${state.layout.columns === 1 ? "" : "s"}, ${state.layout.pageWidth}x${state.layout.pageHeight}px @ ${state.settings.dpi} DPI`;
  controls.previewGrid.innerHTML = "";
  for (const [index, canvas] of state.renderedPages.entries()) {
    const wrapper = document.createElement("article");
    wrapper.className = "page-preview";
    const title = document.createElement("div");
    title.className = "page-title";
    title.textContent = `Page ${index + 1}`;
    const preview = document.createElement("canvas");
    preview.width = canvas.width;
    preview.height = canvas.height;
    mustContext(preview).drawImage(canvas, 0, 0);
    wrapper.append(title, preview);
    controls.previewGrid.append(wrapper);
  }
}

function updateStatus(message: string): void {
  controls.status.textContent = message;
}

function mustContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Canvas 2D context is unavailable.");
  }
  return ctx;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("Could not create image blob."));
        return;
      }
      resolve(blob);
    }, type, quality);
  });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

updatePreview();
