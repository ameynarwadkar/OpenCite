import cytoscape, { type Core, type LayoutOptions, type NodeSingular } from "cytoscape";
import elk from "cytoscape-elk";
import fcose from "cytoscape-fcose";
import { formatCompactLabel, formatFullLabel, type GraphStore } from "./store";
import type { GraphFilters, LabelMode, LayoutMode, ThemeMode } from "./types";

cytoscape.use(fcose);
cytoscape.use(elk);

export interface GraphViewCallbacks {
  onSelectNode: (nodeId: string) => void;
  onClearSelection: () => void;
  onHoverNode: (nodeId: string, pos: { x: number; y: number }) => void;
  onUnhoverNode: () => void;
}

export class CitationGraphView {
  readonly cy: Core;
  private zoomTimer: number | null = null;
  private labelMode: LabelMode = "auto";
  private layoutMode: LayoutMode = "cose";
  private dragLastPos: { x: number; y: number } | null = null;
  private dragNeighbors: cytoscape.NodeCollection | null = null;

  constructor(
    container: HTMLElement,
    private readonly store: GraphStore,
    callbacks: GraphViewCallbacks
  ) {
    this.cy = cytoscape({
      container,
      elements: [],
      wheelSensitivity: 1.8,
      minZoom: 0.1,
      maxZoom: 5,
      style: [
        {
          selector: "node.paper",
          style: {
            label: "data(displayLabel)",
            "font-size": 10,
            "font-family": '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            color: "#09090b",
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 6,
            "text-wrap": "wrap",
            "text-max-width": "130px",
            "text-background-color": "#ffffff",
            "text-background-opacity": 0.92,
            "text-background-padding": "3px",
            "text-background-shape": "roundrectangle",
            "text-border-width": 0.75,
            "text-border-color": "#e4e4e7",
            "text-border-opacity": 0.95,
            "background-color": "#71717a",
            width: "data(size)",
            height: "data(size)",
            "border-width": 1.5,
            "border-color": "#ffffff",
            "overlay-padding": 5,
            "z-index": 2,
          },
        },
        {
          selector: "node.paper.hide-label",
          style: {
            label: "",
            "text-background-opacity": 0,
            "text-border-opacity": 0,
          },
        },
        {
          selector: "node.paper.timeline-node",
          style: {
            "text-valign": "center",
            "text-halign": "right",
            "text-margin-x": 8,
            "text-margin-y": 0,
            "text-max-width": "195px",
            "text-justification": "left",
          },
        },
        {
          selector: "node.paper.shared",
          style: {
            "background-color": "#f59e0b",
            "font-weight": 600,
            "z-index": 6,
          },
        },
        {
          selector: "node.paper.seed",
          style: {
            "background-color": "#818cf8",
            "font-weight": 700,
            "font-size": 12,
            "z-index": 12,
          },
        },
        {
          selector: "node.paper.primary-seed",
          style: {
            "background-color": "#38bdf8",
            "border-width": 3,
            "border-color": "#0284c7",
            "font-weight": 700,
            "font-size": 12.5,
            "text-border-color": "#0284c7",
            "z-index": 15,
          },
        },
        {
          selector: "node.paper.expanded:unselected",
          style: {
            "border-width": 3,
            "border-color": "#09090b",
          },
        },
        {
          selector: "node.paper.expanded[expansionColor]:unselected",
          style: {
            "border-width": 3.5,
            "border-color": "data(expansionColor)",
          },
        },
        {
          selector: "node.paper:selected",
          style: {
            label: "data(fullLabel)",
            "text-background-opacity": 0.98,
            "text-border-opacity": 1,
            "border-width": 3.5,
            "border-color": "#09090b",
            "z-index": 50,
          },
        },
        {
          selector: "node.year-header",
          style: {
            label: "data(label)",
            shape: "round-rectangle",
            width: 78,
            height: 26,
            "background-color": "#f4f4f5",
            "border-width": 1,
            "border-color": "#d4d4d8",
            color: "#09090b",
            "font-family": '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            "font-size": 11.5,
            "font-weight": 600,
            "text-valign": "center",
            "text-halign": "center",
            events: "no",
            "z-index": 1,
          },
        },
        {
          selector: "edge",
          style: {
            width: 0.9,
            "line-color": "#d4d4d8",
            "target-arrow-color": "#a1a1aa",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.65,
            "curve-style": "bezier",
            opacity: 0.25,
            "z-index": 1,
          },
        },
        {
          selector: "edge[edgeColor]",
          style: {
            width: 1.35,
            "line-color": "data(edgeColor)",
            "target-arrow-color": "data(edgeColor)",
            opacity: 0.52,
            "z-index": 3,
          },
        },
        {
          selector: "edge.primary-cites",
          style: {
            width: 2.2,
            "line-color": "#0284c7",
            "target-arrow-color": "#0284c7",
            opacity: 1,
            "z-index": 6,
          },
        },
        {
          selector: "edge.primary-cited-by",
          style: {
            width: 2.2,
            "line-color": "#059669",
            "target-arrow-color": "#059669",
            opacity: 1,
            "z-index": 6,
          },
        },
        {
          selector: ".dimmed",
          style: { opacity: 0.14 },
        },
        {
          selector: "node.paper.highlighted",
          style: {
            opacity: 1,
            label: "data(compactLabel)",
            "text-background-opacity": 0.96,
            "text-border-opacity": 1,
            "z-index": 40,
          },
        },
        {
          selector: "node.paper.hovered",
          style: {
            opacity: 1,
            label: "data(fullLabel)",
            "text-background-opacity": 0.98,
            "text-border-opacity": 1,
            "z-index": 100,
          },
        },
        {
          selector: "edge.highlighted",
          style: {
            width: 2.2,
            opacity: 1,
            "z-index": 20,
          },
        },
        {
          selector: "edge.hl-cites",
          style: {
            width: 2.4,
            "line-color": "#0284c7",
            "target-arrow-color": "#0284c7",
            opacity: 1,
            "z-index": 25,
          },
        },
        {
          selector: "edge.hl-cited-by",
          style: {
            width: 2.4,
            "line-color": "#059669",
            "target-arrow-color": "#059669",
            opacity: 1,
            "z-index": 25,
          },
        },
        {
          selector: "node.search-hit",
          style: {
            label: "data(fullLabel)",
            "text-background-opacity": 0.96,
            "text-border-opacity": 1,
            "border-width": 3.5,
            "border-color": "#ec4899",
            "z-index": 45,
          },
        },
        {
          selector: ".ego-hidden",
          style: { display: "none" },
        },
        {
          selector: "node.paper.ego-center",
          style: {
            "border-width": 4,
            "border-color": "#38bdf8",
            "z-index": 30,
          },
        },
        {
          selector: ".path-dimmed",
          style: { opacity: 0.12 },
        },
        {
          selector: "node.paper.path-active",
          style: {
            opacity: 1,
            label: "data(fullLabel)",
            "text-background-opacity": 0.98,
            "text-border-color": "#38bdf8",
            "text-border-opacity": 1,
            "border-width": 4,
            "border-color": "#38bdf8",
            "z-index": 70,
          },
        },
        {
          selector: "edge.path-active",
          style: {
            opacity: 1,
            width: 3.2,
            "line-color": "#38bdf8",
            "target-arrow-color": "#38bdf8",
            "z-index": 65,
          },
        },
      ],
    });

    this.cy.on("zoom", () => {
      if (this.labelMode !== "auto") return;
      if (this.zoomTimer !== null) window.clearTimeout(this.zoomTimer);
      this.zoomTimer = window.setTimeout(() => this.updateLabelVisibility(), 60);
    });

    this.cy.on("tap", "node.paper", (evt) => {
      callbacks.onSelectNode(evt.target.id());
    });
    this.cy.on("tap", (evt) => {
      if (evt.target === this.cy) callbacks.onClearSelection();
    });

    this.cy.on("mouseover", "node.paper", (evt) => {
      const node = evt.target as NodeSingular;
      const neighborhood = node.closedNeighborhood();
      this.cy.elements(".paper, edge").addClass("dimmed");
      neighborhood.removeClass("dimmed").addClass("highlighted");
      node.outgoers("edge").addClass("hl-cites");
      node.incomers("edge").addClass("hl-cited-by");
      node.addClass("hovered");
      callbacks.onHoverNode(node.id(), node.renderedPosition());
    });
    this.cy.on("mouseout", "node.paper", () => {
      this.cy.elements().removeClass("dimmed highlighted hovered hl-cites hl-cited-by");
      callbacks.onUnhoverNode();
    });

    // Dragging a node also moves its connected neighbors (hold Shift to move single node only)
    this.cy.on("grab", "node.paper", (evt) => {
      const node = evt.target as NodeSingular;
      const pos = node.position();
      this.dragLastPos = { x: pos.x, y: pos.y };
      // Exclude already-selected nodes since Cytoscape moves those natively
      this.dragNeighbors = node.neighborhood("node.paper").filter((n) => !n.selected());
    });

    this.cy.on("drag", "node.paper", (evt) => {
      if (!this.dragLastPos || !this.dragNeighbors) return;
      const node = evt.target as NodeSingular;
      const pos = node.position();
      const dx = pos.x - this.dragLastPos.x;
      const dy = pos.y - this.dragLastPos.y;
      this.dragLastPos = { x: pos.x, y: pos.y };

      const origEvt = evt.originalEvent as MouseEvent | undefined;
      if (origEvt?.shiftKey || (dx === 0 && dy === 0)) return;

      this.cy.batch(() => {
        this.dragNeighbors!.forEach((neighbor) => {
          const np = neighbor.position();
          neighbor.position({ x: np.x + dx, y: np.y + dy });
        });
      });
    });

    this.cy.on("free", "node.paper", () => {
      this.dragLastPos = null;
      this.dragNeighbors = null;
    });
  }

  applyTheme(theme: ThemeMode): void {
    const isDark = theme === "dark";
    this.cy
      .style()
      .selector("node.paper")
      .style({
        color: isDark ? "#fafafa" : "#09090b",
        "text-background-color": isDark ? "#111113" : "#ffffff",
        "text-border-color": isDark ? "#27272a" : "#e4e4e7",
        "background-color": isDark ? "#a1a1aa" : "#71717a",
        "border-color": isDark ? "#09090b" : "#ffffff",
      })
      .selector("node.paper.shared")
      .style({
        "background-color": "#f59e0b",
      })
      .selector("node.paper.seed")
      .style({
        "background-color": "#818cf8",
        "text-border-color": isDark ? "#818cf8" : "#c7d2fe",
      })
      .selector("node.paper.primary-seed")
      .style({
        "background-color": "#38bdf8",
        "border-color": isDark ? "#bae6fd" : "#0284c7",
        "text-border-color": isDark ? "#38bdf8" : "#0284c7",
      })
      .selector("node.paper.expanded:unselected")
      .style({
        "border-color": isDark ? "#fafafa" : "#09090b",
      })
      .selector("node.paper.expanded[expansionColor]:unselected")
      .style({
        "border-color": "data(expansionColor)",
      })
      .selector("node.paper:selected")
      .style({
        "border-color": isDark ? "#fafafa" : "#09090b",
      })
      .selector("node.year-header")
      .style({
        "background-color": isDark ? "#18181b" : "#f4f4f5",
        "border-color": isDark ? "#3f3f46" : "#d4d4d8",
        color: isDark ? "#fafafa" : "#09090b",
      })
      .selector("edge")
      .style({
        "line-color": isDark ? "#3f3f46" : "#d4d4d8",
        "target-arrow-color": isDark ? "#52525b" : "#a1a1aa",
      })
      .selector("edge[edgeColor]")
      .style({
        "line-color": "data(edgeColor)",
        "target-arrow-color": "data(edgeColor)",
      })
      .selector("edge.primary-cites")
      .style({
        "line-color": isDark ? "#38bdf8" : "#0284c7",
        "target-arrow-color": isDark ? "#38bdf8" : "#0284c7",
      })
      .selector("edge.primary-cited-by")
      .style({
        "line-color": isDark ? "#34d399" : "#059669",
        "target-arrow-color": isDark ? "#34d399" : "#059669",
      })
      .selector("edge.hl-cites")
      .style({
        "line-color": isDark ? "#38bdf8" : "#0284c7",
        "target-arrow-color": isDark ? "#38bdf8" : "#0284c7",
      })
      .selector("edge.hl-cited-by")
      .style({
        "line-color": isDark ? "#34d399" : "#059669",
        "target-arrow-color": isDark ? "#34d399" : "#059669",
      })
      .update();
  }

  setLabelMode(mode: LabelMode): void {
    this.labelMode = mode;
    this.updateLabelVisibility();
  }

  setLayoutMode(mode: LayoutMode): void {
    this.layoutMode = mode;
    this.applyLayout();
  }

  render(filters: GraphFilters, searchQuery: string): void {
    const inDeg = this.store.computeInDegrees();
    const hopDist =
      filters.depth !== "all" ? this.store.computeHopDistancesFromSeeds() : null;
    const maxHops = filters.depth !== "all" ? Number(filters.depth) : Infinity;
    const directionalAllowed =
      filters.direction !== "both"
        ? this.store.getDirectionalReachableFromSeeds(filters.direction)
        : null;

    // Determine dynamic hub threshold so dense cross-cited graphs keep clear visual hierarchy
    const nonSeedDegrees: number[] = [];
    for (const [id, node] of this.store.nodes.entries()) {
      if (!node.is_seed) nonSeedDegrees.push(inDeg.get(id) ?? 0);
    }
    const multiCitedCount = nonSeedDegrees.filter((d) => d >= 2).length;
    let sharedThreshold = 2;
    if (nonSeedDegrees.length >= 15 && multiCitedCount > nonSeedDegrees.length * 0.35) {
      const sorted = [...nonSeedDegrees].sort((a, b) => b - a);
      const topCutIdx = Math.min(sorted.length - 1, Math.max(7, Math.floor(sorted.length * 0.2)));
      sharedThreshold = Math.max(3, sorted[topCutIdx]);
    }

    // Identify top 8 non-seed hubs for clean overview labeling in Auto mode
    const topHubIds = new Set(
      Array.from(this.store.nodes.entries())
        .filter(([, n]) => !n.is_seed)
        .sort((a, b) => (inDeg.get(b[0]) ?? 0) - (inDeg.get(a[0]) ?? 0))
        .filter(([id]) => (inDeg.get(id) ?? 0) >= 2)
        .slice(0, 8)
        .map(([id]) => id)
    );

    this.cy.batch(() => {
      this.cy.elements().remove();

      const visibleIds = new Set<string>();
      for (const [id, node] of this.store.nodes.entries()) {
        if (this.store.hiddenIds.has(id)) continue;
        const deg = inDeg.get(id) ?? 0;
        const isShared = deg >= sharedThreshold && !node.is_seed;

        // Relevance filter
        if (!node.is_seed) {
          if (filters.relevance === "shared" && deg < 2) continue;
          if (filters.relevance === "highly-connected" && !isShared) continue;
        }

        // Citation direction filter (cites only vs cited-by only)
        if (directionalAllowed && !directionalAllowed.has(id)) continue;

        // Exploration depth filter (hops from seed)
        if (hopDist && !node.is_seed) {
          const d = hopDist.get(id);
          if (d === undefined || d > maxHops) continue;
        }

        // Publication year range filter
        if (!node.is_seed && (filters.minYear !== null || filters.maxYear !== null)) {
          if (node.year === null) continue;
          if (filters.minYear !== null && node.year < filters.minYear) continue;
          if (filters.maxYear !== null && node.year > filters.maxYear) continue;
        }

        // Min global citations filter
        if (!node.is_seed && filters.minCitations > 0) {
          if ((node.cited_by_count ?? 0) < filters.minCitations) continue;
        }

        // Topic / community filter
        if (!node.is_seed && filters.topic) {
          if (!(node.topics ?? []).includes(filters.topic)) continue;
        }

        visibleIds.add(id);

        let size: number;
        if (node.is_seed) {
          size = 36;
        } else if (filters.sizeBy === "citations") {
          const logCites = Math.log10((node.cited_by_count ?? 0) + 1);
          size = Math.round(Math.min(34, Math.max(14, 12 + logCites * 4.2)));
        } else {
          size = isShared
            ? Math.min(36, 22 + Math.min(deg, 7) * 2)
            : deg >= 2
              ? 19
              : 14;
        }
        const classes = ["paper"];
        if (node.is_seed) {
          classes.push("seed");
          if (id === this.store.primarySeedId) classes.push("primary-seed");
        } else if (isShared) {
          classes.push("shared");
        }
        if (topHubIds.has(id)) {
          classes.push("top-hub");
        }
        if ((node.is_expanded || node.is_cited_by_expanded) && !node.is_seed) {
          classes.push("expanded");
        }

        const fullLabel = formatFullLabel(node);
        const compactLabel = formatCompactLabel(node);
        const nodeData: Record<string, unknown> = {
          id,
          fullLabel,
          compactLabel,
          displayLabel: compactLabel,
          size,
          inDegree: deg,
          year: node.year ?? null,
        };
        const expColor = this.store.expansionColorByPaper.get(id);
        if (expColor) nodeData.expansionColor = expColor;

        this.cy.add({ group: "nodes", data: nodeData, classes: classes.join(" ") });
      }

      for (const key of this.store.edges) {
        const [source, target] = key.split("->");
        if (visibleIds.has(source) && visibleIds.has(target)) {
          const edgeData: Record<string, unknown> = { id: key, source, target };
          const c = this.store.edgeColors.get(key);
          if (c) edgeData.edgeColor = c;
          let edgeClass = "";
          if (!c && this.store.primarySeedId !== null) {
            if (source === this.store.primarySeedId) edgeClass = "primary-cites";
            else if (target === this.store.primarySeedId) edgeClass = "primary-cited-by";
          }
          this.cy.add({
            group: "edges",
            data: edgeData,
            classes: edgeClass,
          });
        }
      }
    });

    this.applyLayout();
    this.applySearchHighlight(searchQuery);
  }

  updateLabelVisibility(): void {
    const isTimeline = this.layoutMode === "timeline";
    const paperNodes = this.cy.nodes(".paper").not(".ego-hidden");
    const total = paperNodes.length;
    const zoom = this.cy.zoom();

    this.cy.batch(() => {
      if (this.labelMode !== "auto" || isTimeline) {
        paperNodes.forEach((ele) => {
          const isSeed = ele.hasClass("seed");
          ele.toggleClass("timeline-node", isTimeline);
          if (this.labelMode === "full") {
            ele.data("displayLabel", ele.data("fullLabel"));
            ele.removeClass("hide-label");
          } else if (this.labelMode === "compact") {
            ele.data("displayLabel", ele.data("compactLabel"));
            ele.removeClass("hide-label");
          } else if (this.labelMode === "hover") {
            ele.data("displayLabel", isSeed ? ele.data("fullLabel") : ele.data("compactLabel"));
            ele.toggleClass("hide-label", !isSeed);
          } else {
            // Timeline Auto
            ele.data("displayLabel", isSeed ? ele.data("fullLabel") : ele.data("compactLabel"));
            ele.removeClass("hide-label");
          }
        });
        return;
      }

      // Auto mode: screen-space collision-free labeling prioritized by importance
      const sorted = (paperNodes.toArray() as NodeSingular[]).sort((a, b) => {
        const prio = (n: NodeSingular): number => {
          if (n.hasClass("primary-seed")) return 4;
          if (n.hasClass("seed")) return 3;
          if (n.hasClass("top-hub")) return 2;
          if (n.hasClass("shared")) return 1;
          return 0;
        };
        const dp = prio(b) - prio(a);
        if (dp !== 0) return dp;
        return ((b.data("inDegree") as number) ?? 0) - ((a.data("inDegree") as number) ?? 0);
      });

      const placedBoxes: Array<{ x1: number; y1: number; x2: number; y2: number }> = [];
      const pad = 6;

      for (const ele of sorted) {
        ele.removeClass("timeline-node");
        const isSeed = ele.hasClass("seed");
        const isTopHub = ele.hasClass("top-hub");
        const label = isSeed ? String(ele.data("fullLabel") ?? "") : String(ele.data("compactLabel") ?? "");
        ele.data("displayLabel", label);

        // At overview zoom on dense graphs, only consider seeds + top hubs + shared;
        // as user zooms in, all nodes become eligible if their label doesn't collide.
        const eligible = isSeed || isTopHub || total <= 18 || zoom >= 0.85;
        if (!eligible) {
          ele.addClass("hide-label");
          continue;
        }

        const rp = ele.renderedPosition();
        const rRadius = (((ele.data("size") as number) ?? 18) * zoom) / 2;
        const approxW = Math.min(138, Math.max(68, label.length * 5.2));
        const approxH = label.length > 22 ? 32 : 18;
        const box = {
          x1: rp.x - approxW / 2 - pad,
          y1: rp.y + rRadius + 2,
          x2: rp.x + approxW / 2 + pad,
          y2: rp.y + rRadius + 2 + approxH + pad,
        };

        const overlaps =
          !isSeed &&
          placedBoxes.some(
            (b) => !(box.x2 < b.x1 || box.x1 > b.x2 || box.y2 < b.y1 || box.y1 > b.y2)
          );

        if (overlaps) {
          ele.addClass("hide-label");
        } else {
          ele.removeClass("hide-label");
          placedBoxes.push(box);
        }
      }
    });
  }

  private resolveNodeOverlaps(): void {
    const nodes = this.cy.nodes(".paper").not(".ego-hidden").toArray() as NodeSingular[];
    if (nodes.length < 2) return;

    const coords = nodes.map((n) => {
      const p = n.position();
      const size = (n.data("size") as number) ?? 18;
      const isHub = n.hasClass("seed") || n.hasClass("shared") || n.hasClass("top-hub");
      return { node: n, x: p.x, y: p.y, r: size / 2 + (isHub ? 26 : 16) };
    });

    for (let iter = 0; iter < 45; iter += 1) {
      let moved = false;
      for (let i = 0; i < coords.length; i += 1) {
        const a = coords[i];
        for (let j = i + 1; j < coords.length; j += 1) {
          const b = coords[j];
          let dx = b.x - a.x;
          let dy = b.y - a.y;
          let dist = Math.hypot(dx, dy);
          const minDist = a.r + b.r;
          if (dist < minDist) {
            if (dist < 0.01) {
              const angle = ((i * 7 + j * 13) % 360) * (Math.PI / 180);
              dx = Math.cos(angle);
              dy = Math.sin(angle);
              dist = 1;
            }
            const push = (minDist - dist) * 0.55;
            const ux = dx / dist;
            const uy = dy / dist;
            a.x -= ux * push;
            a.y -= uy * push;
            b.x += ux * push;
            b.y += uy * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }

    this.cy.batch(() => {
      for (const item of coords) {
        item.node.position({ x: item.x, y: item.y });
      }
    });
  }

  applySearchHighlight(rawQuery: string): void {
    const query = rawQuery.trim().toLowerCase();
    this.cy.nodes(".paper").removeClass("search-hit");
    if (!query) return;

    this.cy.nodes(".paper").forEach((ele) => {
      const node = this.store.nodes.get(ele.id());
      if (!node) return;
      const haystack = `${node.title} ${node.authors.join(" ")} ${node.year ?? ""} ${node.venue ?? ""}`.toLowerCase();
      if (haystack.includes(query)) ele.addClass("search-hit");
    });
  }

  focusNode(nodeId: string): void {
    const ele = this.cy.getElementById(nodeId);
    if (ele.nonempty()) {
      this.cy.elements().unselect();
      ele.select();
      this.cy.animate({ center: { eles: ele } }, { duration: 240 });
    }
  }

  fit(): void {
    this.cy.fit(undefined, 56);
    this.updateLabelVisibility();
  }

  highlightPath(nodeIds: string[], edgeKeys: string[]): void {
    this.clearPathHighlight();
    const nodeSet = new Set(nodeIds);
    const edgeSet = new Set(edgeKeys);
    const pathEles = this.cy.collection();

    this.cy.batch(() => {
      this.cy.elements(".paper, edge").addClass("path-dimmed");
      this.cy.nodes(".paper").forEach((n) => {
        if (nodeSet.has(n.id())) {
          n.removeClass("path-dimmed").addClass("path-active");
          pathEles.merge(n);
        }
      });
      this.cy.edges().forEach((e) => {
        if (edgeSet.has(e.id())) {
          e.removeClass("path-dimmed").addClass("path-active");
          pathEles.merge(e);
        }
      });
    });

    if (pathEles.nonempty()) {
      this.cy.animate({ fit: { eles: pathEles, padding: 80 } }, { duration: 320 });
    }
  }

  clearPathHighlight(): void {
    this.cy.elements().removeClass("path-dimmed path-active");
  }

  private applyTimelineLayout(): void {
    this.cy.nodes(".year-header").remove();
    const paperNodes = this.cy.nodes(".paper");
    if (paperNodes.length === 0) return;

    const byYear = new Map<number, NodeSingular[]>();
    const unknown: NodeSingular[] = [];
    paperNodes.forEach((ele) => {
      const y = ele.data("year") as number | null;
      if (typeof y === "number" && !Number.isNaN(y)) {
        const list = byYear.get(y) ?? [];
        list.push(ele);
        byYear.set(y, list);
      } else {
        unknown.push(ele);
      }
    });

    const sortedYears = Array.from(byYear.keys()).sort((a, b) => a - b);
    const columns: Array<{ label: string; nodes: NodeSingular[] }> = [];
    if (unknown.length > 0) columns.push({ label: "Unknown", nodes: unknown });
    for (const yr of sortedYears) {
      columns.push({ label: String(yr), nodes: byYear.get(yr)! });
    }

    const colSpacing = 275;
    const rowSpacing = 62;
    const positions: Record<string, { x: number; y: number }> = {};
    let maxColHeight = 0;

    columns.forEach((col, colIdx) => {
      col.nodes.sort((a, b) => {
        const na = this.store.nodes.get(a.id());
        const nb = this.store.nodes.get(b.id());
        const seedDiff = Number(Boolean(nb?.is_seed)) - Number(Boolean(na?.is_seed));
        if (seedDiff !== 0) return seedDiff;
        const degDiff = ((b.data("inDegree") as number) ?? 0) - ((a.data("inDegree") as number) ?? 0);
        if (degDiff !== 0) return degDiff;
        return (na?.title ?? "").localeCompare(nb?.title ?? "");
      });

      const height = (col.nodes.length - 1) * rowSpacing;
      if (height > maxColHeight) maxColHeight = height;

      const x = colIdx * colSpacing;
      const startY = -height / 2;
      col.nodes.forEach((ele, rowIdx) => {
        positions[ele.id()] = { x, y: startY + rowIdx * rowSpacing };
      });
    });

    const headerY = -maxColHeight / 2 - 68;
    columns.forEach((col, colIdx) => {
      const headerId = `__year_hdr_${colIdx}`;
      this.cy.add({
        group: "nodes",
        data: { id: headerId, label: col.label },
        position: { x: colIdx * colSpacing, y: headerY },
        selectable: false,
        grabbable: false,
        classes: "year-header",
      });
      positions[headerId] = { x: colIdx * colSpacing, y: headerY };
    });

    this.cy
      .layout({
        name: "preset",
        positions,
        animate: true,
        animationDuration: 400,
        fit: true,
        padding: 56,
        stop: () => this.updateLabelVisibility(),
      })
      .run();
  }

  private applyEgoLayout(): void {
    this.cy.nodes(".year-header").remove();
    const paperNodes = this.cy.nodes(".paper");
    if (paperNodes.length === 0) return;

    const centerId =
      (this.store.selectedId && this.cy.getElementById(this.store.selectedId).nonempty()
        ? this.store.selectedId
        : null) ??
      (this.store.primarySeedId && this.cy.getElementById(this.store.primarySeedId).nonempty()
        ? this.store.primarySeedId
        : null) ??
      paperNodes[0].id();

    const centerEle = this.cy.getElementById(centerId) as NodeSingular;
    const ring1 = centerEle.neighborhood("node.paper");
    const ring1Ids = new Set<string>(ring1.map((n) => n.id()));
    const ring2 = ring1
      .neighborhood("node.paper")
      .filter((n) => n.id() !== centerId && !ring1Ids.has(n.id()));

    const keepIds = new Set<string>([centerId, ...ring1Ids, ...ring2.map((n) => n.id())]);

    this.cy.batch(() => {
      this.cy.elements().removeClass("ego-hidden ego-center");
      centerEle.addClass("ego-center");
      this.cy.nodes(".paper").forEach((n) => {
        if (!keepIds.has(n.id())) n.addClass("ego-hidden");
      });
      this.cy.edges().forEach((e) => {
        if (!keepIds.has(e.source().id()) || !keepIds.has(e.target().id())) {
          e.addClass("ego-hidden");
        }
      });
    });

    const positions: Record<string, { x: number; y: number }> = {
      [centerId]: { x: 0, y: 0 },
    };

    const placeRing = (nodes: cytoscape.NodeCollection, baseRadius: number, minArc: number): number => {
      const list = nodes.toArray().sort((a, b) => {
        const ya = (a.data("year") as number | null) ?? 0;
        const yb = (b.data("year") as number | null) ?? 0;
        if (ya !== yb) return ya - yb;
        return String(a.data("fullLabel") ?? "").localeCompare(String(b.data("fullLabel") ?? ""));
      });
      if (list.length === 0) return baseRadius;
      const radius = Math.max(baseRadius, (list.length * minArc) / (2 * Math.PI));
      const step = (2 * Math.PI) / list.length;
      list.forEach((ele, idx) => {
        const theta = -Math.PI / 2 + idx * step;
        positions[ele.id()] = {
          x: Math.cos(theta) * radius,
          y: Math.sin(theta) * radius,
        };
      });
      return radius;
    };

    const r1 = placeRing(ring1, 210, 74);
    placeRing(ring2, Math.max(390, r1 + 170), 68);

    const visibleEles = this.cy.elements().not(".ego-hidden");
    visibleEles
      .layout({
        name: "preset",
        positions,
        animate: true,
        animationDuration: 400,
        fit: true,
        padding: 64,
        stop: () => this.updateLabelVisibility(),
      })
      .run();
  }

  applyLayout(_randomize = false): void {
    const paperNodes = this.cy.nodes(".paper");
    if (paperNodes.length === 0) return;

    if (this.layoutMode === "ego") {
      this.applyEgoLayout();
      return;
    }

    // Restore any nodes hidden by ego-network mode
    this.cy.elements().removeClass("ego-hidden ego-center");

    if (this.layoutMode === "timeline") {
      this.applyTimelineLayout();
      return;
    }

    this.cy.nodes(".year-header").remove();

    if (this.layoutMode === "flow") {
      const elkOptions = {
        name: "elk",
        animate: true,
        animationDuration: 420,
        fit: true,
        padding: 64,
        elk: {
          algorithm: "layered",
          "elk.direction": "LEFT",
          "elk.spacing.nodeNode": 42,
          "elk.layered.spacing.nodeNodeBetweenLayers": 115,
          "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
          "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
        },
        stop: () => this.updateLabelVisibility(),
      } as unknown as LayoutOptions;
      this.cy.layout(elkOptions).run();
      return;
    }

    // Default: Community-aware force-directed clustering (fCoSE)
    const fcoseOptions = {
      name: "fcose",
      quality: "proof",
      randomize: true,
      animate: true,
      animationDuration: 460,
      fit: true,
      padding: 68,
      packComponents: true,
      nodeDimensionsIncludeLabels: true,
      nodeSeparation: 145,
      nodeRepulsion: () => 85000,
      idealEdgeLength: () => 210,
      edgeElasticity: () => 0.28,
      gravity: 0.14,
      gravityRange: 4.0,
      stop: () => {
        this.resolveNodeOverlaps();
        this.cy.fit(undefined, 56);
        this.updateLabelVisibility();
      },
    } as unknown as LayoutOptions;
    this.cy.layout(fcoseOptions).run();
  }
}
