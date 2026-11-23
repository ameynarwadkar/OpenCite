import httpx
import pymupdf
from fastapi.testclient import TestClient

from backend.main import app, get_resolver
from backend.resolver import PaperResolver


def _make_mock_resolver() -> PaperResolver:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        filter_param = request.url.params.get("filter", "")
        if (
            "/works/https://doi.org/10.48550/arxiv.1706.03762" in url
            or "/works/W2963403868" in url
        ):
            return httpx.Response(
                200,
                json={
                    "id": "https://openalex.org/W2963403868",
                    "doi": "https://doi.org/10.48550/arXiv.1706.03762",
                    "title": "Attention Is All You Need",
                    "publication_year": 2017,
                    "authorships": [{"author": {"display_name": "Ashish Vaswani"}}],
                    "referenced_works": ["https://openalex.org/W100"],
                },
            )
        if "/works/W100" in url:
            return httpx.Response(
                200,
                json={
                    "id": "https://openalex.org/W100",
                    "title": "Neural Machine Translation",
                    "publication_year": 2015,
                    "referenced_works": ["https://openalex.org/W200"],
                },
            )
        if filter_param.startswith("cites:W2963403868"):
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": "https://openalex.org/W500",
                            "doi": "https://doi.org/10.48550/arXiv.1810.04805",
                            "title": "BERT: Pre-training of Deep Bidirectional Transformers",
                            "publication_year": 2019,
                            "cited_by_count": 90000,
                        }
                    ]
                },
            )
        if filter_param.startswith("openalex:"):
            ids = filter_param.split("openalex:", 1)[1].split("|")
            results = []
            if "W100" in ids:
                results.append(
                    {
                        "id": "https://openalex.org/W100",
                        "title": "Neural Machine Translation",
                        "publication_year": 2015,
                        "referenced_works": ["https://openalex.org/W200"],
                    }
                )
            if "W200" in ids:
                results.append(
                    {
                        "id": "https://openalex.org/W200",
                        "title": "Sequence to Sequence Learning",
                        "publication_year": 2014,
                        "referenced_works": [],
                    }
                )
            return httpx.Response(200, json={"results": results})
        if filter_param.startswith("doi:"):
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": "https://openalex.org/W2963403868",
                            "doi": "https://doi.org/10.48550/arXiv.1706.03762",
                            "title": "Attention Is All You Need",
                            "publication_year": 2017,
                        }
                    ]
                },
            )
        if request.url.host == "api.crossref.org":
            return httpx.Response(
                200,
                json={
                    "message": {
                        "items": [
                            {
                                "DOI": "10.1000/crossref-hit",
                                "title": ["Undated Conference Paper on Retrieval"],
                                "published-print": {"date-parts": [[2021]]},
                                "author": [{"given": "Jane", "family": "Doe"}],
                                "container-title": ["EMNLP"],
                            }
                        ]
                    }
                },
            )
        return httpx.Response(404, json={"error": "not found"})

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return PaperResolver(client=client)


def _make_sample_pdf_bytes() -> bytes:
    doc = pymupdf.open()
    page = doc.new_page()
    page.insert_text((72, 80), "My Custom Paper", fontsize=18)
    page.insert_text((72, 120), "Published 2024.", fontsize=10)
    page.insert_text((72, 180), "References", fontsize=13)
    page.insert_text(
        (72, 205),
        "[1] A. Vaswani. \"Attention Is All You Need.\" NeurIPS, 2017. arXiv:1706.03762",
        fontsize=10,
    )
    page.insert_text(
        (72, 225),
        "[2] J. Doe. \"Some Local Unindexed Paper.\" Workshop, 2021.",
        fontsize=10,
    )
    data = doc.tobytes()
    doc.close()
    return data


def test_lookup_and_expand_endpoints():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        resp = client.post("/api/papers/lookup", json={"identifiers": ["1706.03762"]})
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 2
        assert len(data["edges"]) == 1
        assert data["edges"][0]["source"] == "doi:10.48550/arxiv.1706.03762"
        assert data["edges"][0]["target"] == "openalex:W100"

        exp_resp = client.post(
            "/api/papers/expand",
            json={"node": {"id": "openalex:W100", "openalex_id": "W100", "title": "Neural Machine Translation"}},
        )
        assert exp_resp.status_code == 200
        exp_data = exp_resp.json()
        assert exp_data["source_id"] == "openalex:W100"
        assert {n["id"] for n in exp_data["nodes"]} == {"openalex:W100", "openalex:W200"}
        assert len(exp_data["edges"]) == 1
    finally:
        app.dependency_overrides.clear()


def test_pdf_upload_endpoint_and_invalid_pdf():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        pdf_bytes = _make_sample_pdf_bytes()
        resp = client.post(
            "/api/papers/pdf",
            files=[("files", ("custom.pdf", pdf_bytes, "application/pdf"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 3
        assert len(data["edges"]) == 2
        ids = {n["id"] for n in data["nodes"]}
        assert "doi:10.48550/arxiv.1706.03762" in ids

        bad = client.post(
            "/api/papers/pdf",
            files=[("files", ("broken.pdf", b"not a pdf", "application/pdf"))],
        )
        assert bad.status_code == 422
    finally:
        app.dependency_overrides.clear()


def test_enrich_endpoint_uses_crossref_fallback():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/papers/enrich",
            json={
                "nodes": [
                    {
                        "id": "local:abc123",
                        "title": "Undated Conference Paper on Retrieval",
                        "year": None,
                        "raw_citation": "Doe, J. Undated Conference Paper on Retrieval. EMNLP.",
                    }
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["unresolved_count"] == 0
        assert len(data["updates"]) == 1
        upd = data["updates"][0]
        assert upd["old_id"] == "local:abc123"
        assert upd["node"]["year"] == 2021
        assert upd["node"]["doi"] == "10.1000/crossref-hit"
    finally:
        app.dependency_overrides.clear()


def test_cited_by_endpoint_returns_forward_citations():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/papers/cited-by",
            json={
                "node": {
                    "id": "doi:10.48550/arxiv.1706.03762",
                    "openalex_id": "W2963403868",
                    "title": "Attention Is All You Need",
                },
                "limit": 10,
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert data["source_id"] == "doi:10.48550/arxiv.1706.03762"
        assert len(data["edges"]) == 1
        # Forward citation edge points FROM citing paper TO target paper
        assert data["edges"][0]["source"] == "doi:10.48550/arxiv.1810.04805"
        assert data["edges"][0]["target"] == "doi:10.48550/arxiv.1706.03762"
        target_node = next(n for n in data["nodes"] if n["id"] == data["source_id"])
        assert target_node["is_cited_by_expanded"] is True
    finally:
        app.dependency_overrides.clear()


def test_cross_citations_endpoint_connects_references():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        resp = client.post(
            "/api/papers/cross-citations",
            json={
                "nodes": [
                    {"id": "openalex:W100", "openalex_id": "W100", "title": "Neural Machine Translation"},
                    {"id": "openalex:W200", "openalex_id": "W200", "title": "Sequence to Sequence Learning"},
                ]
            },
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["edges"]) == 1
        assert data["edges"][0]["source"] == "openalex:W100"
        assert data["edges"][0]["target"] == "openalex:W200"
    finally:
        app.dependency_overrides.clear()


def test_serves_frontend_index_and_static_assets():
    client = TestClient(app)
    index_resp = client.get("/")
    assert index_resp.status_code == 200
    assert "Citation Graph" in index_resp.text
    assert 'value="timeline"' in index_resp.text
    assert 'id="theme-toggle"' in index_resp.text
    assert 'id="history-list"' in index_resp.text

    js_resp = client.get("/static/app.js")
    assert js_resp.status_code == 200
    assert "applyTimelineLayout" in js_resp.text
    assert "applyTheme" in js_resp.text
    assert "saveCurrentToHistory" in js_resp.text
