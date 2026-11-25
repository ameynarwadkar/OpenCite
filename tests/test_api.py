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


def test_bib_upload_endpoint():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        bib_content = b"""
        @inproceedings{vaswani2017attention,
          title = {Attention Is All You Need},
          author = {Vaswani, Ashish and Shazeer, Noam},
          booktitle = {NeurIPS},
          year = {2017},
          eprint = {1706.03762}
        }
        @article{local2023demo,
          title = {A Local BibTeX Entry Without DOI},
          author = {Jane Doe},
          journal = {Workshop},
          year = {2023}
        }
        """
        resp = client.post(
            "/api/papers/bib",
            files=[("files", ("myrefs.bib", bib_content, "text/plain"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 3
        assert len(data["edges"]) == 2
        ids = {n["id"] for n in data["nodes"]}
        assert "doi:10.48550/arxiv.1706.03762" in ids
    finally:
        app.dependency_overrides.clear()


def test_ris_upload_endpoint():
    resolver = _make_mock_resolver()
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        ris_content = b"""TY  - CONF
TI  - Attention Is All You Need
AU  - Vaswani, Ashish
AU  - Shazeer, Noam
PY  - 2017/12/04
JO  - NeurIPS
DO  - 10.48550/arxiv.1706.03762
ER  -

TY  - JOUR
TI  - Local RIS Paper With Abstract
AU  - Doe, Jane
PY  - 2024
JO  - Journal of Testing
AB  - This abstract is stored directly inside the RIS record.
ER  -
"""
        resp = client.post(
            "/api/papers/ris",
            files=[("files", ("library.ris", ris_content, "application/x-research-info-systems"))],
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["nodes"]) == 3
        assert len(data["edges"]) == 2
        ids = {n["id"] for n in data["nodes"]}
        assert "doi:10.48550/arxiv.1706.03762" in ids
        local_node = next(n for n in data["nodes"] if n["title"] == "Local RIS Paper With Abstract")
        assert local_node["year"] == 2024
        assert local_node["abstract"] == "This abstract is stored directly inside the RIS record."
    finally:
        app.dependency_overrides.clear()


def test_offline_mode_makes_zero_external_http_calls():
    def fail_on_any_request(request: httpx.Request) -> httpx.Response:
        raise AssertionError(f"Unexpected outbound HTTP call in offline mode: {request.url}")

    resolver = PaperResolver(
        client=httpx.AsyncClient(transport=httpx.MockTransport(fail_on_any_request))
    )
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)

        # 1. PDF upload with offline=true
        pdf_bytes = _make_sample_pdf_bytes()
        pdf_resp = client.post(
            "/api/papers/pdf?offline=true",
            files=[("files", ("paper.pdf", pdf_bytes, "application/pdf"))],
        )
        assert pdf_resp.status_code == 200
        assert len(pdf_resp.json()["nodes"]) >= 1

        # 2. BibTeX upload with offline=true
        bib_content = b"""
        @article{offline2024,
          title = {Offline BibTeX Paper},
          author = {Alice Smith},
          year = {2024},
          doi = {10.48550/arxiv.1706.03762}
        }
        """
        bib_resp = client.post(
            "/api/papers/bib?offline=true",
            files=[("files", ("offline.bib", bib_content, "text/plain"))],
        )
        assert bib_resp.status_code == 200
        assert len(bib_resp.json()["nodes"]) == 2

        # 3. RIS upload with offline=true
        ris_content = b"""TY  - JOUR
TI  - Offline RIS Paper
AU  - Smith, Alice
PY  - 2024
DO  - 10.48550/arxiv.1706.03762
ER  -
"""
        ris_resp = client.post(
            "/api/papers/ris?offline=true",
            files=[("files", ("offline.ris", ris_content, "text/plain"))],
        )
        assert ris_resp.status_code == 200
        assert len(ris_resp.json()["nodes"]) == 2
    finally:
        app.dependency_overrides.clear()


def test_healthz_and_upload_limits():
    client = TestClient(app)
    health = client.get("/healthz")
    assert health.status_code == 200
    assert health.json() == {"status": "ok"}

    too_many = [
        ("files", (f"f{i}.ris", b"TY  - JOUR\nTI  - Test\nER  -\n", "text/plain"))
        for i in range(6)
    ]
    resp = client.post("/api/papers/ris?offline=true", files=too_many)
    assert resp.status_code == 400
    assert "at most 5" in resp.json()["detail"].lower()


def test_semantic_scholar_fallback_for_expand_and_cited_by():
    def s2_only_handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if request.url.host == "api.semanticscholar.org":
            if "/references" in url:
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {
                                "citedPaper": {
                                    "title": "S2 Fallback Reference Paper",
                                    "year": 2020,
                                    "venue": "ICLR",
                                    "authors": [{"name": "Ada Lovelace"}],
                                    "citationCount": 420,
                                    "externalIds": {"DOI": "10.1000/s2-ref"},
                                }
                            }
                        ]
                    },
                )
            if "/citations" in url:
                return httpx.Response(
                    200,
                    json={
                        "data": [
                            {
                                "citingPaper": {
                                    "title": "S2 Fallback Citing Paper",
                                    "year": 2025,
                                    "venue": "NeurIPS",
                                    "authors": [{"name": "Grace Hopper"}],
                                    "citationCount": 12,
                                    "externalIds": {"ArXiv": "2501.00001"},
                                }
                            }
                        ]
                    },
                )
        return httpx.Response(404, json={"error": "not found"})

    resolver = PaperResolver(
        client=httpx.AsyncClient(transport=httpx.MockTransport(s2_only_handler))
    )
    app.dependency_overrides[get_resolver] = lambda: resolver
    try:
        client = TestClient(app)
        exp = client.post(
            "/api/papers/expand",
            json={
                "node": {
                    "id": "doi:10.1000/not-in-openalex",
                    "doi": "10.1000/not-in-openalex",
                    "title": "Niche Paper Missing From OpenAlex",
                }
            },
        )
        assert exp.status_code == 200
        exp_data = exp.json()
        assert len(exp_data["edges"]) == 1
        assert any(n["id"] == "doi:10.1000/s2-ref" for n in exp_data["nodes"])
        assert any("Semantic Scholar" in w for w in exp_data["warnings"])

        cb = client.post(
            "/api/papers/cited-by",
            json={
                "node": {
                    "id": "doi:10.1000/not-in-openalex",
                    "doi": "10.1000/not-in-openalex",
                    "title": "Niche Paper Missing From OpenAlex",
                },
                "limit": 10,
            },
        )
        assert cb.status_code == 200
        cb_data = cb.json()
        assert len(cb_data["edges"]) == 1
        assert cb_data["edges"][0]["source"] == "arxiv:2501.00001"
        assert cb_data["edges"][0]["target"] == "doi:10.1000/not-in-openalex"
        assert any("Semantic Scholar" in w for w in cb_data["warnings"])
    finally:
        app.dependency_overrides.clear()


def test_api_rate_limiting(monkeypatch):
    import backend.main as main_mod

    main_mod.reset_rate_limiter()
    monkeypatch.setattr(main_mod, "RATE_LIMIT_REQUESTS", 2)
    monkeypatch.setattr(main_mod, "RATE_LIMIT_WINDOW_SECONDS", 60)
    try:
        client = TestClient(app)
        ris_bytes = b"TY  - JOUR\nTI  - Rate Limit Test\nER  -\n"
        r1 = client.post(
            "/api/papers/ris?offline=true",
            files=[("files", ("a.ris", ris_bytes, "text/plain"))],
            headers={"X-Forwarded-For": "203.0.113.9"},
        )
        r2 = client.post(
            "/api/papers/ris?offline=true",
            files=[("files", ("a.ris", ris_bytes, "text/plain"))],
            headers={"X-Forwarded-For": "203.0.113.9"},
        )
        r3 = client.post(
            "/api/papers/ris?offline=true",
            files=[("files", ("a.ris", ris_bytes, "text/plain"))],
            headers={"X-Forwarded-For": "203.0.113.9"},
        )
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r3.status_code == 429
        assert "Retry-After" in r3.headers
        # /healthz is exempt from API rate limiting
        assert client.get("/healthz", headers={"X-Forwarded-For": "203.0.113.9"}).status_code == 200
    finally:
        main_mod.reset_rate_limiter()


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
