export interface PaperNode {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  doi: string | null;
  arxiv_id: string | null;
  openalex_id: string | null;
  url: string | null;
  raw_citation: string | null;
  citation_contexts?: string[];
  abstract?: string | null;
  topics?: string[];
  cited_by_count: number | null;
  is_seed: boolean;
  is_expanded: boolean;
  is_cited_by_expanded: boolean;
  is_retracted?: boolean;
  expandable: boolean;
}

export interface CitationEdge {
  source: string;
  target: string;
}

export interface GraphPayload {
  nodes: PaperNode[];
  edges: CitationEdge[];
  warnings: string[];
}

export interface ExpandResponse extends GraphPayload {
  source_id: string;
}

export interface EnrichUpdate {
  old_id: string;
  node: PaperNode;
}

export interface EnrichResponse {
  updates: EnrichUpdate[];
  unresolved_count: number;
  warnings: string[];
}

export interface CrossCitationsResponse {
  edges: CitationEdge[];
  updates: EnrichUpdate[];
  warnings: string[];
}

export interface RankedPaper {
  node: PaperNode;
  localCites: number;
  score: number;
}

export interface PathResult {
  nodeIds: string[];
  edgeKeys: string[];
  kind: "directed" | "reverse" | "undirected";
}

export type LayoutMode = "cose" | "flow" | "timeline" | "ego";
export type LabelMode = "auto" | "compact" | "full" | "hover";
export type ThemeMode = "light" | "dark";
export type RelevanceMode = "all" | "shared" | "highly-connected";
export type DirectionMode = "both" | "cites" | "cited-by";
export type DepthMode = "all" | "1" | "2" | "3";
export type NodeSizeMode = "degree" | "citations";

export interface GraphFilters {
  relevance: RelevanceMode;
  direction: DirectionMode;
  depth: DepthMode;
  maxNodes: number | null;
  minYear: number | null;
  maxYear: number | null;
  minCitations: number;
  topic: string;
  sizeBy: NodeSizeMode;
}

export interface BridgePaperRank {
  node: PaperNode;
  connectedSeedCount: number;
  totalSeeds: number;
  localCites: number;
  score: number;
}

export interface UndoSnapshot {
  label: string;
  nodes: Array<[string, PaperNode]>;
  edges: string[];
  edgeColors: Array<[string, string]>;
  expansionColorByPaper: Array<[string, string]>;
  expansionColorIdx: number;
  primarySeedId: string | null;
  selectedId: string | null;
}

export interface HistoryEntry {
  id: string;
  title: string;
  savedAt: number;
  nodeCount: number;
  edgeCount: number;
  layout: LayoutMode;
  nodes: PaperNode[];
  edges: CitationEdge[];
  edgeColors?: Array<[string, string]>;
  expansionColorByPaper?: Array<[string, string]>;
  expansionColorIdx?: number;
  primarySeedId?: string | null;
}
