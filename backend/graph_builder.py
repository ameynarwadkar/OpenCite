from __future__ import annotations

import hashlib
import re

from backend.models import CitationEdge, GraphPayload, PaperNode

_DOI_PREFIX_RE = re.compile(r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)", re.IGNORECASE)
_ARXIV_PREFIX_RE = re.compile(
    r"^(?:https?://arxiv\.org/(?:abs|pdf)/|arxiv:\s*)", re.IGNORECASE
)
_ARXIV_VERSION_RE = re.compile(r"v\d+$", re.IGNORECASE)
_OPENALEX_RE = re.compile(r"(W\d+)$", re.IGNORECASE)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def normalize_doi(doi: str | None) -> str | None:
    if not doi:
        return None
    cleaned = _DOI_PREFIX_RE.sub("", doi.strip()).strip().rstrip(".,;)]}")
    if not cleaned or "/" not in cleaned:
        return None
    return cleaned.lower()


def normalize_arxiv_id(arxiv_id: str | None) -> str | None:
    if not arxiv_id:
        return None
    cleaned = _ARXIV_PREFIX_RE.sub("", arxiv_id.strip()).strip()
    cleaned = re.sub(r"\.pdf$", "", cleaned, flags=re.IGNORECASE)
    cleaned = cleaned.rstrip(".,;)]}")
    cleaned = _ARXIV_VERSION_RE.sub("", cleaned)
    if not cleaned:
        return None
    return cleaned.lower()


def normalize_openalex_id(oa_id: str | None) -> str | None:
    if not oa_id:
        return None
    match = _OPENALEX_RE.search(oa_id.strip())
    if not match:
        return None
    return match.group(1).upper()


def normalize_title(title: str | None) -> str:
    if not title:
        return ""
    return _NON_ALNUM_RE.sub(" ", title.lower()).strip()


def id_priority(node_id: str) -> int:
    if node_id.startswith("doi:"):
        return 4
    if node_id.startswith("arxiv:"):
        return 3
    if node_id.startswith("openalex:"):
        return 2
    return 1


def make_canonical_id(
    doi: str | None = None,
    arxiv_id: str | None = None,
    openalex_id: str | None = None,
    title: str | None = None,
    year: int | None = None,
    raw_citation: str | None = None,
) -> str:
    norm_doi = normalize_doi(doi)
    if norm_doi:
        return f"doi:{norm_doi}"
    norm_arxiv = normalize_arxiv_id(arxiv_id)
    if norm_arxiv:
        return f"arxiv:{norm_arxiv}"
    norm_oa = normalize_openalex_id(openalex_id)
    if norm_oa:
        return f"openalex:{norm_oa}"

    norm_title = normalize_title(title)
    key = f"{norm_title}|{year or ''}" if norm_title else normalize_title(raw_citation)
    if not key:
        key = "unknown"
    digest = hashlib.sha1(key.encode("utf-8")).hexdigest()[:12]
    return f"local:{digest}"


def build_default_url(
    doi: str | None, arxiv_id: str | None, openalex_id: str | None
) -> str | None:
    if doi:
        return f"https://doi.org/{doi}"
    if arxiv_id:
        return f"https://arxiv.org/abs/{arxiv_id}"
    if openalex_id:
        return f"https://openalex.org/{openalex_id}"
    return None


class GraphBuilder:
    """Builds a deduplicated directed citation graph."""

    def __init__(self) -> None:
        self.nodes: dict[str, PaperNode] = {}
        self._edges: set[tuple[str, str]] = set()
        self._by_doi: dict[str, str] = {}
        self._by_arxiv: dict[str, str] = {}
        self._by_openalex: dict[str, str] = {}
        self._by_title: dict[str, list[str]] = {}

    def _find_existing(self, node: PaperNode) -> str | None:
        if node.id in self.nodes:
            return node.id
        if node.doi and node.doi in self._by_doi:
            return self._by_doi[node.doi]
        if node.arxiv_id and node.arxiv_id in self._by_arxiv:
            return self._by_arxiv[node.arxiv_id]
        if node.openalex_id and node.openalex_id in self._by_openalex:
            return self._by_openalex[node.openalex_id]

        norm_title = normalize_title(node.title)
        if len(norm_title) >= 15 and norm_title in self._by_title:
            for candidate_id in self._by_title[norm_title]:
                existing = self.nodes.get(candidate_id)
                if not existing:
                    continue
                if (
                    existing.year is None
                    or node.year is None
                    or existing.year == node.year
                ):
                    return candidate_id
        return None

    def _index_node(self, node: PaperNode) -> None:
        if node.doi:
            self._by_doi[node.doi] = node.id
        if node.arxiv_id:
            self._by_arxiv[node.arxiv_id] = node.id
        if node.openalex_id:
            self._by_openalex[node.openalex_id] = node.id
        norm_title = normalize_title(node.title)
        if len(norm_title) >= 15:
            bucket = self._by_title.setdefault(norm_title, [])
            if node.id not in bucket:
                bucket.append(node.id)

    def _remap_id(self, old_id: str, new_id: str) -> None:
        if old_id == new_id:
            return
        updated_edges: set[tuple[str, str]] = set()
        for src, dst in self._edges:
            new_src = new_id if src == old_id else src
            new_dst = new_id if dst == old_id else dst
            if new_src != new_dst:
                updated_edges.add((new_src, new_dst))
        self._edges = updated_edges

        for mapping in (self._by_doi, self._by_arxiv, self._by_openalex):
            for k, v in list(mapping.items()):
                if v == old_id:
                    mapping[k] = new_id
        for title_key, ids in self._by_title.items():
            self._by_title[title_key] = [
                new_id if cid == old_id else cid for cid in ids
            ]

    def add_node(self, node: PaperNode) -> str:
        norm_doi = normalize_doi(node.doi)
        norm_arxiv = normalize_arxiv_id(node.arxiv_id)
        norm_oa = normalize_openalex_id(node.openalex_id)
        canonical_id = make_canonical_id(
            doi=norm_doi,
            arxiv_id=norm_arxiv,
            openalex_id=norm_oa,
            title=node.title,
            year=node.year,
            raw_citation=node.raw_citation,
        )
        normalized = node.model_copy(
            update={
                "id": canonical_id,
                "doi": norm_doi,
                "arxiv_id": norm_arxiv,
                "openalex_id": norm_oa,
                "url": node.url or build_default_url(norm_doi, norm_arxiv, norm_oa),
                "expandable": bool(
                    norm_doi or norm_arxiv or norm_oa or normalize_title(node.title)
                ),
            }
        )

        existing_id = self._find_existing(normalized)
        if existing_id is None:
            self.nodes[normalized.id] = normalized
            self._index_node(normalized)
            return normalized.id

        existing = self.nodes[existing_id]
        # Choose stronger canonical ID if one has higher priority
        target_id = (
            normalized.id
            if id_priority(normalized.id) > id_priority(existing.id)
            else existing.id
        )

        # Prefer longer/cleaner title when existing is a fallback
        best_title = existing.title
        if (not best_title or best_title == "Untitled") and normalized.title:
            best_title = normalized.title
        elif (
            existing.raw_citation
            and not normalized.raw_citation
            and normalized.title
            and len(normalized.title) >= 5
        ):
            best_title = normalized.title

        merged_contexts = list(existing.citation_contexts)
        for ctx in normalized.citation_contexts:
            if ctx not in merged_contexts and len(merged_contexts) < 5:
                merged_contexts.append(ctx)

        merged = PaperNode(
            id=target_id,
            title=best_title,
            authors=existing.authors if len(existing.authors) >= len(normalized.authors) else normalized.authors,
            year=existing.year or normalized.year,
            venue=existing.venue or normalized.venue,
            doi=existing.doi or normalized.doi,
            arxiv_id=existing.arxiv_id or normalized.arxiv_id,
            openalex_id=existing.openalex_id or normalized.openalex_id,
            url=existing.url or normalized.url or build_default_url(
                existing.doi or normalized.doi,
                existing.arxiv_id or normalized.arxiv_id,
                existing.openalex_id or normalized.openalex_id,
            ),
            raw_citation=existing.raw_citation or normalized.raw_citation,
            citation_contexts=merged_contexts,
            abstract=existing.abstract or normalized.abstract,
            topics=existing.topics if len(existing.topics) >= len(normalized.topics) else normalized.topics,
            cited_by_count=(
                existing.cited_by_count
                if existing.cited_by_count is not None
                else normalized.cited_by_count
            ),
            is_seed=existing.is_seed or normalized.is_seed,
            is_expanded=existing.is_expanded or normalized.is_expanded,
            is_cited_by_expanded=existing.is_cited_by_expanded or normalized.is_cited_by_expanded,
            expandable=existing.expandable or normalized.expandable,
        )

        if target_id != existing_id:
            del self.nodes[existing_id]
            self._remap_id(existing_id, target_id)
        self.nodes[target_id] = merged
        self._index_node(merged)
        return target_id

    def add_edge(self, source_id: str, target_id: str) -> None:
        if not source_id or not target_id or source_id == target_id:
            return
        self._edges.add((source_id, target_id))

    def build(self, warnings: list[str] | None = None) -> GraphPayload:
        edges = [
            CitationEdge(source=src, target=dst)
            for src, dst in sorted(self._edges)
            if src in self.nodes and dst in self.nodes
        ]
        return GraphPayload(
            nodes=list(self.nodes.values()),
            edges=edges,
            warnings=list(warnings or []),
        )
