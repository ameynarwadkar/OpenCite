from backend.graph_builder import (
    GraphBuilder,
    make_canonical_id,
    normalize_arxiv_id,
    normalize_doi,
    normalize_openalex_id,
)
from backend.models import PaperNode


def test_normalizers():
    assert normalize_doi("https://doi.org/10.1145/3292500.3330919.") == "10.1145/3292500.3330919"
    assert normalize_doi("DOI: 10.48550/arXiv.1706.03762") == "10.48550/arxiv.1706.03762"
    assert normalize_arxiv_id("https://arxiv.org/abs/1706.03762v7") == "1706.03762"
    assert normalize_arxiv_id("arXiv:2301.07041v1") == "2301.07041"
    assert normalize_openalex_id("https://openalex.org/W2963403868") == "W2963403868"


def test_canonical_id_priority():
    assert make_canonical_id(doi="10.1000/abc", arxiv_id="1706.03762", openalex_id="W123") == "doi:10.1000/abc"
    assert make_canonical_id(arxiv_id="1706.03762v2", openalex_id="W123") == "arxiv:1706.03762"
    assert make_canonical_id(openalex_id="https://openalex.org/W123") == "openalex:W123"
    local_id = make_canonical_id(title="Attention Is All You Need", year=2017)
    assert local_id.startswith("local:")
    assert local_id == make_canonical_id(title="Attention is all you need!", year=2017)


def test_deduplication_by_title_and_upgrade_to_doi():
    gb = GraphBuilder()
    seed1 = gb.add_node(PaperNode(id="tmp", title="Paper One", year=2023, is_seed=True))
    ref1 = gb.add_node(
        PaperNode(
            id="tmp",
            title="Attention Is All You Need",
            year=2017,
            raw_citation="Vaswani et al. Attention Is All You Need. 2017.",
        )
    )
    gb.add_edge(seed1, ref1)
    assert ref1.startswith("local:")

    seed2 = gb.add_node(PaperNode(id="tmp", title="Paper Two", year=2024, is_seed=True))
    ref2 = gb.add_node(
        PaperNode(
            id="tmp",
            title="Attention Is All You Need",
            authors=["Ashish Vaswani", "Noam Shazeer"],
            year=2017,
            doi="10.48550/arXiv.1706.03762",
            openalex_id="W2963403868",
        )
    )
    gb.add_edge(seed2, ref2)

    assert ref2 == "doi:10.48550/arxiv.1706.03762"
    payload = gb.build()
    assert len(payload.nodes) == 3
    assert len(payload.edges) == 2
    targets = {e.target for e in payload.edges}
    assert targets == {"doi:10.48550/arxiv.1706.03762"}
    merged = next(n for n in payload.nodes if n.id == ref2)
    assert merged.authors == ["Ashish Vaswani", "Noam Shazeer"]
    assert merged.raw_citation is not None


def test_self_loops_and_duplicate_edges_ignored():
    gb = GraphBuilder()
    n1 = gb.add_node(PaperNode(id="tmp", title="Self Citing Paper", doi="10.1000/1"))
    n2 = gb.add_node(PaperNode(id="tmp", title="Other Paper", doi="10.1000/2"))
    gb.add_edge(n1, n1)
    gb.add_edge(n1, n2)
    gb.add_edge(n1, n2)
    payload = gb.build()
    assert len(payload.edges) == 1
    assert payload.edges[0].source == n1
    assert payload.edges[0].target == n2
