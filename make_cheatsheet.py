#!/usr/bin/env python3
"""Create a print-ready multi-page cheat sheet from a folder of images."""

from __future__ import annotations

import argparse
import math
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageDraw, ImageFont


IMAGE_EXTENSIONS = {".bmp", ".gif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
PAPER_SIZES_IN = {
    "letter": (8.5, 11.0),
    "legal": (8.5, 14.0),
    "a4": (8.27, 11.69),
}


@dataclass
class Asset:
    path: Path
    image: Image.Image
    index: int

    @property
    def width(self) -> int:
        return self.image.width

    @property
    def height(self) -> int:
        return self.image.height


@dataclass
class PlacedAsset:
    asset: Asset
    base_height: float


@dataclass
class Column:
    page: int
    index: int
    items: list[PlacedAsset] = field(default_factory=list)
    base_image_height: float = 0.0

    def add(self, item: PlacedAsset) -> None:
        self.items.append(item)
        self.base_image_height += item.base_height

    def height_at(self, scale: float, gap_px: int) -> float:
        if not self.items:
            return 0.0
        return self.base_image_height * scale + gap_px * (len(self.items) - 1)


@dataclass
class Layout:
    columns: int
    orientation: str
    page_width: int
    page_height: int
    margin_px: int
    gap_px: int
    number_labels: bool
    base_col_width: float
    scale: float
    bins: list[Column]
    score: float


def natural_key(path: Path) -> list[object]:
    parts = re.split(r"(\d+)", path.name.lower())
    return [int(part) if part.isdigit() else part for part in parts]


def sort_key(path: Path, sort: str) -> object:
    if sort == "name":
        return natural_key(path)
    if sort == "oldest":
        return (path.stat().st_mtime, natural_key(path))
    if sort == "newest":
        return (-path.stat().st_mtime, natural_key(path))
    raise ValueError(f"Unsupported sort mode: {sort}")


def iter_image_paths(input_dir: Path, sort: str) -> Iterable[Path]:
    for path in sorted(input_dir.iterdir(), key=lambda candidate: sort_key(candidate, sort)):
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS:
            yield path


def trim_transparent_edges(image: Image.Image) -> Image.Image:
    if image.mode != "RGBA":
        image = image.convert("RGBA")

    bbox = image.getchannel("A").getbbox()
    if not bbox:
        return image
    return image.crop(bbox)


def flatten_to_white(image: Image.Image) -> Image.Image:
    if image.mode == "RGBA" or "transparency" in image.info:
        rgba = image.convert("RGBA")
        background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
        background.alpha_composite(rgba)
        return background.convert("RGB")
    return image.convert("RGB")


def load_assets(input_dir: Path, trim: bool, sort: str) -> list[Asset]:
    assets: list[Asset] = []
    for index, path in enumerate(iter_image_paths(input_dir, sort)):
        with Image.open(path) as image:
            working = image.copy()
        if trim:
            working = trim_transparent_edges(working)
        assets.append(Asset(path=path, image=flatten_to_white(working), index=index))
    return assets


def page_dimensions(paper: str, dpi: int, orientation: str) -> tuple[int, int]:
    width_in, height_in = PAPER_SIZES_IN[paper]
    if orientation == "landscape":
        width_in, height_in = height_in, width_in
    return round(width_in * dpi), round(height_in * dpi)


def pack_layout(
    assets: list[Asset],
    pages: int,
    columns: int,
    orientation: str,
    paper: str,
    dpi: int,
    margin_px: int,
    gap_px: int,
) -> Layout | None:
    page_width, page_height = page_dimensions(paper, dpi, orientation)
    available_width = page_width - margin_px * 2
    available_height = page_height - margin_px * 2
    if available_width <= 0 or available_height <= 0:
        return None

    base_col_width = (available_width - gap_px * (columns - 1)) / columns
    if base_col_width <= 0:
        return None

    bins = [Column(page=page, index=col) for page in range(pages) for col in range(columns)]
    placeables = [
        PlacedAsset(asset=asset, base_height=asset.height * (base_col_width / asset.width))
        for asset in assets
    ]

    # Longest-first packing keeps the required final scale as large as possible.
    for item in sorted(placeables, key=lambda candidate: candidate.base_height, reverse=True):
        target = min(bins, key=lambda column: column.height_at(1.0, gap_px))
        target.add(item)

    scale = 1.0
    for column in bins:
        if not column.items:
            continue
        gap_height = gap_px * (len(column.items) - 1)
        allowed_image_height = available_height - gap_height
        if allowed_image_height <= 0:
            return None
        scale = min(scale, allowed_image_height / column.base_image_height)

    if scale <= 0:
        return None

    rendered_col_width = base_col_width * scale
    used_area = sum(item.base_height * base_col_width * scale * scale for column in bins for item in column.items)
    page_area = page_width * page_height * pages
    fill_ratio = used_area / page_area if page_area else 0
    tallest_ratio = max((column.height_at(scale, gap_px) / available_height for column in bins), default=0)
    balance_penalty = abs(0.82 - min(tallest_ratio, 0.82)) * 50
    score = rendered_col_width + fill_ratio * 20 - balance_penalty

    return Layout(
        columns=columns,
        orientation=orientation,
        page_width=page_width,
        page_height=page_height,
        margin_px=margin_px,
        gap_px=gap_px,
        number_labels=False,
        base_col_width=base_col_width,
        scale=scale,
        bins=bins,
        score=score,
    )


def choose_layout(
    assets: list[Asset],
    pages: int,
    paper: str,
    dpi: int,
    orientation: str,
    max_columns: int,
    margin_px: int,
    gap_px: int,
) -> Layout:
    orientations = ["portrait", "landscape"] if orientation == "auto" else [orientation]
    candidates: list[Layout] = []
    for candidate_orientation in orientations:
        for columns in range(1, max_columns + 1):
            layout = pack_layout(
                assets=assets,
                pages=pages,
                columns=columns,
                orientation=candidate_orientation,
                paper=paper,
                dpi=dpi,
                margin_px=margin_px,
                gap_px=gap_px,
            )
            if layout:
                candidates.append(layout)

    if not candidates:
        raise ValueError("No valid layout could be created. Try smaller margins/gaps or more pages.")

    return max(candidates, key=lambda layout: layout.score)


def number_label_metrics(number: int) -> tuple[ImageFont.ImageFont, int, int, int, int]:
    label = str(number)
    font = ImageFont.load_default()
    measure = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    bbox = measure.textbbox((0, 0), label, font=font)
    text_width = bbox[2] - bbox[0]
    text_height = bbox[3] - bbox[1]
    pad_x = 7
    pad_y = 5
    return font, pad_x, pad_y, text_width + pad_x * 2, text_height + pad_y * 2


def label_content_score(image: Image.Image, x: int, y: int, width: int, height: int) -> float:
    crop = image.crop((x, y, min(image.width, x + width), min(image.height, y + height))).convert("L")
    if not crop.width or not crop.height:
        return float("inf")

    histogram = crop.histogram()
    pixels = crop.width * crop.height
    dark_pixels = sum(histogram[:180])
    ink_pixels = sum(histogram[:245])
    dark_ratio = dark_pixels / pixels
    ink_ratio = ink_pixels / pixels
    return dark_ratio * 1200 + ink_ratio * 400


def choose_number_label_position(image: Image.Image, number: int, offset: int) -> tuple[int, int]:
    _, _, _, box_width, box_height = number_label_metrics(number)
    max_x = max(0, image.width - box_width - offset)
    max_y = max(0, image.height - box_height - offset)

    x_candidates = [
        offset,
        round(image.width * 0.25 - box_width / 2),
        round(image.width * 0.5 - box_width / 2),
        round(image.width * 0.75 - box_width / 2),
        max_x,
    ]
    y_candidates = [
        offset,
        round(image.height * 0.04),
        round(image.height * 0.08),
        round(image.height * 0.16),
        round(image.height * 0.28),
    ]

    best_position = (offset, offset)
    best_score = float("inf")
    seen: set[tuple[int, int]] = set()
    for candidate_y in y_candidates:
        y = min(max(offset, candidate_y), max_y)
        for candidate_x in x_candidates:
            x = min(max(offset, candidate_x), max_x)
            if (x, y) in seen:
                continue
            seen.add((x, y))

            content_score = label_content_score(image, x, y, box_width, box_height)
            top_penalty = (y / max(1, image.height)) * 80
            left_penalty = (x / max(1, image.width)) * 2
            score = content_score + top_penalty + left_penalty
            if score < best_score:
                best_score = score
                best_position = (x, y)

    return best_position


def draw_number_label(page: Image.Image, x: int, y: int, number: int) -> None:
    draw = ImageDraw.Draw(page)
    label = str(number)
    font, pad_x, pad_y, box_width, box_height = number_label_metrics(number)
    draw.rounded_rectangle(
        (x, y, x + box_width, y + box_height),
        radius=5,
        fill=(255, 255, 255),
        outline=(40, 40, 40),
        width=2,
    )
    draw.text((x + pad_x, y + pad_y - 1), label, fill=(0, 0, 0), font=font)


def render_page(layout: Layout, page_number: int) -> Image.Image:
    page = Image.new("RGB", (layout.page_width, layout.page_height), "white")
    draw = ImageDraw.Draw(page)
    page_columns = [column for column in layout.bins if column.page == page_number]

    rendered_col_width = layout.base_col_width * layout.scale
    grid_width = rendered_col_width * layout.columns + layout.gap_px * (layout.columns - 1)
    available_width = layout.page_width - layout.margin_px * 2
    available_height = layout.page_height - layout.margin_px * 2
    start_x = layout.margin_px + (available_width - grid_width) / 2

    for column in page_columns:
        column_height = column.height_at(layout.scale, layout.gap_px)
        y = layout.margin_px + max(0, (available_height - column_height) / 2)
        x = start_x + column.index * (rendered_col_width + layout.gap_px)

        for placed in sorted(column.items, key=lambda item: item.asset.index):
            target_width = max(1, round(rendered_col_width))
            target_height = max(1, round(placed.asset.height * (target_width / placed.asset.width)))
            resized = placed.asset.image.resize((target_width, target_height), Image.Resampling.LANCZOS)
            paste_x = round(x)
            paste_y = round(y)
            page.paste(resized, (paste_x, paste_y))

            border = max(1, round(layout.page_width / 1600))
            draw.rectangle(
                (paste_x, paste_y, paste_x + target_width - 1, paste_y + target_height - 1),
                outline=(210, 210, 210),
                width=border,
            )
            if layout.number_labels:
                label_offset = max(4, border + 3)
                label_x, label_y = choose_number_label_position(
                    resized,
                    placed.asset.index + 1,
                    label_offset,
                )
                draw_number_label(page, paste_x + label_x, paste_y + label_y, placed.asset.index + 1)
            y += target_height + layout.gap_px

    return page


def save_outputs(pages: list[Image.Image], output: Path, dpi: int, write_pngs: bool) -> list[Path]:
    output.parent.mkdir(parents=True, exist_ok=True)
    pages[0].save(output, save_all=True, append_images=pages[1:], resolution=dpi)

    written = [output]
    if write_pngs:
        for index, page in enumerate(pages, start=1):
            png_path = output.with_name(f"{output.stem}-page-{index}.png")
            page.save(png_path, dpi=(dpi, dpi))
            written.append(png_path)
    return written


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stitch images into a readable print-ready cheat sheet PDF."
    )
    parser.add_argument("-i", "--input", type=Path, default=Path("images"), help="Folder of source images.")
    parser.add_argument("-o", "--output", type=Path, default=Path("cheatsheet.pdf"), help="Output PDF path.")
    parser.add_argument("--pages", type=int, default=2, help="Number of PDF pages to create. Default: 2.")
    parser.add_argument("--paper", choices=sorted(PAPER_SIZES_IN), default="letter", help="Paper size.")
    parser.add_argument("--dpi", type=int, default=300, help="Output DPI.")
    parser.add_argument(
        "--orientation",
        choices=["auto", "portrait", "landscape"],
        default="auto",
        help="Page orientation. Auto chooses the most readable fit.",
    )
    parser.add_argument("--max-columns", type=int, default=6, help="Highest column count to consider per page.")
    parser.add_argument("--margin", type=float, default=0.22, help="Page margin in inches.")
    parser.add_argument("--gap", type=float, default=0.05, help="Gap between images in inches.")
    parser.add_argument(
        "--sort",
        choices=["name", "oldest", "newest"],
        default="name",
        help="Image order: natural filename order, oldest modified first, or newest modified first.",
    )
    parser.add_argument(
        "--no-trim",
        action="store_true",
        help="Do not trim transparent edges before laying out images.",
    )
    parser.add_argument(
        "--no-numbers",
        action="store_true",
        help="Do not draw reading-order numbers on top of each image.",
    )
    parser.add_argument("--no-png", action="store_true", help="Only write the PDF, no page PNG previews.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.pages < 1:
        raise SystemExit("--pages must be at least 1")
    if args.dpi < 72:
        raise SystemExit("--dpi must be at least 72")
    if args.max_columns < 1:
        raise SystemExit("--max-columns must be at least 1")
    if not args.input.is_dir():
        raise SystemExit(f"Input folder not found: {args.input}")

    margin_px = math.ceil(args.margin * args.dpi)
    gap_px = math.ceil(args.gap * args.dpi)
    assets = load_assets(args.input, trim=not args.no_trim, sort=args.sort)
    if not assets:
        raise SystemExit(f"No supported images found in: {args.input}")

    layout = choose_layout(
        assets=assets,
        pages=args.pages,
        paper=args.paper,
        dpi=args.dpi,
        orientation=args.orientation,
        max_columns=args.max_columns,
        margin_px=margin_px,
        gap_px=gap_px,
    )
    layout.number_labels = not args.no_numbers

    rendered_pages = [render_page(layout, page_number) for page_number in range(args.pages)]
    written = save_outputs(rendered_pages, args.output, args.dpi, write_pngs=not args.no_png)

    print(f"Loaded {len(assets)} images from {args.input}")
    print(f"Sort: {args.sort}")
    print(f"Numbers: {'on' if layout.number_labels else 'off'}")
    print(
        "Layout: "
        f"{args.pages} page(s), {layout.orientation}, {layout.columns} column(s), "
        f"{layout.page_width}x{layout.page_height}px @ {args.dpi} DPI"
    )
    print(f"Column width: {layout.base_col_width * layout.scale / args.dpi:.2f} in")
    for path in written:
        print(f"Wrote {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
