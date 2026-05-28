# Cheat Sheet Stitcher

Build a print-ready cheat sheet PDF from a set of images.

Created by [kemsig](https://github.com/kemsig).

The project has two ways to use it:

- A browser app in `web/` that runs on static hosting such as GitHub Pages.
- A Python CLI that runs locally with Pillow for batch generation and print-focused output.

## Browser App

The web app runs entirely in the browser. It can upload images or ZIP archives of images, sort them, choose paper/page/layout settings, preview the pages, and download a PDF or PNG page previews.

```bash
cd web
npm install
npm run dev
```

Build the static site:

```bash
cd web
npm run build
```

The compiled site is written to `web/dist/`.

## GitHub Pages

This repo includes `.github/workflows/pages.yml`, which builds `web/` and publishes `web/dist/` with GitHub Actions.

To enable it:

1. Push the repo to GitHub.
2. Open the repository settings.
3. Go to `Pages`.
4. Set `Build and deployment -> Source` to `GitHub Actions`.
5. Push to `main` or run the `Deploy Pages` workflow manually.

The deployed app links back to the GitHub repo so users can also run the Python CLI locally.

## Python CLI

The local CLI builds a print-ready cheat sheet PDF from every image in `images/`.

```bash
python3 make_cheatsheet.py
```

Defaults:

- Reads from `images/`
- Writes `cheatsheet.pdf`
- Writes `cheatsheet-page-1.png`, `cheatsheet-page-2.png`, etc. as previews
- Uses 2 pages, intended for double-sided printing
- Uses US Letter at 300 DPI
- Automatically chooses portrait or landscape and the best column count
- Sorts images by natural filename order unless changed with `--sort`
- Draws reading-order numbers on each image

Useful options:

```bash
# Make a 4-page version.
python3 make_cheatsheet.py --pages 4

# Use A4 paper.
python3 make_cheatsheet.py --paper a4

# Sort images oldest to newest by modified time.
python3 make_cheatsheet.py --sort oldest

# Sort images newest to oldest by modified time.
python3 make_cheatsheet.py --sort newest

# Hide the reading-order numbers.
python3 make_cheatsheet.py --no-numbers

# Force landscape.
python3 make_cheatsheet.py --orientation landscape

# Pick another image folder and output file.
python3 make_cheatsheet.py --input my-images --output final-cheatsheet.pdf

# Only write the PDF.
python3 make_cheatsheet.py --no-png
```

Install the only dependency if needed:

```bash
python3 -m pip install -r requirements.txt
```
