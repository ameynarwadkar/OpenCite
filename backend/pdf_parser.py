from __future__ import annotations

from dataclasses import dataclass, field
import re

import pymupdf

from backend.graph_builder import normalize_arxiv_id, normalize_doi

_DOI_RE = re.compile(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)", re.IGNORECASE)
_ARXIV_RE = re.compile(
    r"(?:arxiv:\s*|arxiv\.org/(?:abs|pdf)/|corr[,\s]+abs/)(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+/\d{7}(?:v\d+)?)",
    re.IGNORECASE,
)
_VENUE_START_RE = re.compile(
    r"^(?:in\s+[A-Z]|corr\b|proceedings\s+of\b|advances\s+in\b|transactions\s+of\b|journal\s+of\b|arxiv\b|http|doi:|pp\.|vol\.|volume\s+)",
    re.IGNORECASE,
)
# Matches ICML/NeurIPS/ACL author lists like "Zhang, Y., Li, M., and Zhou, J."
_LAST_INITIALS_AUTHOR_BLOCK_RE = re.compile(
    r"^((?:(?:and\s+|&\s+)?[A-Z][A-Za-z'\-\u00C0-\u024F]+(?:\s+[A-Z][A-Za-z'\-\u00C0-\u024F]+)?,\s*(?:[A-Z]\.(?:\s|-)*)+(?:,\s*(?:and\s+|&\s+)?|\s+and\s+|\s*&\s*|\s+))+)"
)
_REF_HEADING_RE = re.compile(
    r"^\s*(?:[0-9IVX]+\.?\s*)?(?:references|bibliography|works\s+cited|literature\s+cited)\s*$",
    re.IGNORECASE,
)
_STOP_HEADING_RE = re.compile(
    r"^\s*(?:[A-Z]\.?\s*)?(?:appendix|appendices|supplementary\s+material|supplemental\s+material)\b.*$",
    re.IGNORECASE,
)
_PAGE_NUM_RE = re.compile(r"^\s*\d{1,4}\s*$")
_YEAR_PAREN_RE = re.compile(r"\(((?:19|20)\d{2})[a-z]?\)")
_YEAR_ANY_RE = re.compile(r"\b((?:19[5-9]\d|20[0-3]\d))[a-z]?\b")
_YEAR_APOSTROPHE_RE = re.compile(r"(?:[A-Za-z]\s*|[\s(])['’](\d{2})\b")
_QUOTED_TITLE_RE = re.compile(r'["“]([^"”]{10,300})["”]')
_BRACKET_START_RE = re.compile(r"^\s*\[\d{1,4}\]\s+")
_DOT_NUM_START_RE = re.compile(r"^\s*(\d{1,4})\.\s+")
_AUTHOR_START_RE = re.compile(
    r"^[A-Z][A-Za-z'\-]{1,25},\s+(?:[A-Z]\.|[A-Z][a-z]+)"
)


class PDFParseError(ValueError):
    """Raised when an uploaded PDF cannot be parsed or has no extractable text."""


@dataclass
class ParsedReference:
    raw: str
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    ref_number: int | None = None
    citation_contexts: list[str] = field(default_factory=list)


@dataclass
class ParsedPdfPaper:
    title: str
    authors: list[str] = field(default_factory=list)
    year: int | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    abstract: str | None = None
    references: list[ParsedReference] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _extract_page_text_column_aware(page: pymupdf.Page) -> str:
    """Extract text blocks in reading order, handling 2-column academic layouts."""
    raw_blocks = page.get_text("blocks")
    text_blocks = [
        b for b in raw_blocks if b[6] == 0 and isinstance(b[4], str) and b[4].strip()
    ]
    if not text_blocks:
        return ""

    mid = page.rect.width / 2.0
    left = [b for b in text_blocks if b[2] <= mid + 20]
    right = [b for b in text_blocks if b[0] >= mid - 20]
    spanning = [b for b in text_blocks if b[0] < mid - 20 and b[2] > mid + 20]

    # Treat as 2-column if both left and right columns have multiple blocks
    if len(left) >= 2 and len(right) >= 2:
        min_col_y = min(min(b[1] for b in left), min(b[1] for b in right))
        top_span = sorted(
            [b for b in spanning if b[1] < min_col_y], key=lambda b: (b[1], b[0])
        )
        bottom_span = sorted(
            [b for b in spanning if b[1] >= min_col_y], key=lambda b: (b[1], b[0])
        )
        ordered = (
            top_span
            + sorted(left, key=lambda b: (b[1], b[0]))
            + sorted(right, key=lambda b: (b[1], b[0]))
            + bottom_span
        )
    else:
        ordered = sorted(text_blocks, key=lambda b: (round(b[1], 1), round(b[0], 1)))

    return "\n".join(b[4].strip() for b in ordered)


def _extract_title_from_first_page(page: pymupdf.Page, fallback_title: str) -> str:
    """Estimate paper title from largest font spans in the upper portion of page 1."""
    page_dict = page.get_text("dict")
    max_y = page.rect.height * 0.55
    candidates: list[tuple[float, float, str]] = []

    for block in page_dict.get("blocks", []):
        if block.get("type") != 0:
            continue
        for line in block.get("lines", []):
            y0 = line["bbox"][1]
            if y0 > max_y:
                continue
            spans = line.get("spans", [])
            if not spans:
                continue
            text = " ".join(s.get("text", "").strip() for s in spans if s.get("text", "").strip())
            if not text or len(text) < 4:
                continue
            # Skip boilerplate headers
            lower = text.lower()
            if lower.startswith(("arxiv:", "published as", "preprint", "proceedings of", "copyright")):
                continue
            max_size = max(float(s.get("size", 0.0)) for s in spans)
            candidates.append((max_size, y0, text))

    if not candidates:
        return fallback_title

    top_size = max(c[0] for c in candidates)
    # Collect lines within 1.5pt of the largest font size
    title_lines = [c for c in candidates if c[0] >= top_size - 1.5]
    title_lines.sort(key=lambda c: c[1])
    title = " ".join(c[2] for c in title_lines[:3]).strip()
    title = re.sub(r"\s+", " ", title)
    return title if len(title) >= 5 else fallback_title


def _extract_doi(text: str) -> str | None:
    match = _DOI_RE.search(text)
    if not match:
        return None
    return normalize_doi(match.group(1))


def _extract_arxiv_id(text: str) -> str | None:
    match = _ARXIV_RE.search(text)
    if not match:
        return None
    return normalize_arxiv_id(match.group(1))


def _infer_year_from_arxiv(arxiv_id: str | None) -> int | None:
    if not arxiv_id:
        return None
    if re.match(r"^\d{4}\.", arxiv_id):
        yy = int(arxiv_id[:2])
        return 2000 + yy if yy < 50 else 1900 + yy
    old_match = re.search(r"/(\d{2})\d{5}$", arxiv_id)
    if old_match:
        yy = int(old_match.group(1))
        return 1900 + yy if yy >= 90 else 2000 + yy
    return None


def _extract_year(text: str) -> int | None:
    paren = _YEAR_PAREN_RE.search(text)
    if paren:
        return int(paren.group(1))
    matches = _YEAR_ANY_RE.findall(text)
    if matches:
        # Prefer the last plausible year in the citation (often near venue/date)
        return int(matches[-1])
    apos = _YEAR_APOSTROPHE_RE.findall(text)
    if apos:
        yy = int(apos[-1])
        return 2000 + yy if yy <= 35 else 1900 + yy
    return None


def _clean_ref_text(raw: str) -> str:
    # Rejoin words hyphenated across line breaks
    text = re.sub(r"(\w)-\s*\n\s*(\w)", r"\1\2", raw)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def _split_authors(author_str: str) -> list[str]:
    cleaned = author_str.strip().rstrip(".,;:")
    if not cleaned:
        return []
    # Split on " and " or "; " or ", " (careful with "Last, F." format)
    if ";" in cleaned:
        parts = [p.strip() for p in cleaned.split(";")]
    elif " and " in cleaned:
        # Replace " and " with comma if not "Last, F." style
        parts = [p.strip() for p in re.split(r",\s+and\s+|\s+and\s+|,\s+(?=[A-Z][a-z]+\s+[A-Z])", cleaned)]
    else:
        parts = [p.strip() for p in cleaned.split(",")]
    authors = [p for p in parts if p and len(p) <= 60 and not p.lower().startswith("et al")]
    return authors[:8]


def _extract_title_from_remainder(remainder: str) -> str:
    """Extract the paper title sentence from text following the author block."""
    cleaned = remainder.strip().lstrip(".,;: ")
    if not cleaned:
        return ""
    # Split on sentence boundary (period/question/exclamation followed by space, ignoring single-letter initials)
    # Also stop before common venue markers like " In EMNLP" or " CoRR,"
    segments = [
        s.strip()
        for s in re.split(r"(?<!\b[A-Z])(?<!\bpp)(?<!\bvol)(?<!\bal)[.?!]\s+", cleaned, flags=re.IGNORECASE)
        if s.strip()
    ]
    for seg in segments:
        if not _VENUE_START_RE.match(seg) and len(seg) >= 6:
            return seg.rstrip(".,;:")
    return segments[0].rstrip(".,;:") if segments else ""


def _parse_single_reference(raw_entry: str) -> ParsedReference:
    cleaned = _clean_ref_text(raw_entry)
    doi = _extract_doi(cleaned)
    arxiv_id = _extract_arxiv_id(cleaned)
    year = _extract_year(cleaned) or _infer_year_from_arxiv(arxiv_id)

    ref_number: int | None = None
    num_match = re.match(r"^\s*(?:\[(\d{1,4})\]|(\d{1,4})\.)\s*", cleaned)
    if num_match:
        ref_number = int(num_match.group(1) or num_match.group(2))

    body = re.sub(r"^\s*(?:\[\d{1,4}\]|\d{1,4}\.)\s*", "", cleaned).strip()
    authors: list[str] = []
    title = ""

    # Strategy 1: Quoted title ("Title Here" or “Title Here”)
    quoted = _QUOTED_TITLE_RE.search(body)
    if quoted:
        title = quoted.group(1).strip().rstrip(".,")
        before = body[: quoted.start()].strip()
        authors = _split_authors(before)
    else:
        # Strategy 2: APA style "Authors (2020). Title. Venue."
        apa_match = re.search(r"\((?:19|20)\d{2}[a-z]?\)\.?\s+([^.?!]{10,260})", body)
        if apa_match and apa_match.start() > 3:
            authors = _split_authors(body[: apa_match.start()])
            title = apa_match.group(1).strip().rstrip(".,")
        else:
            # Strategy 3: ICML/ACL/NeurIPS "Last, F., Last2, G., and Last3, H. Title. Venue, 2025."
            author_block = _LAST_INITIALS_AUTHOR_BLOCK_RE.match(body)
            if author_block and author_block.end() < len(body) - 10:
                authors_text = author_block.group(1).strip()
                remainder = body[author_block.end() :].strip()
                candidate_title = _extract_title_from_remainder(remainder)
                if candidate_title and not _VENUE_START_RE.match(candidate_title):
                    # Extract "Last, F." pairs cleanly
                    authors = [
                        m.group(0).strip().rstrip(",")
                        for m in re.finditer(
                            r"[A-Z][A-Za-z'\-\u00C0-\u024F]+,\s*(?:[A-Z]\.(?:\s|-)*)+",
                            authors_text,
                        )
                    ][:8]
                    title = candidate_title

            # Strategy 4: "Author et al. Title. Venue"
            if not title:
                etal = re.search(r"\bet\s+al\.?\s+", body, re.IGNORECASE)
                if etal and etal.end() < len(body) - 10:
                    authors = _split_authors(body[: etal.start()])
                    title = _extract_title_from_remainder(body[etal.end() :])

            # Strategy 5: Period-separated segments ("Authors. Title. Venue, 2020.")
            if not title:
                segments = [
                    s.strip()
                    for s in re.split(r"(?<!\b[A-Z])\.\s+", body)
                    if s.strip()
                ]
                if len(segments) >= 2:
                    authors = _split_authors(segments[0])
                    for seg in segments[1:]:
                        if len(seg.split()) >= 3 and not _VENUE_START_RE.match(seg):
                            title = seg.rstrip(".,")
                            break
                if not title and segments:
                    title = segments[0][:140].rstrip(".,")

    if not title:
        title = body[:140].strip() or "Untitled reference"

    return ParsedReference(
        raw=cleaned,
        title=title,
        authors=authors,
        year=year,
        doi=doi,
        arxiv_id=arxiv_id,
        ref_number=ref_number,
    )


def _split_body_sentences(pages_text: list[str]) -> list[str]:
    """Return cleaned sentences from the paper body (everything before References)."""
    all_lines: list[str] = []
    for text in pages_text:
        all_lines.extend(text.splitlines())

    heading_idx = len(all_lines)
    for idx in range(len(all_lines) - 1, -1, -1):
        if _REF_HEADING_RE.match(all_lines[idx]):
            heading_idx = idx
            break

    body_text = _clean_ref_text("\n".join(all_lines[:heading_idx]))
    raw_sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9(\[])", body_text)
    return [s.strip() for s in raw_sentences if 25 <= len(s.strip()) <= 500]


def _extract_first_surname(ref: ParsedReference) -> str | None:
    if ref.authors:
        first = ref.authors[0].strip()
        if "," in first:
            surname = first.split(",", 1)[0].strip()
        else:
            parts = first.split()
            surname = parts[-1].strip() if parts else ""
        if len(surname) >= 3 and surname[0].isupper():
            return surname
    m = re.match(r"^([A-Z][A-Za-z'\-]{2,25})[,\s]", ref.raw)
    return m.group(1) if m else None


def _attach_citation_contexts(
    references: list[ParsedReference], body_sentences: list[str]
) -> None:
    if not body_sentences or not references:
        return

    for ref in references:
        matches: list[str] = []
        if ref.ref_number is not None:
            num = str(ref.ref_number)
            pat = re.compile(rf"\[(?:\d+\s*[-–,]\s*)*\b{num}\b(?:\s*[-–,]\s*\d+)*\]")
            for sent in body_sentences:
                if pat.search(sent):
                    matches.append(sent[:320])
                    if len(matches) >= 3:
                        break
        else:
            surname = _extract_first_surname(ref)
            if surname and ref.year:
                pat = re.compile(
                    rf"\b{re.escape(surname)}\b.{{0,40}}\b{ref.year}[a-z]?\b"
                )
                for sent in body_sentences:
                    if pat.search(sent):
                        matches.append(sent[:320])
                        if len(matches) >= 3:
                            break
        ref.citation_contexts = matches


def _locate_references_lines(pages_text: list[str]) -> list[str]:
    """Find the References/Bibliography section scanning from the back."""
    all_lines: list[str] = []
    for text in pages_text:
        all_lines.extend(text.splitlines())

    heading_idx: int | None = None
    for idx in range(len(all_lines) - 1, -1, -1):
        if _REF_HEADING_RE.match(all_lines[idx]):
            heading_idx = idx
            break

    if heading_idx is None:
        return []

    ref_lines: list[str] = []
    for line in all_lines[heading_idx + 1 :]:
        stripped = line.strip()
        if _PAGE_NUM_RE.match(stripped):
            continue
        if len(ref_lines) >= 3 and _STOP_HEADING_RE.match(stripped):
            break
        ref_lines.append(line)
    return ref_lines


def _looks_like_complete_reference(lines: list[str]) -> bool:
    if not lines:
        return False
    last = lines[-1].strip()
    if not last:
        return False
    # Never split right after a comma, semicolon, hyphen, or "and" / "&"
    if re.search(r"(?:[,;\-&]|\band)$", last, re.IGNORECASE):
        return False
    joined = " ".join(lines)
    if (
        _extract_year(joined) is not None
        or _extract_arxiv_id(joined) is not None
        or _extract_doi(joined) is not None
    ):
        return True
    # Allow split if the entry clearly ends with a sentence period (not a single-letter initial)
    if last.endswith(".") and not re.search(r"\b[A-Z]\.$", last):
        return True
    return False


def _merge_orphan_fragments(entries: list[str]) -> list[str]:
    """Merge accidental author-only fragments (e.g. split across a page break) into the next entry."""
    if len(entries) < 2:
        return entries
    merged: list[str] = []
    i = 0
    while i < len(entries):
        chunk = entries[i].strip()
        if (
            i + 1 < len(entries)
            and not _looks_like_complete_reference(chunk.splitlines())
        ):
            entries[i + 1] = chunk + "\n" + entries[i + 1]
        else:
            merged.append(chunk)
        i += 1
    return merged


def _split_reference_entries(ref_lines: list[str]) -> list[str]:
    if not ref_lines:
        return []

    non_empty = [line for line in ref_lines if line.strip()]
    if not non_empty:
        return []

    # Format 1: Bracketed [1], [2], ...
    bracket_hits = sum(1 for line in non_empty if _BRACKET_START_RE.match(line))
    if bracket_hits >= 2 or (bracket_hits == 1 and len(non_empty) <= 5):
        entries: list[str] = []
        current: list[str] = []
        for line in non_empty:
            if _BRACKET_START_RE.match(line):
                if current:
                    entries.append("\n".join(current))
                current = [line]
            elif current:
                current.append(line)
        if current:
            entries.append("\n".join(current))
        return entries

    # Format 2: Dot-numbered 1., 2., ...
    dot_nums: list[int] = []
    for line in non_empty:
        m = _DOT_NUM_START_RE.match(line)
        if m:
            dot_nums.append(int(m.group(1)))
    if len(dot_nums) >= 2 and dot_nums[0] in (1, 2):
        entries = []
        current = []
        for line in non_empty:
            m = _DOT_NUM_START_RE.match(line)
            if m and int(m.group(1)) <= 500:
                if current:
                    entries.append("\n".join(current))
                current = [line]
            elif current:
                current.append(line)
        if current:
            entries.append("\n".join(current))
        return entries

    # Format 3: Blank-line separated paragraphs or Author, A. starts
    joined = "\n".join(ref_lines)
    blank_chunks = [c.strip() for c in re.split(r"\n\s*\n", joined) if c.strip()]
    if len(blank_chunks) >= 2:
        return _merge_orphan_fragments(blank_chunks)

    author_hits = sum(1 for line in non_empty if _AUTHOR_START_RE.match(line.strip()))
    if author_hits >= 2:
        entries = []
        current = []
        for line in non_empty:
            if _AUTHOR_START_RE.match(line.strip()) and (
                not current or _looks_like_complete_reference(current)
            ):
                if current:
                    entries.append("\n".join(current))
                current = [line]
            else:
                current.append(line)
        if current:
            entries.append("\n".join(current))
        return _merge_orphan_fragments(entries)

    # Last resort: each non-empty line with >= 25 chars
    return [line.strip() for line in non_empty if len(line.strip()) >= 25]


def _extract_abstract_from_first_page(text: str) -> str | None:
    """Extract the Abstract section from page 1 text if present."""
    match = re.search(
        r"(?:^|\n)\s*abstract\s*[:.\-]?\s*\n?(.*?)(?=\n\s*(?:1\.?\s+introduction|i\.?\s+introduction|keywords|index\s+terms|ccs\s+concepts|\d+\.?\s+[A-Z]))",
        text,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not match:
        return None
    cleaned = _clean_ref_text(match.group(1))
    if 40 <= len(cleaned) <= 3000:
        return cleaned
    return None


def parse_pdf_bytes(data: bytes, filename: str = "paper.pdf") -> ParsedPdfPaper:
    """Parse a PDF's seed metadata and References section into structured data."""
    try:
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception as exc:
        raise PDFParseError(f"Could not open '{filename}' as a valid PDF.") from exc

    try:
        if doc.is_encrypted:
            raise PDFParseError(f"'{filename}' is password-protected / encrypted.")
        if doc.page_count == 0:
            raise PDFParseError(f"'{filename}' has no pages.")

        pages_text = [_extract_page_text_column_aware(page) for page in doc]
        total_chars = sum(len(t.strip()) for t in pages_text)
        if total_chars < 20:
            raise PDFParseError(
                f"No extractable text found in '{filename}'. Scanned image PDFs require OCR."
            )

        fallback_title = (
            (doc.metadata.get("title") or "").strip()
            or re.sub(r"\.pdf$", "", filename, flags=re.IGNORECASE).replace("_", " ").strip()
            or "Untitled Paper"
        )
        title = _extract_title_from_first_page(doc[0], fallback_title)
        first_page_lines = pages_text[0].splitlines()
        pre_ref_lines: list[str] = []
        for line in first_page_lines:
            if _REF_HEADING_RE.match(line):
                break
            pre_ref_lines.append(line)
        first_page_header = "\n".join(pre_ref_lines)[:1500]
        seed_doi = _extract_doi(first_page_header)
        seed_arxiv = _extract_arxiv_id(first_page_header)
        seed_abstract = _extract_abstract_from_first_page(pages_text[0])

        # Prefer authoritative arXiv ID year first; never let in-text citations like
        # "(Vaswani et al., 2017)" in the abstract/intro override the paper's own year.
        seed_year = _infer_year_from_arxiv(seed_arxiv)
        if seed_year is None:
            # Only scan header lines before "Abstract" / "Introduction" for a printed year
            pre_abstract_lines: list[str] = []
            for line in pre_ref_lines:
                if re.match(r"^\s*(?:abstract|1\.?\s+introduction)\b", line, re.IGNORECASE):
                    break
                pre_abstract_lines.append(line)
            header_only = "\n".join(pre_abstract_lines)[:500]
            seed_year = _extract_year(header_only)
        if seed_year is None:
            meta_date = (doc.metadata.get("creationDate") or doc.metadata.get("modDate") or "").strip()
            m_date = re.search(r"D:((?:19|20)\d{2})", meta_date)
            if m_date:
                seed_year = int(m_date.group(1))

        ref_lines = _locate_references_lines(pages_text)
        warnings: list[str] = []
        if not ref_lines:
            warnings.append(
                f"No References section detected in '{filename}'. Added seed paper only."
            )
            return ParsedPdfPaper(
                title=title,
                year=seed_year,
                doi=seed_doi,
                arxiv_id=seed_arxiv,
                abstract=seed_abstract,
                references=[],
                warnings=warnings,
            )

        raw_entries = _split_reference_entries(ref_lines)
        parsed_refs = [
            _parse_single_reference(entry)
            for entry in raw_entries
            if len(entry.strip()) >= 12
        ]
        body_sentences = _split_body_sentences(pages_text)
        _attach_citation_contexts(parsed_refs, body_sentences)

        return ParsedPdfPaper(
            title=title,
            year=seed_year,
            doi=seed_doi,
            arxiv_id=seed_arxiv,
            abstract=seed_abstract,
            references=parsed_refs,
            warnings=warnings,
        )
    finally:
        doc.close()
