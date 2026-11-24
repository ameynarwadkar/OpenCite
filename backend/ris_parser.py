from __future__ import annotations

from dataclasses import dataclass, field
import re

from backend.graph_builder import normalize_arxiv_id, normalize_doi


class RisParseError(ValueError):
    """Raised when a .ris file contains no valid RIS records."""


@dataclass
class ParsedRisEntry:
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    url: str | None = None
    abstract: str | None = None


_RIS_LINE_RE = re.compile(r"^([A-Z][A-Z0-9])\s{1,2}-\s*(.*)$")


def parse_ris_text(text: str, filename: str = "references.ris") -> list[ParsedRisEntry]:
    """Parse standard RIS (.ris) bibliography text into structured entries."""
    entries: list[ParsedRisEntry] = []
    cur_tags: dict[str, list[str]] = {}
    last_tag: str | None = None

    def _flush() -> None:
        nonlocal cur_tags, last_tag
        if not cur_tags:
            return
        title_vals = cur_tags.get("TI") or cur_tags.get("T1") or cur_tags.get("CT") or []
        title = " ".join(title_vals).strip()
        if title:
            authors = [a.strip() for a in (cur_tags.get("AU") or cur_tags.get("A1") or []) if a.strip()][:12]
            year: int | None = None
            for y_raw in cur_tags.get("PY") or cur_tags.get("Y1") or cur_tags.get("DA") or []:
                m = re.search(r"((?:19|20)\d{2})", y_raw)
                if m:
                    year = int(m.group(1))
                    break
            venue_vals = cur_tags.get("JO") or cur_tags.get("T2") or cur_tags.get("JF") or cur_tags.get("PB") or []
            venue = venue_vals[0].strip() if venue_vals else None
            doi_vals = cur_tags.get("DO") or []
            doi = normalize_doi(doi_vals[0]) if doi_vals else None
            url_vals = cur_tags.get("UR") or cur_tags.get("L1") or []
            url = url_vals[0].strip() if url_vals else None
            arxiv_id: str | None = None
            if url and "arxiv.org" in url.lower():
                arxiv_id = normalize_arxiv_id(url)
            abs_vals = cur_tags.get("AB") or cur_tags.get("N2") or []
            abstract = " ".join(abs_vals).strip() or None

            entries.append(
                ParsedRisEntry(
                    title=title,
                    authors=authors,
                    year=year,
                    venue=venue,
                    doi=doi,
                    arxiv_id=arxiv_id,
                    url=url,
                    abstract=abstract,
                )
            )
        cur_tags = {}
        last_tag = None

    for raw_line in text.splitlines():
        line = raw_line.rstrip("\r\n")
        m = _RIS_LINE_RE.match(line)
        if m:
            tag, value = m.group(1), m.group(2).strip()
            if tag == "ER":
                _flush()
            elif tag == "TY":
                if cur_tags:
                    _flush()
                cur_tags = {"TY": [value]}
                last_tag = "TY"
            else:
                cur_tags.setdefault(tag, []).append(value)
                last_tag = tag
        elif last_tag and line.strip() and last_tag in cur_tags and cur_tags[last_tag]:
            # Multi-line continuation for title/abstract
            cur_tags[last_tag][-1] = f"{cur_tags[last_tag][-1]} {line.strip()}".strip()

    _flush()
    if not entries:
        raise RisParseError(f"No valid RIS entries found in '{filename}'.")
    return entries
