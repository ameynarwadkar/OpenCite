import json

import httpx
import pytest

from backend.resolver import (
    PaperResolver,
    classify_identifier,
    openalex_work_to_node,
    reconstruct_abstract,
)


def test_classify_identifier():
    assert classify_identifier("1706.03762") == ("arxiv", "1706.03762")
    assert classify_identifier("https://arxiv.org/abs/1706.03762v7") == ("arxiv", "1706.03762")
    assert classify_identifier("10.1145/3292500.3330919") == ("doi", "10.1145/3292500.3330919")
    assert classify_identifier("https://doi.org/10.1145/3292500.3330919") == ("doi", "10.1145/3292500.3330919")
    assert classify_identifier("https://openalex.org/W2963403868") == ("openalex", "W2963403868")
    assert classify_identifier("not-an-id") is None


def test_reconstruct_abstract_and_topics():
    inv = {"Attention": [0], "is": [1], "all": [2], "you": [3], "need.": [4]}
    assert reconstruct_abstract(inv) == "Attention is all you need."
    assert reconstruct_abstract(None) is None

    work = {
        "id": "https://openalex.org/W2963403868",
        "title": "Attention Is All You Need",
        "publication_year": 2017,
        "abstract_inverted_index": inv,
        "topics": [
            {"display_name": "Natural Language Processing"},
            {"display_name": "Machine Translation"},
        ],
    }
    node = openalex_work_to_node(work)
    assert node.abstract == "Attention is all you need."
    assert node.topics == ["Natural Language Processing", "Machine Translation"]
    assert node.is_retracted is False

    retracted_work = {**work, "is_retracted": True}
    retracted_node = openalex_work_to_node(retracted_work)
    assert retracted_node.is_retracted is True


def test_openalex_work_to_node():
    work = {
        "id": "https://openalex.org/W2963403868",
        "doi": "https://doi.org/10.48550/arXiv.1706.03762",
        "title": "Attention Is All You Need",
        "publication_year": 2017,
        "authorships": [
            {"author": {"display_name": "Ashish Vaswani"}},
            {"author": {"display_name": "Noam Shazeer"}},
        ],
        "primary_location": {"source": {"display_name": "NeurIPS"}},
    }
    node = openalex_work_to_node(work, is_seed=True)
    assert node.id == "doi:10.48550/arxiv.1706.03762"
    assert node.arxiv_id == "1706.03762"
    assert node.openalex_id == "W2963403868"
    assert node.venue == "NeurIPS"
    assert node.year == 2017
    assert node.is_seed is True


@pytest.mark.asyncio
async def test_resolver_lookup_batch_and_title_search():
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        if "/works/https://doi.org/10.48550/arxiv.1706.03762" in url:
            return httpx.Response(
                200,
                json={
                    "id": "https://openalex.org/W2963403868",
                    "doi": "https://doi.org/10.48550/arXiv.1706.03762",
                    "title": "Attention Is All You Need",
                    "publication_year": 2017,
                    "referenced_works": ["https://openalex.org/W100", "https://openalex.org/W200"],
                },
            )
        if request.url.params.get("filter", "").startswith("openalex:"):
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": "https://openalex.org/W100",
                            "title": "Neural Machine Translation",
                            "publication_year": 2015,
                        },
                        {
                            "id": "https://openalex.org/W200",
                            "title": "Sequence to Sequence Learning",
                            "publication_year": 2014,
                        },
                    ]
                },
            )
        if request.url.params.get("search") == "Deep Learning":
            return httpx.Response(
                200,
                json={
                    "results": [
                        {
                            "id": "https://openalex.org/W300",
                            "title": "Deep Learning",
                            "publication_year": 2015,
                        }
                    ]
                },
            )
        return httpx.Response(404, text=json.dumps({"error": "not found"}))

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        resolver = PaperResolver(client=client)
        work, fallback, warning = await resolver.fetch_work_by_identifier("1706.03762")
        assert warning is None
        assert fallback is None
        assert work is not None
        assert work["title"] == "Attention Is All You Need"

        refs = await resolver.fetch_works_by_openalex_ids(work["referenced_works"])
        assert len(refs) == 2
        assert {r["title"] for r in refs} == {
            "Neural Machine Translation",
            "Sequence to Sequence Learning",
        }

        matched = await resolver.resolve_by_title("Deep Learning", year=2015)
        assert matched is not None
        assert matched["id"] == "https://openalex.org/W300"
