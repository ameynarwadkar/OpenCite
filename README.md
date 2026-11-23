# Minimal Citation Graph

A lightweight local web app that builds an interactive directed citation graph from one or more academic papers—either uploaded **PDF files** (extracting references directly from the paper's References section) or **DOI / arXiv / OpenAlex IDs**.

## Features

- **PDF Reference Extraction:** Uses PyMuPDF (`pymupdf`) with 2-column layout awareness to extract citations directly from the paper's References/Bibliography section (`[1]`, `1.`, and author-year styles).
- **DOI / arXiv Lookup:** Resolves papers and their referenced works via the free OpenAlex API (with arXiv Atom fallback).
- **Multi-Paper Deduplication:** Merges identical citations across multiple input papers (by DOI, arXiv ID, OpenAlex ID, or normalized title + year) and highlights shared citations.
- **Click-to-Expand:** Click any cited paper node in the graph to inspect its metadata and expand its own outgoing citations on demand.
- **Interactive Layouts:** Force-directed (`cose`), **Timeline (sorted horizontally by publication year)**, Hierarchical, and Concentric.

## Quick Start

```powershell
# 1. Create and populate the virtual environment (already done if using this workspace)
uv venv .venv
uv pip install --python .venv\Scripts\python.exe -e ".[dev]"

# 2. Start the local server
.venv\Scripts\uvicorn.exe backend.main:app --reload
```

Then open **http://127.0.0.1:8000** in your browser.

## Running Tests

```powershell
.venv\Scripts\pytest.exe -v
```
