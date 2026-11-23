from __future__ import annotations

from pydantic import BaseModel, Field


class PaperNode(BaseModel):
    id: str
    title: str
    authors: list[str] = Field(default_factory=list)
    year: int | None = None
    venue: str | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    openalex_id: str | None = None
    url: str | None = None
    raw_citation: str | None = None
    is_seed: bool = False
    is_expanded: bool = False
    expandable: bool = True


class CitationEdge(BaseModel):
    source: str
    target: str


class GraphPayload(BaseModel):
    nodes: list[PaperNode] = Field(default_factory=list)
    edges: list[CitationEdge] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


class ExpandResponse(GraphPayload):
    source_id: str


class LookupRequest(BaseModel):
    identifiers: list[str] = Field(default_factory=list)


class ExpandNodeInput(BaseModel):
    id: str
    title: str | None = None
    year: int | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    openalex_id: str | None = None


class ExpandRequest(BaseModel):
    node: ExpandNodeInput


class EnrichNodeInput(BaseModel):
    id: str
    title: str | None = None
    year: int | None = None
    doi: str | None = None
    arxiv_id: str | None = None
    openalex_id: str | None = None
    raw_citation: str | None = None


class EnrichRequest(BaseModel):
    nodes: list[EnrichNodeInput] = Field(default_factory=list)


class EnrichUpdate(BaseModel):
    old_id: str
    node: PaperNode


class EnrichResponse(BaseModel):
    updates: list[EnrichUpdate] = Field(default_factory=list)
    unresolved_count: int = 0
    warnings: list[str] = Field(default_factory=list)
