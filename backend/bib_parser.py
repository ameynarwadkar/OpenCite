from __future__ import annotations

from dataclasses import dataclass, field
import re

from backend.graph_builder import normalize_arxiv_id, normalize_doi


class BibParseError(ValueError):
    """Raised when a .bib file has no valid BibTeX entries."""


@dataclass
class ParsedBibEntry:
    cite_key: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    url: str | None = None


_ENTRY_START_RE = re.compile(r"@(\w+)\s*\{\s*([^,\s]+)\s*,", re.IGNORECASE)
_FIELD_NAME_RE = re.compile(r"([a-zA-Z_][a-zA-Z0-9_\-]*)\s*=\s*")


def _clean_bib_value(val: str) -> str:
    # Strip outer braces/quotes and collapse whitespace
    cleaned = val.strip().rstrip(",").strip()
    while (cleaned.startswith("{") and cleaned.endswith("}")) or (
        cleaned.startswith('"') and cleaned.endswith('"')
    ):
        cleaned = cleaned[1:-1].strip()
    cleaned = cleaned.replace("{", "").replace("}", "")
    return re.sub(r"\s+", " ", cleaned).strip()


def _extract_balanced_block(text: str, open_idx: int) -> tuple[str, int]:
    depth = 0
    for i in range(open_idx, len(text)):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[open_idx + 1 : i], i + 1
    return text[open_idx + 1 :], len(text)


def _parse_fields(body: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    pos = 0
    n = len(body)
    while pos < n:
        m = _FIELD_NAME_RE.search(body, pos)
        if not m:
            break
        key = m.group(1).lower()
        val_start = m.end()
        while val_start < n and body[val_start].isspace():
            val_start += 1
        if val_start >= n:
            break

        if body[val_start] == "{":
            raw_val, next_pos = _extract_balanced_block(body, val_start)
        elif body[val_start] == '"':
            end_q = val_start + 1
            while end_q < n:
                if body[end_q] == '"' and body[end_q - 1] != "\\":
                    break
                end_q += 1
            raw_val = body[val_start + 1 : end_q]
            next_pos = end_q + 1
        else:
            comma = body.find(",", val_start)
            if comma == -1:
                raw_val = body[val_start:]
                next_pos = n
            else:
                raw_val = body[val_start:comma]
                next_pos = comma + 1

        fields[key] = _clean_bib_value(raw_val)
        pos = next_pos
    return fields


def parse_bib_text(text: str, filename: str = "references.bib") -> list[ParsedBibEntry]:
    """Parse a BibTeX string into structured entries."""
    entries: list[ParsedBibEntry] = []
    pos = 0
    while True:
        m = _ENTRY_START_RE.search(text, pos)
        if not m:
            break
        entry_type = m.group(1).lower()
        cite_key = m.group(2).strip()
        brace_idx = text.find("{", m.start())
        block, next_pos = _extract_balanced_block(text, brace_idx)
        pos = next_pos

        if entry_type in ("comment", "preamble", "string"):
            continue

        # Strip cite_key up to first comma
        first_comma = block.find(",")
        if first_comma == -1:
            continue
        fields = _parse_fields(block[first_comma + 1 :])
        title = fields.get("title", "").strip()
        if not title:
            continue

        authors_raw = fields.get("author", "")
        authors = [
            a.strip()
            for a in re.split(r"\s+and\s+", authors_raw, flags=re.IGNORECASE)
            if a.strip()
        ][:12]

        year: int | None = None
        if yr_str := fields.get("year"):
            ym = re.search(r"((?:19|20)\d{2})", yr_str)
            if ym:
                year = int(ym.group(1))

        venue = fields.get("journal") or fields.get("booktitle") or fields.get("publisher") or None
        doi = normalize_doi(fields.get("doi"))
        arxiv_id = normalize_arxiv_id(fields.get("eprint"))
        if not arxiv_id and fields.get("url") and "arxiv.org" in fields["url"].lower():
            arxiv_id = normalize_arxiv_id(fields["url"])

        entries.append(
            ParsedBibEntry(
                cite_key=cite_key,
                title=title,
                authors=authors,
                year=year,
                venue=venue,
                doi=doi,
                arxiv_id=arxiv_id,
                url=fields.get("url") or None,
            )
        )

    if not entries:
        raise BibParseError(f"No valid BibTeX entries found in '{filename}'.")
    return entries
