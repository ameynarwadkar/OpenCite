import type {
  CitationEdge,
  GraphPayload,
  HistoryEntry,
  LayoutMode,
  PaperNode,
  PathResult,
  RankedPaper,
  UndoSnapshot,
} from "./types";

const HISTORY_KEY = "citation-graph:history";
const MAX_HISTORY_ITEMS = 15;
const MAX_UNDO_STEPS = 20;

export const EXPANSION_EDGE_PALETTE = [
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f97316", // orange
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
  "#eab308", // gold
  "#f43f5e", // rose
  "#06b6d4", // cyan
  "#84cc16", // lime
] as const;

export function normalizeTitle(t: string | null | undefined): string {
  return (t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function idPriority(id: string): number {
  if (id.startsWith("doi:")) return 4;
  if (id.startsWith("arxiv:")) return 3;
  if (id.startsWith("openalex:")) return 2;
  return 1;
}

export function appendYearIfMissing(text: string, year: number | null): string {
  if (!year) return text;
  if (text.includes(String(year))) return text;
  return `${text} (${year})`;
}

export function formatFullLabel(node: PaperNode): string {
  const title = node.title || "Untitled";
  const truncated = title.length > 48 ? `${title.slice(0, 46).trimEnd()}…` : title;
  return appendYearIfMissing(truncated, node.year);
}

export function formatCompactLabel(node: PaperNode): string {
  if (node.is_seed) return formatFullLabel(node);
  const title = node.title || "Untitled";
  const truncated = title.length > 28 ? `${title.slice(0, 26).trimEnd()}…` : title;
  return appendYearIfMissing(truncated, node.year);
}

export class GraphStore {
  nodes = new Map<string, PaperNode>();
  edges = new Set<string>();
  edgeColors = new Map<string, string>();
  expansionColorByPaper = new Map<string, string>();
  expansionColorIdx = 0;
  primarySeedId: string | null = null;
  hiddenIds = new Set<string>();
  undoStack: UndoSnapshot[] = [];
  selectedId: string | null = null;
  activeHistoryId: string | null = null;

  clear(): void {
    this.nodes.clear();
    this.edges.clear();
    this.edgeColors.clear();
    this.expansionColorByPaper.clear();
    this.expansionColorIdx = 0;
    this.primarySeedId = null;
    this.hiddenIds.clear();
    this.undoStack = [];
    this.selectedId = null;
    this.activeHistoryId = null;
  }

  computeInDegrees(): Map<string, number> {
    const inDeg = new Map<string, number>();
    for (const id of this.nodes.keys()) inDeg.set(id, 0);
    for (const key of this.edges) {
      const [, dst] = key.split("->");
      inDeg.set(dst, (inDeg.get(dst) ?? 0) + 1);
    }
    return inDeg;
  }

  getTopFoundational(limit = 5): RankedPaper[] {
    const inDeg = this.computeInDegrees();
    const candidates: RankedPaper[] = [];
    for (const [id, node] of this.nodes.entries()) {
      if (node.is_seed) continue;
      const localCites = inDeg.get(id) ?? 0;
      const globalScore = Math.log10((node.cited_by_count ?? 0) + 1);
      const score = localCites * 3 + globalScore;
      candidates.push({ node, localCites, score });
    }
    candidates.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.node.cited_by_count ?? 0) - (a.node.cited_by_count ?? 0);
    });
    return candidates.slice(0, limit);
  }

  findShortestPath(startId: string, targetId: string): PathResult | null {
    if (startId === targetId || !this.nodes.has(startId) || !this.nodes.has(targetId)) {
      return null;
    }

    const outAdj = new Map<string, string[]>();
    const undirAdj = new Map<string, Array<{ next: string; edgeKey: string }>>();
    for (const key of this.edges) {
      const [src, dst] = key.split("->");
      const oList = outAdj.get(src) ?? [];
      oList.push(dst);
      outAdj.set(src, oList);

      const u1 = undirAdj.get(src) ?? [];
      u1.push({ next: dst, edgeKey: key });
      undirAdj.set(src, u1);

      const u2 = undirAdj.get(dst) ?? [];
      u2.push({ next: src, edgeKey: key });
      undirAdj.set(dst, u2);
    }

    const bfsDirected = (from: string, to: string): { nodeIds: string[]; edgeKeys: string[] } | null => {
      const queue: string[] = [from];
      const prev = new Map<string, string | null>([[from, null]]);
      while (queue.length > 0) {
        const cur = queue.shift()!;
        if (cur === to) break;
        for (const nxt of outAdj.get(cur) ?? []) {
          if (!prev.has(nxt)) {
            prev.set(nxt, cur);
            queue.push(nxt);
          }
        }
      }
      if (!prev.has(to)) return null;
      const nodeIds: string[] = [];
      let cur: string | null = to;
      while (cur !== null) {
        nodeIds.push(cur);
        cur = prev.get(cur) ?? null;
      }
      nodeIds.reverse();
      const edgeKeys: string[] = [];
      for (let i = 0; i < nodeIds.length - 1; i += 1) {
        edgeKeys.push(`${nodeIds[i]}->${nodeIds[i + 1]}`);
      }
      return { nodeIds, edgeKeys };
    };

    const fwd = bfsDirected(startId, targetId);
    if (fwd) return { ...fwd, kind: "directed" };

    const rev = bfsDirected(targetId, startId);
    if (rev) return { ...rev, kind: "reverse" };

    // Undirected fallback (connects via shared citations)
    const queue: string[] = [startId];
    const prev = new Map<string, { node: string; edgeKey: string } | null>([[startId, null]]);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (cur === targetId) break;
      for (const step of undirAdj.get(cur) ?? []) {
        if (!prev.has(step.next)) {
          prev.set(step.next, { node: cur, edgeKey: step.edgeKey });
          queue.push(step.next);
        }
      }
    }
    if (!prev.has(targetId)) return null;
    const nodeIds: string[] = [];
    const edgeKeys: string[] = [];
    let cur: string | null = targetId;
    while (cur !== null) {
      nodeIds.push(cur);
      const p: { node: string; edgeKey: string } | null = prev.get(cur) ?? null;
      if (p) {
        edgeKeys.push(p.edgeKey);
        cur = p.node;
      } else {
        cur = null;
      }
    }
    nodeIds.reverse();
    edgeKeys.reverse();
    return { nodeIds, edgeKeys, kind: "undirected" };
  }

  getColorForExpandedPaper(paperId: string): string {
    const existing = this.expansionColorByPaper.get(paperId);
    if (existing) return existing;
    const color = EXPANSION_EDGE_PALETTE[this.expansionColorIdx % EXPANSION_EDGE_PALETTE.length];
    this.expansionColorIdx += 1;
    this.expansionColorByPaper.set(paperId, color);
    return color;
  }

  pushUndoSnapshot(label: string): void {
    this.undoStack.push({
      label,
      nodes: Array.from(this.nodes.entries()).map(([id, n]) => [
        id,
        { ...n, authors: [...(n.authors ?? [])] },
      ]),
      edges: Array.from(this.edges),
      edgeColors: Array.from(this.edgeColors.entries()),
      expansionColorByPaper: Array.from(this.expansionColorByPaper.entries()),
      expansionColorIdx: this.expansionColorIdx,
      primarySeedId: this.primarySeedId,
      selectedId: this.selectedId,
    });
    if (this.undoStack.length > MAX_UNDO_STEPS) {
      this.undoStack.shift();
    }
  }

  undo(): string | null {
    const snap = this.undoStack.pop();
    if (!snap) return null;
    this.nodes = new Map(snap.nodes);
    this.edges = new Set(snap.edges);
    this.edgeColors = new Map(snap.edgeColors);
    this.expansionColorByPaper = new Map(snap.expansionColorByPaper);
    this.expansionColorIdx = snap.expansionColorIdx;
    this.primarySeedId = snap.primarySeedId;
    this.selectedId = snap.selectedId;
    return snap.label;
  }

  private findExistingNodeId(incoming: PaperNode): string | null {
    if (this.nodes.has(incoming.id)) return incoming.id;
    const normTitle = normalizeTitle(incoming.title);
    for (const [id, existing] of this.nodes.entries()) {
      if (incoming.doi && existing.doi && incoming.doi === existing.doi) return id;
      if (incoming.arxiv_id && existing.arxiv_id && incoming.arxiv_id === existing.arxiv_id) return id;
      if (incoming.openalex_id && existing.openalex_id && incoming.openalex_id === existing.openalex_id) return id;
      if (normTitle.length >= 15 && normalizeTitle(existing.title) === normTitle) {
        if (!incoming.year || !existing.year || incoming.year === existing.year) {
          return id;
        }
      }
    }
    return null;
  }

  private remapId(oldId: string, newId: string): void {
    if (oldId === newId) return;
    const nextEdges = new Set<string>();
    const nextColors = new Map<string, string>();
    for (const key of this.edges) {
      const [s, t] = key.split("->");
      const ns = s === oldId ? newId : s;
      const nt = t === oldId ? newId : t;
      if (ns !== nt) {
        const newKey = `${ns}->${nt}`;
        nextEdges.add(newKey);
        const c = this.edgeColors.get(key);
        if (c) nextColors.set(newKey, c);
      }
    }
    this.edges = nextEdges;
    this.edgeColors = nextColors;

    const expColor = this.expansionColorByPaper.get(oldId);
    if (expColor) {
      this.expansionColorByPaper.delete(oldId);
      this.expansionColorByPaper.set(newId, expColor);
    }
    if (this.primarySeedId === oldId) this.primarySeedId = newId;
    if (this.selectedId === oldId) this.selectedId = newId;
  }

  mergePayload(
    payload: Pick<GraphPayload, "nodes" | "edges"> & { source_id?: string },
    preferredOldSourceId: string | null = null,
    edgeColor: string | null = null
  ): void {
    const idMap = new Map<string, string>();

    for (const incoming of payload.nodes ?? []) {
      let existingId = this.findExistingNodeId(incoming);
      if (
        !existingId &&
        preferredOldSourceId &&
        payload.source_id === incoming.id &&
        this.nodes.has(preferredOldSourceId)
      ) {
        existingId = preferredOldSourceId;
      }

      if (!existingId) {
        this.nodes.set(incoming.id, { ...incoming });
        idMap.set(incoming.id, incoming.id);
        if (incoming.is_seed && !this.primarySeedId) {
          this.primarySeedId = incoming.id;
        }
      } else {
        const existing = this.nodes.get(existingId)!;
        const targetId =
          idPriority(incoming.id) > idPriority(existing.id) ? incoming.id : existing.id;
        const merged: PaperNode = {
          ...existing,
          id: targetId,
          title:
            !existing.title || (existing.raw_citation && !incoming.raw_citation && incoming.title)
              ? incoming.title
              : existing.title,
          authors:
            (existing.authors?.length ?? 0) >= (incoming.authors?.length ?? 0)
              ? existing.authors
              : incoming.authors,
          year: existing.year ?? incoming.year,
          venue: existing.venue ?? incoming.venue,
          doi: existing.doi ?? incoming.doi,
          arxiv_id: existing.arxiv_id ?? incoming.arxiv_id,
          openalex_id: existing.openalex_id ?? incoming.openalex_id,
          url: existing.url ?? incoming.url,
          raw_citation: existing.raw_citation ?? incoming.raw_citation,
          abstract: existing.abstract ?? incoming.abstract ?? null,
          topics:
            (existing.topics?.length ?? 0) >= (incoming.topics?.length ?? 0)
              ? (existing.topics ?? [])
              : (incoming.topics ?? []),
          cited_by_count: existing.cited_by_count ?? incoming.cited_by_count ?? null,
          is_seed: Boolean(existing.is_seed || incoming.is_seed),
          is_expanded: Boolean(existing.is_expanded || incoming.is_expanded),
          is_cited_by_expanded: Boolean(
            existing.is_cited_by_expanded || incoming.is_cited_by_expanded
          ),
          expandable: Boolean(existing.expandable || incoming.expandable),
        };
        if (targetId !== existingId) {
          this.nodes.delete(existingId);
          this.remapId(existingId, targetId);
        }
        this.nodes.set(targetId, merged);
        idMap.set(incoming.id, targetId);
      }
    }

    for (const edge of payload.edges ?? []) {
      const src = idMap.get(edge.source) ?? edge.source;
      const dst = idMap.get(edge.target) ?? edge.target;
      if (src !== dst && this.nodes.has(src) && this.nodes.has(dst)) {
        const key = `${src}->${dst}`;
        const isNew = !this.edges.has(key);
        this.edges.add(key);
        if (edgeColor && (isNew || !this.edgeColors.has(key))) {
          this.edgeColors.set(key, edgeColor);
        }
      }
    }
  }

  getNodeConnections(nodeId: string): {
    cites: PaperNode[];
    citedBy: PaperNode[];
    sharedWith: Array<{ node: PaperNode; count: number }>;
    connectedSeeds: PaperNode[];
  } {
    const outSet = new Set<string>();
    const inSet = new Set<string>();
    const outByNode = new Map<string, Set<string>>();

    for (const key of this.edges) {
      const [src, dst] = key.split("->");
      if (src === nodeId) outSet.add(dst);
      if (dst === nodeId) inSet.add(src);
      let s = outByNode.get(src);
      if (!s) {
        s = new Set<string>();
        outByNode.set(src, s);
      }
      s.add(dst);
    }

    const cites = Array.from(outSet)
      .map((id) => this.nodes.get(id))
      .filter((n): n is PaperNode => Boolean(n));
    const citedBy = Array.from(inSet)
      .map((id) => this.nodes.get(id))
      .filter((n): n is PaperNode => Boolean(n));

    // Papers sharing >= 1 outgoing reference with this node
    const sharedWith: Array<{ node: PaperNode; count: number }> = [];
    if (outSet.size > 0) {
      for (const [otherId, otherRefs] of outByNode.entries()) {
        if (otherId === nodeId) continue;
        let overlap = 0;
        for (const r of outSet) {
          if (otherRefs.has(r)) overlap += 1;
        }
        if (overlap > 0) {
          const other = this.nodes.get(otherId);
          if (other) sharedWith.push({ node: other, count: overlap });
        }
      }
      sharedWith.sort((a, b) => b.count - a.count);
    }

    // Seed papers that reach this node (via directed or 2-hop connection)
    const seeds = Array.from(this.nodes.values()).filter((n) => n.is_seed && n.id !== nodeId);
    const connectedSeeds: PaperNode[] = [];
    for (const seed of seeds) {
      const path = this.findShortestPath(seed.id, nodeId);
      if (path && path.edgeKeys.length <= 2) {
        connectedSeeds.push(seed);
      }
    }

    return { cites, citedBy, sharedWith: sharedWith.slice(0, 12), connectedSeeds };
  }

  toBibtex(node: PaperNode): string {
    const firstAuthorLast = (node.authors[0] ?? "paper")
      .split(/[,\s]+/)[0]
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "") || "paper";
    const yr = node.year ? String(node.year) : "nd";
    const firstWord = (node.title || "work")
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .split(/\s+/)
      .find((w) => w.length > 3) ?? "work";
    const key = `${firstAuthorLast}${yr}${firstWord}`;
    const lines = [
      `@article{${key},`,
      `  title = {${node.title}},`,
    ];
    if (node.authors.length > 0) {
      lines.push(`  author = {${node.authors.join(" and ")}},`);
    }
    if (node.year) lines.push(`  year = {${node.year}},`);
    if (node.venue) lines.push(`  journal = {${node.venue}},`);
    if (node.doi) lines.push(`  doi = {${node.doi}},`);
    if (node.arxiv_id) lines.push(`  eprint = {${node.arxiv_id}},`);
    if (node.url) lines.push(`  url = {${node.url}},`);
    lines.push("}");
    return lines.join("\n");
  }

  toExportJson(): { nodes: PaperNode[]; edges: CitationEdge[] } {
    return {
      nodes: Array.from(this.nodes.values()),
      edges: Array.from(this.edges).map((k) => {
        const [source, target] = k.split("->");
        return { source, target };
      }),
    };
  }

  // History persistence
  readHistory(): HistoryEntry[] {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  writeHistory(items: HistoryEntry[]): void {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
    } catch {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 5)));
      } catch {
        // Ignore storage quota errors
      }
    }
  }

  saveHistory(layout: LayoutMode): void {
    if (this.nodes.size === 0) return;
    const items = this.readHistory();
    const id =
      this.activeHistoryId ?? `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.activeHistoryId = id;

    const seeds = Array.from(this.nodes.values()).filter((n) => n.is_seed);
    const title =
      seeds.length === 0
        ? "Citation Graph"
        : seeds.length === 1
          ? seeds[0].title || "Untitled"
          : `${seeds[0].title || "Untitled"} +${seeds.length - 1}`;

    const entry: HistoryEntry = {
      id,
      title,
      savedAt: Date.now(),
      nodeCount: this.nodes.size,
      edgeCount: this.edges.size,
      layout,
      ...this.toExportJson(),
      edgeColors: Array.from(this.edgeColors.entries()),
      expansionColorByPaper: Array.from(this.expansionColorByPaper.entries()),
      expansionColorIdx: this.expansionColorIdx,
      primarySeedId: this.primarySeedId,
    };

    const next = items.filter((i) => i.id !== id);
    next.unshift(entry);
    this.writeHistory(next);
  }

  restoreHistory(id: string): LayoutMode | null {
    const item = this.readHistory().find((h) => h.id === id);
    if (!item) return null;

    this.clear();
    this.activeHistoryId = item.id;
    for (const node of item.nodes ?? []) {
      this.nodes.set(node.id, { ...node });
    }
    for (const edge of item.edges ?? []) {
      if (this.nodes.has(edge.source) && this.nodes.has(edge.target)) {
        this.edges.add(`${edge.source}->${edge.target}`);
      }
    }
    this.edgeColors = new Map(item.edgeColors ?? []);
    this.expansionColorByPaper = new Map(item.expansionColorByPaper ?? []);
    this.expansionColorIdx = item.expansionColorIdx ?? this.expansionColorByPaper.size;
    this.primarySeedId =
      item.primarySeedId ?? (item.nodes ?? []).find((n) => n.is_seed)?.id ?? null;

    const rawLayout = item.layout as string | undefined;
    if (rawLayout === "flow" || rawLayout === "timeline" || rawLayout === "ego" || rawLayout === "cose") {
      return rawLayout;
    }
    if (rawLayout === "breadthfirst") return "flow";
    if (rawLayout === "concentric") return "ego";
    return "cose";
  }

  deleteHistory(id: string): void {
    const next = this.readHistory().filter((h) => h.id !== id);
    if (this.activeHistoryId === id) this.activeHistoryId = null;
    this.writeHistory(next);
  }

  clearHistory(): void {
    this.activeHistoryId = null;
    this.writeHistory([]);
  }
}
