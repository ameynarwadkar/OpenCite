import pymupdf
import pytest

from backend.pdf_parser import PDFParseError, parse_pdf_bytes


def _make_pdf(pages: list[list[tuple[float, float, str, float]]]) -> bytes:
    """Helper to generate a synthetic PDF with (x, y, text, fontsize) items per page."""
    doc = pymupdf.open()
    for items in pages:
        page = doc.new_page(width=595, height=842)
        for x, y, text, size in items:
            page.insert_text((x, y), text, fontsize=size)
    data = doc.tobytes()
    doc.close()
    return data


def test_parse_bracketed_references_and_seed_metadata():
    pdf = _make_pdf(
        [
            [
                (72, 80, "A Minimal Study of Citation Graphs", 18),
                (72, 110, "Alice Smith, Bob Jones", 11),
                (72, 130, "arXiv:2401.12345v2  doi:10.1145/1234567.8901234", 10),
                (72, 180, "1. Introduction", 12),
                (72, 200, "Citation graphs help researchers navigate literature.", 10),
                (72, 260, "References", 13),
                (72, 285, "[1] A. Vaswani, N. Shazeer. \"Attention Is All You Need.\" NeurIPS, 2017. arXiv:1706.03762", 10),
                (72, 305, "[2] J. Devlin, M. Chang. BERT: Pre-training of Deep Bidirectional Transformers. NAACL, 2019. 10.18653/v1/N19-1423", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "study.pdf")
    assert parsed.title == "A Minimal Study of Citation Graphs"
    assert parsed.arxiv_id == "2401.12345"
    assert parsed.doi == "10.1145/1234567.8901234"
    assert parsed.warnings == []
    assert len(parsed.references) == 2

    r1, r2 = parsed.references
    assert r1.title == "Attention Is All You Need"
    assert r1.year == 2017
    assert r1.arxiv_id == "1706.03762"
    assert r2.year == 2019
    assert r2.doi == "10.18653/v1/n19-1423"


def test_parse_dot_numbered_references():
    pdf = _make_pdf(
        [
            [
                (72, 80, "Graph Neural Networks Survey", 18),
                (72, 130, "Published in 2022.", 10),
                (72, 200, "References", 12),
                (72, 225, "1. Kipf, T. (2017). Semi-Supervised Classification with Graph Convolutional Networks. ICLR.", 10),
                (72, 245, "2. Velickovic, P. (2018). Graph Attention Networks. ICLR.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "gnn.pdf")
    assert len(parsed.references) == 2
    assert parsed.references[0].year == 2017
    assert "Semi-Supervised Classification" in parsed.references[0].title
    assert parsed.references[1].year == 2018
    assert "Graph Attention Networks" in parsed.references[1].title


def test_parse_two_column_references():
    pdf = _make_pdf(
        [
            [
                (72, 60, "Two Column Paper Title", 18),
                (72, 110, "Left column intro paragraph text here.", 10),
                (72, 140, "More left column body text for layout detection.", 10),
                (320, 110, "Right column body text here.", 10),
                (320, 140, "References", 12),
                (320, 165, "[1] LeCun, Y. \"Deep Learning.\" Nature, 2015.", 10),
                (320, 185, "[2] Goodfellow, I. \"Generative Adversarial Nets.\" NeurIPS, 2014.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "twocol.pdf")
    assert len(parsed.references) == 2
    assert parsed.references[0].title == "Deep Learning"
    assert parsed.references[1].title == "Generative Adversarial Nets"


def test_pdf_without_references_returns_warning():
    pdf = _make_pdf(
        [
            [
                (72, 80, "Short Note Without Bibliography", 18),
                (72, 120, "This short note has no references section at all.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "note.pdf")
    assert parsed.title == "Short Note Without Bibliography"
    assert parsed.references == []
    assert len(parsed.warnings) == 1
    assert "No References section" in parsed.warnings[0]


def test_parse_icml_acl_author_initials_and_corr_arxiv():
    pdf = _make_pdf(
        [
            [
                (72, 80, "Retriever-Free Retrieval: Navigating Documents", 18),
                (72, 120, "Published 2026.", 10),
                (72, 180, "References", 12),
                (72, 205, "Lewis, P., Perez, E., Piktus, A., and Kiela, D. Retrieval-augmented", 10),
                (72, 218, "generation for knowledge-intensive NLP tasks. In NeurIPS, 2020.", 10),
                (72, 240, "Zhang, Y., Li, M., Long, D., and Zhou, J. Qwen3 embedding: Advancing", 10),
                (72, 253, "text embedding through foundation models. CoRR, abs/2506.05176, 2025.", 10),
                (72, 275, "Devlin, J., Lee, K., and Toutanova, K. BERT: Pre-training of Deep", 10),
                (72, 288, "Bidirectional Transformers. In NAACL-HLT, pp. 4171-4186, 2019.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "icml.pdf")
    assert len(parsed.references) == 3

    r1, r2, r3 = parsed.references
    assert r1.title == "Retrieval-augmented generation for knowledge-intensive NLP tasks"
    assert r1.year == 2020
    assert r1.authors[0] == "Lewis, P."

    assert r2.title == "Qwen3 embedding: Advancing text embedding through foundation models"
    assert r2.year == 2025
    assert r2.arxiv_id == "2506.05176"

    assert r3.title == "BERT: Pre-training of Deep Bidirectional Transformers"
    assert r3.year == 2019


def test_year_extraction_edge_cases():
    pdf = _make_pdf(
        [
            [
                (72, 80, "Year Edge Cases Paper", 18),
                (72, 130, "References", 12),
                (72, 155, "[1] A. Author. \"Disambiguated Year Paper.\" ACL, 2024a.", 10),
                (72, 175, "[2] B. Author. \"Shorthand Conference Paper.\" NeurIPS '20.", 10),
                (72, 195, "[3] C. Author. \"Arxiv Only Preprint.\" CoRR, abs/2506.05176.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "years.pdf")
    assert len(parsed.references) == 3
    assert parsed.references[0].year == 2024
    assert parsed.references[1].year == 2020
    assert parsed.references[2].year == 2025


def test_multiline_author_list_is_not_split_into_orphan_node():
    pdf = _make_pdf(
        [
            [
                (72, 80, "Multi Author Reference Test", 18),
                (72, 130, "References", 12),
                (72, 155, "Lewis, P., Perez, E., Piktus, A., Petroni, F.,", 10),
                (72, 168, "Karpukhin, V., Goyal, N., and Kiela, D. Retrieval-", 10),
                (72, 181, "augmented generation for NLP tasks. In NeurIPS, 2020.", 10),
                (72, 200, "Devlin, J., Lee, K., Chang, M., and Toutanova, K.", 10),
                (72, 213, "BERT: Pre-training of Deep Bidirectional Transformers.", 10),
                (72, 226, "In NAACL-HLT, 2019.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "multiauthor.pdf")
    assert len(parsed.references) == 2
    assert parsed.references[0].year == 2020
    assert "Retrievalaugmented generation" in parsed.references[0].title or "Retrieval-augmented generation" in parsed.references[0].title
    assert parsed.references[1].year == 2019
    assert "BERT: Pre-training of Deep Bidirectional Transformers" in parsed.references[1].title


def test_in_text_citation_year_in_abstract_does_not_override_seed_year():
    pdf = _make_pdf(
        [
            [
                (72, 70, "Trustworthy and Efficient LLMs Meet Databases", 18),
                (72, 95, "arXiv:2412.18022v1  24 Dec 2024", 10),
                (72, 120, "Abstract", 12),
                (72, 140, "Transformers (Vaswani et al., 2017) revolutionized NLP and databases.", 10),
                (72, 190, "References", 12),
                (72, 215, "[1] Vaswani, A. \"Attention Is All You Need.\" NeurIPS, 2017.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "2412.18022.pdf")
    assert parsed.year == 2024
    assert parsed.arxiv_id == "2412.18022"


def test_extracts_in_paper_citation_contexts():
    pdf = _make_pdf(
        [
            [
                (72, 70, "Context Extraction Study", 18),
                (72, 110, "1. Introduction", 12),
                (72, 130, "Prior work [1] introduced self-attention for sequence modeling.", 10),
                (72, 145, "Later approaches built upon BERT [1, 2] for retrieval tasks.", 10),
                (72, 190, "References", 12),
                (72, 215, "[1] A. Vaswani. \"Attention Is All You Need.\" NeurIPS, 2017.", 10),
                (72, 235, "[2] J. Devlin. \"BERT: Pre-training Transformers.\" NAACL, 2019.", 10),
            ]
        ]
    )
    parsed = parse_pdf_bytes(pdf, "ctx.pdf")
    assert len(parsed.references) == 2
    assert len(parsed.references[0].citation_contexts) == 2
    assert "self-attention" in parsed.references[0].citation_contexts[0]
    assert len(parsed.references[1].citation_contexts) == 1
    assert "BERT [1, 2]" in parsed.references[1].citation_contexts[0]


def test_invalid_and_empty_pdf_raise():
    with pytest.raises(PDFParseError):
        parse_pdf_bytes(b"not a pdf", "bad.pdf")

    empty_doc = pymupdf.open()
    empty_doc.new_page()
    empty_bytes = empty_doc.tobytes()
    empty_doc.close()
    with pytest.raises(PDFParseError, match="No extractable text"):
        parse_pdf_bytes(empty_bytes, "scanned.pdf")
