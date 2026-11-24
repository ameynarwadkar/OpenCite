from __future__ import annotations

import asyncio
from pathlib import Path

from fastapi import Depends, FastAPI, File, HTTPException, UploadFile
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from backend.graph_builder import GraphBuilder, normalize_openalex_id
from backend.models import (
    CitationEdge,
    CrossCitationsRequest,
    CrossCitationsResponse,
    EnrichNodeInput,
    EnrichRequest,
    EnrichResponse,
    EnrichUpdate,
    ExpandRequest,
    ExpandResponse,
    GraphPayload,
    LookupRequest,
    PaperNode,
)
from backend.pdf_parser import PDFParseError, ParsedPdfPaper, parse_pdf_bytes
from backend.resolver import (
    MAX_REFERENCES_PER_PAPER,
    PaperResolver,
    openalex_work_to_node,
)

ROOT_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIST_DIR = ROOT_DIR / "frontend" / "dist"
STATIC_DIR = ROOT_DIR / "static"

app = FastAPI(title="Minimal Citation Graph", version="0.2.0")
_default_resolver = PaperResolver()


def get_resolver() -> PaperResolver:
    return _default_resolver


if (FRONTEND_DIST_DIR / "assets").exists():
    app.mount(
        "/assets",
        StaticFiles(directory=str(FRONTEND_DIST_DIR / "assets")),
        name="assets",
    )
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    dist_index = FRONTEND_DIST_DIR / "index.html"
    if dist_index.exists():
        return FileResponse(dist_index)
    index_path = STATIC_DIR / "index.html"
    if not index_path.exists():
        raise HTTPException(status_code=404, detail="Frontend index.html not found.")
    return FileResponse(index_path)


def _lookup_key_for_doi_enrichment(doi: str | None, arxiv_id: str | None) -> str | None:
    if doi:
        return doi
    if arxiv_id:
        return f"10.48550/arxiv.{arxiv_id}"
    return None


@app.post("/api/papers/pdf", response_model=GraphPayload)
async def ingest_pdfs(
    files: list[UploadFile] = File(...),
    resolver: PaperResolver = Depends(get_resolver),
) -> GraphPayload:
    if not files:
        raise HTTPException(status_code=400, detail="Please upload at least one PDF file.")

    parsed_papers: list[ParsedPdfPaper] = []
    warnings: list[str] = []
    errors: list[str] = []

    for upload in files:
        filename = upload.filename or "paper.pdf"
        content = await upload.read()
        try:
            parsed = parse_pdf_bytes(content, filename=filename)
            parsed_papers.append(parsed)
            warnings.extend(parsed.warnings)
        except PDFParseError as exc:
            errors.append(str(exc))

    if not parsed_papers:
        raise HTTPException(status_code=422, detail=" ".join(errors))
    warnings.extend(errors)

    # Batch-enrich any seeds or references that carry a DOI or arXiv ID
    dois_to_enrich: list[str] = []
    for paper in parsed_papers:
        if key := _lookup_key_for_doi_enrichment(paper.doi, paper.arxiv_id):
            dois_to_enrich.append(key)
        for ref in paper.references:
            if key := _lookup_key_for_doi_enrichment(ref.doi, ref.arxiv_id):
                dois_to_enrich.append(key)

    enriched_by_doi = (
        await resolver.fetch_works_by_dois(dois_to_enrich) if dois_to_enrich else {}
    )

    gb = GraphBuilder()
    for paper in parsed_papers:
        seed_key = _lookup_key_for_doi_enrichment(paper.doi, paper.arxiv_id)
        if seed_key and seed_key in enriched_by_doi:
            seed_node = openalex_work_to_node(
                enriched_by_doi[seed_key], is_seed=True, is_expanded=True
            )
            if not seed_node.abstract and paper.abstract:
                seed_node = seed_node.model_copy(update={"abstract": paper.abstract})
        else:
            seed_node = PaperNode(
                id="tmp",
                title=paper.title,
                authors=paper.authors,
                year=paper.year,
                doi=paper.doi,
                arxiv_id=paper.arxiv_id,
                abstract=paper.abstract,
                is_seed=True,
                is_expanded=True,
            )
        seed_id = gb.add_node(seed_node)

        for ref in paper.references:
            ref_key = _lookup_key_for_doi_enrichment(ref.doi, ref.arxiv_id)
            if ref_key and ref_key in enriched_by_doi:
                ref_node = openalex_work_to_node(
                    enriched_by_doi[ref_key], is_seed=False, is_expanded=False
                ).model_copy(update={"raw_citation": ref.raw})
            else:
                ref_node = PaperNode(
                    id="tmp",
                    title=ref.title,
                    authors=ref.authors,
                    year=ref.year,
                    doi=ref.doi,
                    arxiv_id=ref.arxiv_id,
                    raw_citation=ref.raw,
                    is_seed=False,
                    is_expanded=False,
                )
            ref_id = gb.add_node(ref_node)
            gb.add_edge(seed_id, ref_id)

    return gb.build(warnings=warnings)


@app.post("/api/papers/lookup", response_model=GraphPayload)
async def lookup_papers(
    payload: LookupRequest,
    resolver: PaperResolver = Depends(get_resolver),
) -> GraphPayload:
    identifiers = [i.strip() for i in payload.identifiers if i and i.strip()]
    if not identifiers:
        raise HTTPException(
            status_code=400, detail="Please provide at least one DOI, arXiv ID, or OpenAlex ID."
        )

    gb = GraphBuilder()
    warnings: list[str] = []

    for raw_id in identifiers:
        work, fallback_node, warning = await resolver.fetch_work_by_identifier(raw_id)
        if warning:
            warnings.append(warning)
        if fallback_node is not None:
            gb.add_node(fallback_node)
            continue
        if work is None:
            continue

        seed_node = openalex_work_to_node(work, is_seed=True, is_expanded=True)
        seed_id = gb.add_node(seed_node)

        ref_oa_ids = work.get("referenced_works") or []
        if len(ref_oa_ids) > MAX_REFERENCES_PER_PAPER:
            warnings.append(
                f"'{seed_node.title}' has {len(ref_oa_ids)} references; showing first {MAX_REFERENCES_PER_PAPER}."
            )
        ref_works = await resolver.fetch_works_by_openalex_ids(ref_oa_ids)
        for ref_work in ref_works:
            ref_node = openalex_work_to_node(ref_work, is_seed=False, is_expanded=False)
            ref_id = gb.add_node(ref_node)
            gb.add_edge(seed_id, ref_id)

    return gb.build(warnings=warnings)


@app.post("/api/papers/expand", response_model=ExpandResponse)
async def expand_paper(
    payload: ExpandRequest,
    resolver: PaperResolver = Depends(get_resolver),
) -> ExpandResponse:
    node = payload.node
    work: dict | None = None
    warnings: list[str] = []

    for candidate in (node.openalex_id, node.doi, node.arxiv_id):
        if candidate:
            work, _, _ = await resolver.fetch_work_by_identifier(candidate)
            if work is not None:
                break

    if work is None and node.title:
        work = await resolver.resolve_by_title(node.title, year=node.year)

    if work is None:
        return ExpandResponse(
            source_id=node.id,
            nodes=[],
            edges=[],
            warnings=[
                f"Could not match '{node.title or node.id}' in OpenAlex to expand its citations."
            ],
        )

    gb = GraphBuilder()
    source_node = openalex_work_to_node(work, is_seed=False, is_expanded=True)
    source_id = gb.add_node(source_node)

    ref_oa_ids = work.get("referenced_works") or []
    if not ref_oa_ids:
        warnings.append(f"No outgoing references indexed in OpenAlex for '{source_node.title}'.")
    elif len(ref_oa_ids) > MAX_REFERENCES_PER_PAPER:
        warnings.append(
            f"'{source_node.title}' has {len(ref_oa_ids)} references; showing first {MAX_REFERENCES_PER_PAPER}."
        )

    ref_works = await resolver.fetch_works_by_openalex_ids(ref_oa_ids)
    for ref_work in ref_works:
        ref_node = openalex_work_to_node(ref_work, is_seed=False, is_expanded=False)
        ref_id = gb.add_node(ref_node)
        gb.add_edge(source_id, ref_id)

    built = gb.build(warnings=warnings)
    return ExpandResponse(
        source_id=source_id,
        nodes=built.nodes,
        edges=built.edges,
        warnings=built.warnings,
    )


@app.post("/api/papers/cited-by", response_model=ExpandResponse)
async def expand_cited_by(
    payload: ExpandRequest,
    resolver: PaperResolver = Depends(get_resolver),
) -> ExpandResponse:
    """Fetch top forward-citing papers (newer papers that cite the selected paper)."""
    node = payload.node
    work: dict | None = None
    warnings: list[str] = []

    for candidate in (node.openalex_id, node.doi, node.arxiv_id):
        if candidate:
            work, _, _ = await resolver.fetch_work_by_identifier(candidate)
            if work is not None:
                break

    if work is None and node.title:
        work = await resolver.resolve_by_title(node.title, year=node.year)

    if work is None:
        return ExpandResponse(
            source_id=node.id,
            nodes=[],
            edges=[],
            warnings=[
                f"Could not match '{node.title or node.id}' in OpenAlex to fetch forward citations."
            ],
        )

    gb = GraphBuilder()
    target_node = openalex_work_to_node(
        work, is_seed=False, is_expanded=False
    ).model_copy(update={"is_cited_by_expanded": True})
    target_id = gb.add_node(target_node)

    limit = max(1, min(payload.limit, 50))
    citing_works = (
        await resolver.fetch_citing_works(target_node.openalex_id, limit=limit)
        if target_node.openalex_id
        else []
    )
    if not citing_works:
        warnings.append(
            f"No forward citations indexed in OpenAlex for '{target_node.title}'."
        )
    elif (
        target_node.cited_by_count is not None
        and target_node.cited_by_count > len(citing_works)
    ):
        warnings.append(
            f"Showing top {len(citing_works)} most-cited papers out of {target_node.cited_by_count:,} citing '{target_node.title}'."
        )

    for citing_work in citing_works:
        citing_node = openalex_work_to_node(citing_work, is_seed=False, is_expanded=False)
        citing_id = gb.add_node(citing_node)
        gb.add_edge(citing_id, target_id)

    built = gb.build(warnings=warnings)
    return ExpandResponse(
        source_id=target_id,
        nodes=built.nodes,
        edges=built.edges,
        warnings=built.warnings,
    )


@app.post("/api/papers/enrich", response_model=EnrichResponse)
async def enrich_papers(
    payload: EnrichRequest,
    resolver: PaperResolver = Depends(get_resolver),
) -> EnrichResponse:
    """Resolve missing publication years & metadata for undated nodes via OpenAlex + Crossref."""
    max_batch = 40
    targets = payload.nodes[:max_batch]
    warnings: list[str] = []
    if len(payload.nodes) > max_batch:
        warnings.append(
            f"Resolving first {max_batch} of {len(payload.nodes)} undated papers."
        )

    sem = asyncio.Semaphore(5)

    async def _resolve_one(item):
        async with sem:
            enriched = await resolver.enrich_node(
                title=item.title,
                year=item.year,
                doi=item.doi,
                arxiv_id=item.arxiv_id,
                openalex_id=item.openalex_id,
                raw_citation=item.raw_citation,
            )
            return item.id, enriched

    results = await asyncio.gather(*(_resolve_one(n) for n in targets))
    updates: list[EnrichUpdate] = []
    unresolved = 0
    for old_id, enriched in results:
        if enriched is not None and enriched.year is not None:
            updates.append(EnrichUpdate(old_id=old_id, node=enriched))
        else:
            unresolved += 1

    return EnrichResponse(
        updates=updates,
        unresolved_count=unresolved,
        warnings=warnings,
    )


@app.post("/api/papers/cross-citations", response_model=CrossCitationsResponse)
async def find_cross_citations(
    payload: CrossCitationsRequest,
    resolver: PaperResolver = Depends(get_resolver),
) -> CrossCitationsResponse:
    """Discover citation edges between papers already in the graph via batched OpenAlex queries."""
    nodes = payload.nodes[:200]
    warnings: list[str] = []
    if len(payload.nodes) > 200:
        warnings.append("Checking cross-citations for the first 200 papers.")

    oa_to_node_id: dict[str, str] = {}
    updates: list[EnrichUpdate] = []
    dois_to_fetch: dict[str, str] = {}
    unmatched_for_title: list = []

    for item in nodes:
        if item.openalex_id:
            norm_oa = normalize_openalex_id(item.openalex_id)
            if norm_oa:
                oa_to_node_id[norm_oa] = item.id
                continue
        doi_key = _lookup_key_for_doi_enrichment(item.doi, item.arxiv_id)
        if doi_key:
            dois_to_fetch[doi_key] = item.id
        elif item.title:
            unmatched_for_title.append(item)

    if dois_to_fetch:
        enriched_by_doi = await resolver.fetch_works_by_dois(list(dois_to_fetch.keys()))
        for doi_key, work in enriched_by_doi.items():
            old_id = dois_to_fetch[doi_key]
            node = openalex_work_to_node(work, is_seed=False, is_expanded=False)
            if node.openalex_id:
                oa_to_node_id[node.openalex_id] = old_id
                updates.append(EnrichUpdate(old_id=old_id, node=node))

    if unmatched_for_title:
        sem = asyncio.Semaphore(6)

        async def _resolve_title(item):
            async with sem:
                work = await resolver.resolve_by_title(item.title or "", year=item.year)
                return item, work

        title_results = await asyncio.gather(
            *(_resolve_title(it) for it in unmatched_for_title[:25])
        )
        for item, work in title_results:
            if work is None:
                continue
            node = openalex_work_to_node(work, is_seed=False, is_expanded=False)
            if item.raw_citation:
                node = node.model_copy(update={"raw_citation": item.raw_citation})
            if node.openalex_id:
                oa_to_node_id[node.openalex_id] = item.id
                updates.append(EnrichUpdate(old_id=item.id, node=node))

    all_oa_ids = list(oa_to_node_id.keys())
    if len(all_oa_ids) < 2:
        return CrossCitationsResponse(
            edges=[],
            updates=updates,
            warnings=["Not enough OpenAlex-linked papers to check cross-citations."],
        )

    works = await resolver.fetch_works_by_openalex_ids(all_oa_ids)
    final_id_map: dict[str, str] = {upd.old_id: upd.node.id for upd in updates}

    edge_set: set[tuple[str, str]] = set()
    for work in works:
        src_oa = normalize_openalex_id(work.get("id"))
        if not src_oa or src_oa not in oa_to_node_id:
            continue
        src_id = final_id_map.get(oa_to_node_id[src_oa], oa_to_node_id[src_oa])
        for raw_ref in work.get("referenced_works") or []:
            ref_oa = normalize_openalex_id(raw_ref)
            if ref_oa and ref_oa in oa_to_node_id:
                dst_id = final_id_map.get(oa_to_node_id[ref_oa], oa_to_node_id[ref_oa])
                if src_id != dst_id:
                    edge_set.add((src_id, dst_id))

    edges = [CitationEdge(source=s, target=t) for s, t in sorted(edge_set)]
    return CrossCitationsResponse(edges=edges, updates=updates, warnings=warnings)


@app.post("/api/papers/details", response_model=EnrichUpdate | None)
async def fetch_paper_details_route(
    node: EnrichNodeInput,
    resolver: PaperResolver = Depends(get_resolver),
) -> EnrichUpdate | None:
    """On-demand detail lookup (abstract, topics, global citations) for a clicked paper."""
    enriched = await resolver.fetch_paper_details(
        title=node.title,
        year=node.year,
        doi=node.doi,
        arxiv_id=node.arxiv_id,
        openalex_id=node.openalex_id,
        raw_citation=node.raw_citation,
    )
    if enriched is None:
        return None
    return EnrichUpdate(old_id=node.id, node=enriched)
