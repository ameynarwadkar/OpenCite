from __future__ import annotations

import asyncio
from collections import OrderedDict
import re
import xml.etree.ElementTree as ET

import httpx

from backend.graph_builder import (
    build_default_url,
    make_canonical_id,
    normalize_arxiv_id,
    normalize_doi,
    normalize_openalex_id,
    normalize_title,
)
from backend.models import PaperNode

OPENALEX_API = "https://api.openalex.org"
ARXIV_API = "https://export.arxiv.org/api/query"
USER_AGENT = "citation-graph/0.1 (mailto:citation-graph@local.dev)"
WORK_SELECT_FIELDS = (
    "id,doi,ids,title,publication_year,authorships,primary_location,referenced_works"
)
MAX_REFERENCES_PER_PAPER = 200
BATCH_SIZE = 50

_ARXIV_ID_PATTERN = re.compile(
    r"^(?:https?://arxiv\.org/(?:abs|pdf)/|arxiv:\s*)?(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+/\d{7}(?:v\d+)?)(?:\.pdf)?$",
    re.IGNORECASE,
)
_OPENALEX_ID_PATTERN = re.compile(
    r"^(?:https?://openalex\.org/)?(W\d+)$", re.IGNORECASE
)
_DOI_PATTERN = re.compile(
    r"^(?:https?://(?:dx\.)?doi\.org/|doi:\s*)?(10\.\d{4,9}/\S+)$", re.IGNORECASE
)


def classify_identifier(raw: str) -> tuple[str, str] | None:
    cleaned = raw.strip()
    if not cleaned:
        return None
    if m := _OPENALEX_ID_PATTERN.match(cleaned):
        return ("openalex", m.group(1).upper())
    if m := _ARXIV_ID_PATTERN.match(cleaned):
        norm = normalize_arxiv_id(m.group(1))
        if norm:
            return ("arxiv", norm)
    if m := _DOI_PATTERN.match(cleaned):
        norm = normalize_doi(m.group(1))
        if norm:
            return ("doi", norm)
    return None


def _extract_arxiv_from_work(work: dict) -> str | None:
    ids = work.get("ids") or {}
    if isinstance(ids, dict) and ids.get("arxiv"):
        return normalize_arxiv_id(str(ids["arxiv"]))
    doi = normalize_doi(work.get("doi"))
    if doi and doi.startswith("10.48550/arxiv."):
        return normalize_arxiv_id(doi[len("10.48550/arxiv.") :])
    return None


def openalex_work_to_node(
    work: dict, *, is_seed: bool = False, is_expanded: bool = False
) -> PaperNode:
    oa_id = normalize_openalex_id(work.get("id"))
    doi = normalize_doi(work.get("doi"))
    arxiv_id = _extract_arxiv_from_work(work)
    title = (work.get("title") or "").strip() or "Untitled Paper"
    year = work.get("publication_year")
    if not isinstance(year, int):
        year = None

    authors: list[str] = []
    for auth in work.get("authorships") or []:
        if isinstance(auth, dict):
            author_obj = auth.get("author") or {}
            name = author_obj.get("display_name")
            if name:
                authors.append(str(name))
        if len(authors) >= 12:
            break

    venue: str | None = None
    primary_loc = work.get("primary_location") or {}
    if isinstance(primary_loc, dict):
        source = primary_loc.get("source") or {}
        if isinstance(source, dict) and source.get("display_name"):
            venue = str(source["display_name"])

    canonical_id = make_canonical_id(
        doi=doi,
        arxiv_id=arxiv_id,
        openalex_id=oa_id,
        title=title,
        year=year,
    )
    url = build_default_url(doi, arxiv_id, oa_id)

    return PaperNode(
        id=canonical_id,
        title=title,
        authors=authors,
        year=year,
        venue=venue,
        doi=doi,
        arxiv_id=arxiv_id,
        openalex_id=oa_id,
        url=url,
        is_seed=is_seed,
        is_expanded=is_expanded,
        expandable=True,
    )


def _title_similarity(a: str, b: str) -> float:
    ta = set(normalize_title(a).split())
    tb = set(normalize_title(b).split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


class PaperResolver:
    """Async OpenAlex + arXiv client with in-memory LRU caching and batching."""

    def __init__(
        self,
        client: httpx.AsyncClient | None = None,
        max_cache_size: int = 2000,
    ) -> None:
        self._external_client = client
        self._max_cache_size = max_cache_size
        self._work_cache: OrderedDict[str, dict] = OrderedDict()
        self._doi_cache: dict[str, str] = {}
        self._arxiv_cache: dict[str, str] = {}

    def _cache_work(self, work: dict) -> None:
        oa_id = normalize_openalex_id(work.get("id"))
        if not oa_id:
            return
        self._work_cache[oa_id] = work
        self._work_cache.move_to_end(oa_id)
        while len(self._work_cache) > self._max_cache_size:
            self._work_cache.popitem(last=False)

        doi = normalize_doi(work.get("doi"))
        if doi:
            self._doi_cache[doi] = oa_id
        arxiv_id = _extract_arxiv_from_work(work)
        if arxiv_id:
            self._arxiv_cache[arxiv_id] = oa_id

    def _get_client(self) -> tuple[httpx.AsyncClient, bool]:
        if self._external_client is not None:
            return self._external_client, False
        client = httpx.AsyncClient(
            timeout=15.0,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        )
        return client, True

    async def _get_json(
        self, client: httpx.AsyncClient, url: str, params: dict | None = None
    ) -> dict | None:
        for attempt in range(3):
            try:
                resp = await client.get(url, params=params)
                if resp.status_code == 200:
                    return resp.json()
                if resp.status_code == 404:
                    return None
                if resp.status_code in (429, 500, 502, 503, 504) and attempt < 2:
                    await asyncio.sleep(0.4 * (attempt + 1))
                    continue
                return None
            except httpx.HTTPError:
                if attempt < 2:
                    await asyncio.sleep(0.3 * (attempt + 1))
                    continue
                return None
        return None

    async def _fetch_arxiv_atom_fallback(
        self, client: httpx.AsyncClient, arxiv_id: str
    ) -> PaperNode | None:
        try:
            resp = await client.get(ARXIV_API, params={"id_list": arxiv_id})
            if resp.status_code != 200:
                return None
            root = ET.fromstring(resp.text)
            ns = {"atom": "http://www.w3.org/2005/Atom"}
            entry = root.find("atom:entry", ns)
            if entry is None:
                return None
            title_el = entry.find("atom:title", ns)
            title = (
                re.sub(r"\s+", " ", title_el.text).strip()
                if title_el is not None and title_el.text
                else ""
            )
            if not title or title.lower() == "error":
                return None
            authors = [
                a.findtext("atom:name", default="", namespaces=ns).strip()
                for a in entry.findall("atom:author", ns)
            ]
            authors = [a for a in authors if a]
            published = entry.findtext("atom:published", default="", namespaces=ns)
            year = int(published[:4]) if len(published) >= 4 and published[:4].isdigit() else None
            return PaperNode(
                id=make_canonical_id(arxiv_id=arxiv_id, title=title, year=year),
                title=title,
                authors=authors,
                year=year,
                venue="arXiv",
                arxiv_id=arxiv_id,
                url=f"https://arxiv.org/abs/{arxiv_id}",
                is_seed=True,
                is_expanded=False,
                expandable=True,
            )
        except Exception:
            return None

    async def fetch_work_by_identifier(
        self, raw_identifier: str
    ) -> tuple[dict | None, PaperNode | None, str | None]:
        """Resolve a DOI, arXiv ID, or OpenAlex ID.

        Returns (openalex_work_dict, fallback_node_if_no_openalex, warning_message).
        """
        classified = classify_identifier(raw_identifier)
        if not classified:
            return None, None, f"Unrecognized identifier format: '{raw_identifier}'."
        kind, value = classified

        # Cache lookup (only use cached entry if it has referenced_works populated)
        cached_oa_id: str | None = None
        if kind == "openalex":
            cached_oa_id = value
        elif kind == "doi":
            cached_oa_id = self._doi_cache.get(value)
        elif kind == "arxiv":
            cached_oa_id = self._arxiv_cache.get(value)

        if cached_oa_id and cached_oa_id in self._work_cache:
            cached = self._work_cache[cached_oa_id]
            if "referenced_works" in cached:
                return cached, None, None

        client, should_close = self._get_client()
        try:
            work: dict | None = None
            if kind == "openalex":
                work = await self._get_json(
                    client,
                    f"{OPENALEX_API}/works/{value}",
                    params={"select": WORK_SELECT_FIELDS},
                )
            elif kind == "doi":
                work = await self._get_json(
                    client,
                    f"{OPENALEX_API}/works/https://doi.org/{value}",
                    params={"select": WORK_SELECT_FIELDS},
                )
            elif kind == "arxiv":
                arxiv_doi = f"10.48550/arxiv.{value}"
                work = await self._get_json(
                    client,
                    f"{OPENALEX_API}/works/https://doi.org/{arxiv_doi}",
                    params={"select": WORK_SELECT_FIELDS},
                )
                if work is None:
                    # Fallback to arXiv Atom metadata
                    fallback = await self._fetch_arxiv_atom_fallback(client, value)
                    if fallback is not None:
                        return (
                            None,
                            fallback,
                            f"arXiv:{value} found on arXiv but not yet indexed in OpenAlex (references unavailable).",
                        )

            if work is not None:
                self._cache_work(work)
                return work, None, None
            return None, None, f"Could not find paper for identifier '{raw_identifier}'."
        finally:
            if should_close:
                await client.aclose()

    async def fetch_works_by_openalex_ids(
        self, openalex_ids: list[str]
    ) -> list[dict]:
        """Batch-fetch OpenAlex works by their OpenAlex IDs (50 per request)."""
        norm_ids: list[str] = []
        seen: set[str] = set()
        for raw_id in openalex_ids[:MAX_REFERENCES_PER_PAPER]:
            nid = normalize_openalex_id(raw_id)
            if nid and nid not in seen:
                seen.add(nid)
                norm_ids.append(nid)

        results: dict[str, dict] = {}
        missing: list[str] = []
        for nid in norm_ids:
            if nid in self._work_cache:
                results[nid] = self._work_cache[nid]
            else:
                missing.append(nid)

        if missing:
            client, should_close = self._get_client()
            try:
                for i in range(0, len(missing), BATCH_SIZE):
                    batch = missing[i : i + BATCH_SIZE]
                    filter_str = "openalex:" + "|".join(batch)
                    data = await self._get_json(
                        client,
                        f"{OPENALEX_API}/works",
                        params={
                            "filter": filter_str,
                            "per-page": len(batch),
                            "select": WORK_SELECT_FIELDS,
                        },
                    )
                    if data and isinstance(data.get("results"), list):
                        for work in data["results"]:
                            self._cache_work(work)
                            wid = normalize_openalex_id(work.get("id"))
                            if wid:
                                results[wid] = work
            finally:
                if should_close:
                    await client.aclose()

        return [results[nid] for nid in norm_ids if nid in results]

    async def fetch_works_by_dois(self, dois: list[str]) -> dict[str, dict]:
        """Batch-enrich a list of DOIs via OpenAlex (up to 50 per request)."""
        norm_dois: list[str] = []
        seen: set[str] = set()
        for d in dois:
            nd = normalize_doi(d)
            if nd and nd not in seen:
                seen.add(nd)
                norm_dois.append(nd)

        found: dict[str, dict] = {}
        missing: list[str] = []
        for nd in norm_dois:
            oa_id = self._doi_cache.get(nd)
            if oa_id and oa_id in self._work_cache:
                found[nd] = self._work_cache[oa_id]
            else:
                missing.append(nd)

        if missing:
            client, should_close = self._get_client()
            try:
                for i in range(0, len(missing), BATCH_SIZE):
                    batch = missing[i : i + BATCH_SIZE]
                    filter_str = "doi:" + "|".join(f"https://doi.org/{d}" for d in batch)
                    data = await self._get_json(
                        client,
                        f"{OPENALEX_API}/works",
                        params={
                            "filter": filter_str,
                            "per-page": len(batch),
                            "select": WORK_SELECT_FIELDS,
                        },
                    )
                    if data and isinstance(data.get("results"), list):
                        for work in data["results"]:
                            self._cache_work(work)
                            wdoi = normalize_doi(work.get("doi"))
                            if wdoi:
                                found[wdoi] = work
            finally:
                if should_close:
                    await client.aclose()

        return found

    async def resolve_by_title(
        self, title: str, year: int | None = None
    ) -> dict | None:
        """Resolve a local PDF reference to an OpenAlex work by title similarity."""
        cleaned = title.strip()
        if len(cleaned) < 8:
            return None

        client, should_close = self._get_client()
        try:
            data = await self._get_json(
                client,
                f"{OPENALEX_API}/works",
                params={
                    "search": cleaned,
                    "per-page": 5,
                    "select": WORK_SELECT_FIELDS,
                },
            )
            if not data or not isinstance(data.get("results"), list):
                return None

            best_work: dict | None = None
            best_score = 0.0
            for work in data["results"]:
                cand_title = work.get("title") or ""
                score = _title_similarity(cleaned, cand_title)
                cand_year = work.get("publication_year")
                if year is not None and isinstance(cand_year, int):
                    if abs(cand_year - year) > 1:
                        score -= 0.25
                if score > best_score:
                    best_score = score
                    best_work = work

            if best_work is not None and best_score >= 0.72:
                self._cache_work(best_work)
                return best_work
            return None
        finally:
            if should_close:
                await client.aclose()
