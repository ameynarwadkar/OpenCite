import cytoscape, { type Core, type LayoutOptions, type NodeSingular } from "cytoscape";
import elk from "cytoscape-elk";
import fcose from "cytoscape-fcose";
import { formatCompactLabel, formatFullLabel, type GraphStore } from "./store";
import type { LabelMode, LayoutMode, ThemeMode } from "./types";

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
  private labelMode: LabelMode = "auto";
  private layoutMode: LayoutMode = "cose";
  private wasZoomedIn = false;
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
            "font-size": 10.5,
            "font-family": '"Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            color: "#09090b",
            "text-valign": "bottom",
            "text-halign": "center",
            "text-margin-y": 6,
            "text-wrap": "wrap",
            "text-max-width": "150px",
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
            width: 1.2,
            "line-color": "#d4d4d8",
            "target-arrow-color": "#a1a1aa",
            "target-arrow-shape": "triangle",
            "arrow-scale": 0.72,
            "curve-style": "bezier",
            opacity: 0.65,
            "z-index": 1,
          },
        },
        {
          selector: "edge[edgeColor]",
          style: {
            width: 1.85,
            "line-color": "data(edgeColor)",
            "target-arrow-color": "data(edgeColor)",
            opacity: 0.88,
            "z-index": 3,
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
      const zoomedIn = this.cy.zoom() >= 1.1;
      if (zoomedIn !== this.wasZoomedIn) {
        this.wasZoomedIn = zoomedIn;
        this.updateLabelVisibility();
      }
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
      node.addClass("hovered");
      callbacks.onHoverNode(node.id(), node.renderedPosition());
    });
    this.cy.on("mouseout", "node.paper", () => {
      this.cy.elements().removeClass("dimmed highlighted hovered");
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

  render(sharedOnly: boolean, searchQuery: string): void {
    const inDeg = this.store.computeInDegrees();

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
        if (sharedOnly && !node.is_seed && deg < 2) continue;
        visibleIds.add(id);

        const size = node.is_seed
          ? 36
          : isShared
            ? Math.min(38, 22 + Math.min(deg, 8) * 2)
            : deg >= 2
              ? 20
              : 15;
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
          this.cy.add({ group: "edges", data: edgeData });
        }
      }
    });

    this.applyLayout();
    this.applySearchHighlight(searchQuery);
  }

  updateLabelVisibility(): void {
    const isTimeline = this.layoutMode === "timeline";
    const paperNodes = this.cy.nodes(".paper");
    const total = paperNodes.length;
    const zoomedIn = this.cy.zoom() >= 1.1;

    this.cy.batch(() => {
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
          ele.data("displayLabel", isSeed ? ele.data("fullLabel") : ele.data("compactLabel"));
          const isTopHub = ele.hasClass("top-hub");
          const show = isSeed || isTopHub || isTimeline || total <= 20 || zoomedIn;
          ele.toggleClass("hide-label", !show);
        }
      });
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
      nodeSeparation: 115,
      nodeRepulsion: () => 24000,
      idealEdgeLength: () => 165,
      edgeElasticity: () => 0.35,
      gravity: 0.22,
      gravityRange: 3.8,
      stop: () => this.updateLabelVisibility(),
    } as unknown as LayoutOptions;
    this.cy.layout(fcoseOptions).run();
  }
}
