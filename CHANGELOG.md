# Changelog

All notable changes to **OpenCite** are documented in this file.
Versioning follows [Semantic Versioning](https://semver.org/).

## [0.5.0] - 2026-11-26

### Added
- **PDF, `.bib`, and `.ris` Ingestion:** Two-column aware PDF reference extraction (`pymupdf`) with in-paper citation context snippets, plus BibTeX (`.bib`) and RIS (`.ris`) import with one-click cross-citation linking.
- **Multi-Source Citation Resolution:** OpenAlex primary lookup with Crossref, arXiv Atom, and Semantic Scholar fallbacks for references, forward citations (`→ Newer`), and abstracts.
- **Interactive Graph & Anti-Hairball UX:** Clustered (`fCoSE`), Timeline →, Layered (`ELK`), and Ego-Network layouts; click-to-focus subgraph framing; Graph Density cap (`Top 20 / 40 / 60 / All`); direction, relevance, depth, year, citation, and topic filters; Bridge Paper discovery; shortest-path finder.
- **Retracted Paper Radar:** Highlights retracted works (`is_retracted`) with warning rings on the canvas and badges in the Inspector and Discover views.
- **Strict Local-Only (Offline) Mode:** Zero-egress toggle (`offline=true`) skipping all external API calls for unpublished manuscripts.
- **Exports:** Bulk `.bib`, vector `.svg`, 2× `.png`, and `.json`.
- **Distribution & Hosting:** Chrome/Edge/Firefox Manifest V3 extension (`extension/`), `?id=` URL preloading, standalone Windows/macOS PyInstaller desktop packaging (`launcher.py`), multi-stage `Dockerfile`, `/healthz`, upload guards, and per-IP API rate limiting.
