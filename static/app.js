(() => {
  // In-memory graph state
  const THEME_KEY = "citation-graph:theme";
  const HISTORY_KEY = "citation-graph:history";
  const MAX_HISTORY_ITEMS = 15;
  const MAX_UNDO_STEPS = 20;
  const EXPANSION_EDGE_PALETTE = [
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
  ];

  const state = {
    nodes: new Map(), // id -> PaperNode
    edges: new Set(), // "source->target"
    edgeColors: new Map(), // "source->target" -> hex color (for non-seed expansions)
    expansionColorByPaper: new Map(), // paperId -> hex color
    expansionColorIdx: 0,
    primarySeedId: null,
    undoStack: [],
    selectedId: null,
    activeHistoryId: null,
  };

  // DOM elements
  const themeToggle = document.getElementById("theme-toggle");
  const historyList = document.getElementById("history-list");
  const clearHistoryBtn = document.getElementById("clear-history-btn");
  const dropzone = document.getElementById("dropzone");
  const pdfInput = document.getElementById("pdf-input");
  const idInput = document.getElementById("id-input");
  const lookupBtn = document.getElementById("lookup-btn");
  const demoBtn = document.getElementById("demo-btn");
  const layoutSelect = document.getElementById("layout-select");
  const labelModeSelect = document.getElementById("label-mode-select");
  const sharedOnlyToggle = document.getElementById("shared-only-toggle");
  const searchInput = document.getElementById("search-input");
  const enrichYearsBtn = document.getElementById("enrich-years-btn");
  const undoBtn = document.getElementById("undo-btn");
  const fitBtn = document.getElementById("fit-btn");
  const exportBtn = document.getElementById("export-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusArea = document.getElementById("status-area");
  const emptyState = document.getElementById("empty-state");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingText = document.getElementById("loading-text");
  const hoverTooltip = document.getElementById("hover-tooltip");

  const statSeeds = document.getElementById("stat-seeds");
  const statNodes = document.getElementById("stat-nodes");
  const statShared = document.getElementById("stat-shared");
  const statEdges = document.getElementById("stat-edges");

  const inspector = document.getElementById("inspector");
  const inspClose = document.getElementById("insp-close");
  const inspTitle = document.getElementById("insp-title");
  const inspBadges = document.getElementById("insp-badges");
  const inspYear = document.getElementById("insp-year");
  const inspVenue = document.getElementById("insp-venue");
  const inspAuthors = document.getElementById("insp-authors");
  const inspGlobalCites = document.getElementById("insp-global-cites");
  const inspLinks = document.getElementById("insp-links");
  const expandBtn = document.getElementById("expand-btn");
  const expandCitedByBtn = document.getElementById("expand-cited-by-btn");
  const inspCitedBySection = document.getElementById("insp-cited-by-section");
  const inspCitedBy = document.getElementById("insp-cited-by");
  const inspRawSection = document.getElementById("insp-raw-section");
  const inspRaw = document.getElementById("insp-raw");

  // Initialize Cytoscape
  const cy = cytoscape({
    container: document.getElementById("cy"),
    elements: [],
    wheelSensitivity: 0.25,
    style: [
      {
        selector: "node.paper",
        style: {
          label: "data(displayLabel)",
          "font-size": 10.5,
          "font-family": "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
          color: "#1e293b",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 6,
          "text-wrap": "wrap",
          "text-max-width": 150,
          "text-background-color": "#ffffff",
          "text-background-opacity": 0.9,
          "text-background-padding": 3,
          "text-background-shape": "roundrectangle",
          "text-border-width": 0.75,
          "text-border-color": "#e2e8f0",
          "text-border-opacity": 0.9,
          "background-color": "#64748b",
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
          "text-max-width": 195,
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
          color: "#0f172a",
          "text-border-color": "#c7d2fe",
          "z-index": 12,
        },
      },
      {
        selector: "node.paper.primary-seed",
        style: {
          "background-color": "#38bdf8",
          "border-width": 3,
          "border-color": "#e0f2fe",
          "font-weight": 700,
          "font-size": 12.5,
          "text-border-color": "#7dd3fc",
          "z-index": 15,
        },
      },
      {
        selector: "node.paper.expanded:unselected",
        style: {
          "border-width": 3,
          "border-color": "#4f46e5",
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
          "text-background-opacity": 0.96,
          "text-border-opacity": 1,
          "border-width": 4,
          "border-color": "#0f172a",
          "z-index": 50,
        },
      },
      {
        selector: "node.year-header",
        style: {
          label: "data(label)",
          shape: "round-rectangle",
          width: 82,
          height: 28,
          "background-color": "#eef2ff",
          "border-width": 1,
          "border-color": "#c7d2fe",
          color: "#3730a3",
          "font-size": 12,
          "font-weight": 700,
          "text-valign": "center",
          "text-halign": "center",
          events: "no",
          "z-index": 1,
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.25,
          "line-color": "#cbd5e1",
          "target-arrow-color": "#94a3b8",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.75,
          "curve-style": "bezier",
          opacity: 0.6,
          "z-index": 1,
        },
      },
      {
        selector: "edge[edgeColor]",
        style: {
          width: 1.85,
          "line-color": "data(edgeColor)",
          "target-arrow-color": "data(edgeColor)",
          opacity: 0.85,
          "z-index": 3,
        },
      },
      {
        selector: ".dimmed",
        style: {
          opacity: 0.14,
        },
      },
      {
        selector: "node.paper.highlighted",
        style: {
          opacity: 1,
          label: "data(compactLabel)",
          "text-background-opacity": 0.95,
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
          "text-border-color": "#4f46e5",
          "text-border-opacity": 1,
          "z-index": 100,
        },
      },
      {
        selector: "edge.highlighted",
        style: {
          "line-color": "#4f46e5",
          "target-arrow-color": "#4f46e5",
          width: 2.2,
          opacity: 1,
          "z-index": 20,
        },
      },
      {
        selector: "node.search-hit",
        style: {
          label: "data(fullLabel)",
          "text-background-opacity": 0.95,
          "text-border-opacity": 1,
          "border-width": 4,
          "border-color": "#ec4899",
          "z-index": 45,
        },
      },
    ],
  });

  // Helpers
  function normalizeTitle(t) {
    return (t || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  function idPriority(id) {
    if (id.startsWith("doi:")) return 4;
    if (id.startsWith("arxiv:")) return 3;
    if (id.startsWith("openalex:")) return 2;
    return 1;
  }

  function appendYearIfMissing(text, year) {
    if (!year) return text;
    if (text.includes(String(year))) return text;
    return `${text} (${year})`;
  }

  function formatFullLabel(node) {
    const title = node.title || "Untitled";
    const truncated = title.length > 48 ? title.slice(0, 46).trimEnd() + "…" : title;
    return appendYearIfMissing(truncated, node.year);
  }

  function formatCompactLabel(node) {
    if (node.is_seed) return formatFullLabel(node);
    const title = node.title || "Untitled";
    const truncated = title.length > 28 ? title.slice(0, 26).trimEnd() + "…" : title;
    return appendYearIfMissing(truncated, node.year);
  }

  function setLoading(isLoading, text = "Processing papers...") {
    loadingText.textContent = text;
    loadingOverlay.classList.toggle("hidden", !isLoading);
  }

  function showMessages(messages, isError = false) {
    statusArea.innerHTML = "";
    for (const msg of messages) {
      const div = document.createElement("div");
      div.className = isError ? "toast error" : "toast";
      div.textContent = msg;
      statusArea.appendChild(div);
    }
  }

  function findExistingNodeId(incoming) {
    if (state.nodes.has(incoming.id)) return incoming.id;
    const normTitle = normalizeTitle(incoming.title);
    for (const [id, existing] of state.nodes.entries()) {
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

  function remapEdges(oldId, newId) {
    if (oldId === newId) return;
    const next = new Set();
    const nextColors = new Map();
    for (const key of state.edges) {
      const [s, t] = key.split("->");
      const ns = s === oldId ? newId : s;
      const nt = t === oldId ? newId : t;
      if (ns !== nt) {
        const newKey = `${ns}->${nt}`;
        next.add(newKey);
        if (state.edgeColors.has(key)) {
          nextColors.set(newKey, state.edgeColors.get(key));
        }
      }
    }
    state.edges = next;
    state.edgeColors = nextColors;
    if (state.expansionColorByPaper.has(oldId)) {
      const c = state.expansionColorByPaper.get(oldId);
      state.expansionColorByPaper.delete(oldId);
      state.expansionColorByPaper.set(newId, c);
    }
    if (state.primarySeedId === oldId) state.primarySeedId = newId;
    if (state.selectedId === oldId) state.selectedId = newId;
  }

  function getColorForExpandedPaper(paperId) {
    if (state.expansionColorByPaper.has(paperId)) {
      return state.expansionColorByPaper.get(paperId);
    }
    const color = EXPANSION_EDGE_PALETTE[state.expansionColorIdx % EXPANSION_EDGE_PALETTE.length];
    state.expansionColorIdx++;
    state.expansionColorByPaper.set(paperId, color);
    return color;
  }

  function updateUndoButton() {
    const count = state.undoStack.length;
    undoBtn.disabled = count === 0;
    if (count > 0) {
      const last = state.undoStack[count - 1];
      undoBtn.title = `${last.label} (Ctrl+Z)`;
    } else {
      undoBtn.title = "Nothing to undo";
    }
  }

  function pushUndoSnapshot(label) {
    state.undoStack.push({
      label,
      nodes: Array.from(state.nodes.entries()).map(([id, n]) => [id, { ...n, authors: [...(n.authors || [])] }]),
      edges: Array.from(state.edges),
      edgeColors: Array.from(state.edgeColors.entries()),
      expansionColorByPaper: Array.from(state.expansionColorByPaper.entries()),
      expansionColorIdx: state.expansionColorIdx,
      selectedId: state.selectedId,
    });
    if (state.undoStack.length > MAX_UNDO_STEPS) {
      state.undoStack.shift();
    }
    updateUndoButton();
  }

  function undoLastAction() {
    if (state.undoStack.length === 0) return;
    const snap = state.undoStack.pop();
    state.nodes = new Map(snap.nodes);
    state.edges = new Set(snap.edges);
    state.edgeColors = new Map(snap.edgeColors);
    state.expansionColorByPaper = new Map(snap.expansionColorByPaper);
    state.expansionColorIdx = snap.expansionColorIdx;
    state.selectedId = snap.selectedId;
    hideTooltip();
    updateUndoButton();
    renderGraph();
    saveCurrentToHistory();
    showMessages([`Reverted: ${snap.label}`]);
  }

  function mergeGraphPayload(payload, preferredOldSourceId = null, edgeColor = null) {
    const idMap = new Map();

    for (const incoming of payload.nodes || []) {
      let existingId = findExistingNodeId(incoming);
      if (!existingId && preferredOldSourceId && payload.source_id === incoming.id && state.nodes.has(preferredOldSourceId)) {
        existingId = preferredOldSourceId;
      }

      if (!existingId) {
        state.nodes.set(incoming.id, { ...incoming });
        idMap.set(incoming.id, incoming.id);
        if (incoming.is_seed && !state.primarySeedId) {
          state.primarySeedId = incoming.id;
        }
      } else {
        const existing = state.nodes.get(existingId);
        const targetId = idPriority(incoming.id) > idPriority(existing.id) ? incoming.id : existing.id;
        const merged = {
          ...existing,
          id: targetId,
          title: (!existing.title || (existing.raw_citation && !incoming.raw_citation && incoming.title))
            ? incoming.title
            : existing.title,
          authors: (existing.authors?.length || 0) >= (incoming.authors?.length || 0)
            ? existing.authors
            : incoming.authors,
          year: existing.year || incoming.year,
          venue: existing.venue || incoming.venue,
          doi: existing.doi || incoming.doi,
          arxiv_id: existing.arxiv_id || incoming.arxiv_id,
          openalex_id: existing.openalex_id || incoming.openalex_id,
          url: existing.url || incoming.url,
          raw_citation: existing.raw_citation || incoming.raw_citation,
          cited_by_count: existing.cited_by_count ?? incoming.cited_by_count ?? null,
          is_seed: Boolean(existing.is_seed || incoming.is_seed),
          is_expanded: Boolean(existing.is_expanded || incoming.is_expanded),
          is_cited_by_expanded: Boolean(existing.is_cited_by_expanded || incoming.is_cited_by_expanded),
          expandable: Boolean(existing.expandable || incoming.expandable),
        };
        if (targetId !== existingId) {
          state.nodes.delete(existingId);
          remapEdges(existingId, targetId);
        }
        state.nodes.set(targetId, merged);
        idMap.set(incoming.id, targetId);
      }
    }

    for (const edge of payload.edges || []) {
      const src = idMap.get(edge.source) || edge.source;
      const dst = idMap.get(edge.target) || edge.target;
      if (src !== dst && state.nodes.has(src) && state.nodes.has(dst)) {
        const edgeKey = `${src}->${dst}`;
        const isNew = !state.edges.has(edgeKey);
        state.edges.add(edgeKey);
        if (edgeColor && (isNew || !state.edgeColors.has(edgeKey))) {
          state.edgeColors.set(edgeKey, edgeColor);
        }
      }
    }

    renderGraph();
  }

  function computeInDegrees() {
    const inDeg = new Map();
    for (const id of state.nodes.keys()) inDeg.set(id, 0);
    for (const key of state.edges) {
      const [, dst] = key.split("->");
      inDeg.set(dst, (inDeg.get(dst) || 0) + 1);
    }
    return inDeg;
  }

  function updateLabelVisibility() {
    const mode = labelModeSelect.value;
    const isTimeline = layoutSelect.value === "timeline";
    const paperNodes = cy.nodes(".paper");
    const total = paperNodes.length;
    const zoomedIn = cy.zoom() >= 1.1;

    cy.batch(() => {
      paperNodes.forEach((ele) => {
        const isSeed = ele.hasClass("seed");
        const isShared = ele.hasClass("shared");
        const isImportant = isSeed || isShared;

        ele.toggleClass("timeline-node", isTimeline);

        if (mode === "full") {
          ele.data("displayLabel", ele.data("fullLabel"));
          ele.removeClass("hide-label");
        } else if (mode === "compact") {
          ele.data("displayLabel", ele.data("compactLabel"));
          ele.removeClass("hide-label");
        } else if (mode === "hover") {
          ele.data("displayLabel", isSeed ? ele.data("fullLabel") : ele.data("compactLabel"));
          ele.toggleClass("hide-label", !isSeed);
        } else {
          // Clean (Auto): always show seeds, shared, timeline nodes, small graphs, or when zoomed in
          ele.data("displayLabel", isSeed ? ele.data("fullLabel") : ele.data("compactLabel"));
          const show = isImportant || isTimeline || total <= 20 || zoomedIn;
          ele.toggleClass("hide-label", !show);
        }
      });
    });
  }

  function renderGraph() {
    const inDeg = computeInDegrees();
    const sharedOnly = sharedOnlyToggle.checked;

    cy.batch(() => {
      cy.elements().remove();

      const visibleIds = new Set();
      for (const [id, node] of state.nodes.entries()) {
        const deg = inDeg.get(id) || 0;
        const isShared = deg >= 2 && !node.is_seed;
        if (sharedOnly && !node.is_seed && !isShared) continue;
        visibleIds.add(id);

        const size = node.is_seed
          ? 38
          : isShared
            ? Math.min(42, 24 + deg * 4)
            : 18;

        const classes = ["paper"];
        if (node.is_seed) {
          classes.push("seed");
          if (id === state.primarySeedId) classes.push("primary-seed");
        } else if (isShared) {
          classes.push("shared");
        }
        if ((node.is_expanded || node.is_cited_by_expanded) && !node.is_seed) {
          classes.push("expanded");
        }

        const fullLabel = formatFullLabel(node);
        const compactLabel = formatCompactLabel(node);
        const nodeData = {
          id,
          fullLabel,
          compactLabel,
          displayLabel: compactLabel,
          size,
          inDegree: deg,
          year: node.year ?? null,
        };
        if (state.expansionColorByPaper.has(id)) {
          nodeData.expansionColor = state.expansionColorByPaper.get(id);
        }

        cy.add({
          group: "nodes",
          data: nodeData,
          classes: classes.join(" "),
        });
      }

      for (const key of state.edges) {
        const [source, target] = key.split("->");
        if (visibleIds.has(source) && visibleIds.has(target)) {
          const edgeData = { id: key, source, target };
          if (state.edgeColors.has(key)) {
            edgeData.edgeColor = state.edgeColors.get(key);
          }
          cy.add({
            group: "edges",
            data: edgeData,
          });
        }
      }
    });

    updateStats(inDeg);
    emptyState.classList.toggle("hidden", state.nodes.size > 0);
    applyLayout();
    applySearchHighlight();

    if (state.selectedId && state.nodes.has(state.selectedId)) {
      openInspector(state.selectedId);
    } else {
      closeInspector();
    }
  }

  function updateStats(inDeg) {
    let seeds = 0;
    let shared = 0;
    let unknownYears = 0;
    for (const [id, node] of state.nodes.entries()) {
      if (node.is_seed) seeds++;
      else if ((inDeg.get(id) || 0) >= 2) shared++;
      if (!node.year) unknownYears++;
    }
    statSeeds.textContent = String(seeds);
    statNodes.textContent = String(state.nodes.size);
    statShared.textContent = String(shared);
    statEdges.textContent = String(state.edges.size);

    if (unknownYears > 0) {
      enrichYearsBtn.textContent = `Resolve Unknown Years (${unknownYears})`;
      enrichYearsBtn.classList.remove("hidden");
    } else {
      enrichYearsBtn.classList.add("hidden");
    }
  }

  function applyTimelineLayout() {
    cy.nodes(".year-header").remove();
    const paperNodes = cy.nodes(".paper");
    if (paperNodes.length === 0) return;

    const byYear = new Map();
    const unknown = [];
    paperNodes.forEach((ele) => {
      const y = ele.data("year");
      if (typeof y === "number" && !Number.isNaN(y)) {
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(ele);
      } else {
        unknown.push(ele);
      }
    });

    const sortedYears = Array.from(byYear.keys()).sort((a, b) => a - b);
    const columns = [];
    if (unknown.length > 0) {
      columns.push({ label: "Unknown", nodes: unknown });
    }
    for (const yr of sortedYears) {
      columns.push({ label: String(yr), nodes: byYear.get(yr) });
    }

    const colSpacing = 275;
    const rowSpacing = 62;
    const positions = {};
    let maxColHeight = 0;

    columns.forEach((col, colIdx) => {
      col.nodes.sort((a, b) => {
        const na = state.nodes.get(a.id());
        const nb = state.nodes.get(b.id());
        const seedDiff = Number(Boolean(nb?.is_seed)) - Number(Boolean(na?.is_seed));
        if (seedDiff !== 0) return seedDiff;
        const degDiff = (b.data("inDegree") || 0) - (a.data("inDegree") || 0);
        if (degDiff !== 0) return degDiff;
        return (na?.title || "").localeCompare(nb?.title || "");
      });

      const height = (col.nodes.length - 1) * rowSpacing;
      if (height > maxColHeight) maxColHeight = height;

      const x = colIdx * colSpacing;
      const startY = -height / 2;
      col.nodes.forEach((ele, rowIdx) => {
        positions[ele.id()] = { x, y: startY + rowIdx * rowSpacing };
      });
    });

    const headerY = -maxColHeight / 2 - 70;
    columns.forEach((col, colIdx) => {
      const headerId = `__year_hdr_${colIdx}`;
      cy.add({
        group: "nodes",
        data: { id: headerId, label: col.label },
        position: { x: colIdx * colSpacing, y: headerY },
        selectable: false,
        grabbable: false,
        classes: "year-header",
      });
      positions[headerId] = { x: colIdx * colSpacing, y: headerY };
    });

    cy.layout({
      name: "preset",
      positions: (node) => positions[node.id()],
      animate: true,
      animationDuration: 420,
      fit: true,
      padding: 56,
      stop: () => updateLabelVisibility(),
    }).run();
  }

  function applyCleanStarRadialLayout(seedEle, leafEles) {
    // Arrange a 1-seed star graph in clean, non-overlapping concentric rings sorted by year
    const sortedLeaves = leafEles.toArray().sort((a, b) => {
      const ya = a.data("year") ?? 0;
      const yb = b.data("year") ?? 0;
      if (ya !== yb) return ya - yb;
      return (a.data("fullLabel") || "").localeCompare(b.data("fullLabel") || "");
    });

    const positions = {};
    positions[seedEle.id()] = { x: 0, y: 0 };

    // Distribute across rings so every node has generous arc spacing
    const minArcSpacing = 96;
    let remaining = sortedLeaves.slice();
    let ringIdx = 0;

    while (remaining.length > 0) {
      const radius = 190 + ringIdx * 135;
      const capacity = Math.max(10, Math.floor((2 * Math.PI * radius) / minArcSpacing));
      const ringNodes = remaining.splice(0, capacity);
      const angleStep = (2 * Math.PI) / ringNodes.length;
      const angleOffset = (ringIdx % 2) * (angleStep / 2) - Math.PI / 2;

      ringNodes.forEach((ele, i) => {
        const theta = angleOffset + i * angleStep;
        positions[ele.id()] = {
          x: Math.cos(theta) * radius,
          y: Math.sin(theta) * radius,
        };
      });
      ringIdx++;
    }

    cy.layout({
      name: "preset",
      positions: (node) => positions[node.id()],
      animate: true,
      animationDuration: 420,
      fit: true,
      padding: 64,
      stop: () => updateLabelVisibility(),
    }).run();
  }

  function applyLayout() {
    const mode = layoutSelect.value;
    const paperNodes = cy.nodes(".paper");
    if (paperNodes.length === 0) return;

    if (mode === "timeline") {
      applyTimelineLayout();
      return;
    }

    cy.nodes(".year-header").remove();

    // If this is a pure 1-seed star graph in force-directed mode, use clean radial rings
    if (mode === "cose") {
      const seeds = cy.nodes(".paper.seed");
      const expanded = cy.nodes(".paper.expanded");
      if (seeds.length === 1 && expanded.length === 0 && paperNodes.length > 8) {
        applyCleanStarRadialLayout(seeds[0], paperNodes.not(seeds[0]));
        return;
      }
    }

    const opts = {
      cose: {
        name: "cose",
        animate: true,
        animationDuration: 450,
        padding: 64,
        nodeRepulsion: () => 260000,
        idealEdgeLength: () => 210,
        nodeOverlap: 60,
        gravity: 0.22,
        numIter: 1200,
        stop: () => updateLabelVisibility(),
      },
      breadthfirst: {
        name: "breadthfirst",
        directed: true,
        spacingFactor: 1.65,
        avoidOverlap: true,
        animate: true,
        animationDuration: 400,
        padding: 64,
        stop: () => updateLabelVisibility(),
      },
      concentric: {
        name: "concentric",
        concentric: (node) => (node.hasClass("seed") ? 100 : (node.data("inDegree") || 0) * 10 + 1),
        levelWidth: () => 2,
        minNodeSpacing: 85,
        avoidOverlap: true,
        animate: true,
        animationDuration: 400,
        padding: 64,
        stop: () => updateLabelVisibility(),
      },
    };

    cy.layout(opts[mode] || opts.cose).run();
  }

  function applySearchHighlight() {
    const query = searchInput.value.trim().toLowerCase();
    cy.nodes(".paper").removeClass("search-hit");
    if (!query) return;

    cy.nodes(".paper").forEach((ele) => {
      const node = state.nodes.get(ele.id());
      if (!node) return;
      const haystack = `${node.title || ""} ${(node.authors || []).join(" ")} ${node.year || ""} ${node.venue || ""}`.toLowerCase();
      if (haystack.includes(query)) {
        ele.addClass("search-hit");
      }
    });
  }

  // Hover tooltip
  function showTooltip(nodeId, renderedPos) {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    const authors = node.authors?.length
      ? node.authors.slice(0, 3).join(", ") + (node.authors.length > 3 ? " et al." : "")
      : "";
    const metaParts = [authors, node.year, node.venue].filter(Boolean);

    hoverTooltip.innerHTML = "";
    const titleEl = document.createElement("div");
    titleEl.className = "tt-title";
    titleEl.textContent = node.title || "Untitled Paper";
    hoverTooltip.appendChild(titleEl);

    if (metaParts.length) {
      const metaEl = document.createElement("div");
      metaEl.className = "tt-meta";
      metaEl.textContent = metaParts.join(" · ");
      hoverTooltip.appendChild(metaEl);
    }

    const wrap = cy.container().getBoundingClientRect();
    let left = renderedPos.x + 18;
    let top = renderedPos.y - 12;
    if (left + 330 > wrap.width) left = Math.max(12, renderedPos.x - 338);
    if (top + 90 > wrap.height) top = Math.max(12, renderedPos.y - 84);

    hoverTooltip.style.left = `${left}px`;
    hoverTooltip.style.top = `${top}px`;
    hoverTooltip.classList.remove("hidden");
  }

  function hideTooltip() {
    hoverTooltip.classList.add("hidden");
  }

  // Inspector
  function openInspector(nodeId) {
    const node = state.nodes.get(nodeId);
    if (!node) return;
    state.selectedId = nodeId;

    const inDeg = computeInDegrees().get(nodeId) || 0;
    inspTitle.textContent = node.title || "Untitled Paper";
    inspYear.textContent = node.year ? String(node.year) : "Unknown";
    inspVenue.textContent = node.venue || "—";
    inspAuthors.textContent = node.authors?.length ? node.authors.join(", ") : "—";
    inspGlobalCites.textContent =
      typeof node.cited_by_count === "number" ? node.cited_by_count.toLocaleString() : "—";

    inspBadges.innerHTML = "";
    if (node.is_seed) {
      inspBadges.innerHTML += `<span class="badge badge-seed">Seed Paper</span>`;
    }
    if (inDeg >= 2) {
      inspBadges.innerHTML += `<span class="badge badge-shared">Shared · ${inDeg} cites</span>`;
    }
    if (node.is_expanded) {
      inspBadges.innerHTML += `<span class="badge badge-expanded">Expanded</span>`;
    }

    inspLinks.innerHTML = "";
    const links = [];
    if (node.doi) links.push({ label: "DOI", href: `https://doi.org/${node.doi}` });
    if (node.arxiv_id) links.push({ label: "arXiv", href: `https://arxiv.org/abs/${node.arxiv_id}` });
    if (node.openalex_id) links.push({ label: "OpenAlex", href: `https://openalex.org/${node.openalex_id}` });
    if (links.length === 0 && node.url) links.push({ label: "Link", href: node.url });

    for (const l of links) {
      const a = document.createElement("a");
      a.className = "ext-link";
      a.href = l.href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = `${l.label} ↗`;
      inspLinks.appendChild(a);
    }

    if (node.is_expanded) {
      expandBtn.textContent = "References Expanded";
      expandBtn.disabled = true;
    } else {
      expandBtn.textContent = "Expand References (← older)";
      expandBtn.disabled = !node.expandable;
    }

    if (node.is_cited_by_expanded) {
      expandCitedByBtn.textContent = "Cited By Expanded";
      expandCitedByBtn.disabled = true;
    } else {
      expandCitedByBtn.textContent = "Expand Cited By (→ newer)";
      expandCitedByBtn.disabled = !node.expandable;
    }

    const citers = [];
    for (const key of state.edges) {
      const [src, dst] = key.split("->");
      if (dst === nodeId && state.nodes.has(src)) {
        citers.push(state.nodes.get(src));
      }
    }
    inspCitedBy.innerHTML = "";
    if (citers.length > 0) {
      inspCitedBySection.classList.remove("hidden");
      for (const citer of citers) {
        const li = document.createElement("li");
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = formatFullLabel(citer);
        btn.addEventListener("click", () => {
          const ele = cy.getElementById(citer.id);
          if (ele.nonempty()) {
            cy.elements().unselect();
            ele.select();
            cy.animate({ center: { eles: ele } }, { duration: 250 });
          }
          openInspector(citer.id);
        });
        li.appendChild(btn);
        inspCitedBy.appendChild(li);
      }
    } else {
      inspCitedBySection.classList.add("hidden");
    }

    if (node.raw_citation) {
      inspRawSection.classList.remove("hidden");
      inspRaw.textContent = node.raw_citation;
    } else {
      inspRawSection.classList.add("hidden");
    }

    inspector.classList.remove("hidden");
  }

  function closeInspector() {
    state.selectedId = null;
    inspector.classList.add("hidden");
  }

  // Theme (Light / Dark)
  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle.textContent = isDark ? "☀️" : "🌙";
    themeToggle.title = isDark ? "Switch to light mode" : "Switch to dark mode";
    try {
      localStorage.setItem(THEME_KEY, isDark ? "dark" : "light");
    } catch (_) {}

    cy.style()
      .selector("node.paper")
      .style({
        color: isDark ? "#e2e8f0" : "#1e293b",
        "text-background-color": isDark ? "#111827" : "#ffffff",
        "text-border-color": isDark ? "#334155" : "#e2e8f0",
        "border-color": isDark ? "#0b1120" : "#ffffff",
      })
      .selector("node.paper.seed")
      .style({
        color: isDark ? "#f8fafc" : "#0f172a",
        "text-border-color": isDark ? "#818cf8" : "#c7d2fe",
      })
      .selector("node.paper.primary-seed")
      .style({
        "background-color": "#38bdf8",
        "border-color": isDark ? "#bae6fd" : "#0284c7",
        "text-border-color": isDark ? "#38bdf8" : "#0284c7",
      })
      .selector("node.paper:selected")
      .style({
        "border-color": isDark ? "#f8fafc" : "#0f172a",
      })
      .selector("node.year-header")
      .style({
        "background-color": isDark ? "#1e293b" : "#eef2ff",
        "border-color": isDark ? "#4f46e5" : "#c7d2fe",
        color: isDark ? "#c7d2fe" : "#3730a3",
      })
      .selector("edge")
      .style({
        "line-color": isDark ? "#334155" : "#cbd5e1",
        "target-arrow-color": isDark ? "#475569" : "#94a3b8",
      })
      .selector("edge[edgeColor]")
      .style({
        "line-color": "data(edgeColor)",
        "target-arrow-color": "data(edgeColor)",
      })
      .selector("edge.highlighted")
      .style({
        "line-color": isDark ? "#818cf8" : "#4f46e5",
        "target-arrow-color": isDark ? "#818cf8" : "#4f46e5",
      })
      .update();
  }

  // History (localStorage)
  function readHistory() {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function writeHistory(items) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY_ITEMS)));
    } catch (_) {
      // If quota exceeded, trim oldest entries and retry once
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 5)));
      } catch (_) {}
    }
  }

  function buildHistoryTitle() {
    const seeds = Array.from(state.nodes.values()).filter((n) => n.is_seed);
    if (seeds.length === 0) return "Citation Graph";
    const first = seeds[0].title || "Untitled Paper";
    return seeds.length === 1 ? first : `${first} + ${seeds.length - 1} more`;
  }

  function saveCurrentToHistory() {
    if (state.nodes.size === 0) return;
    const items = readHistory();
    const id = state.activeHistoryId || `h_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    state.activeHistoryId = id;

    const entry = {
      id,
      title: buildHistoryTitle(),
      savedAt: Date.now(),
      nodeCount: state.nodes.size,
      edgeCount: state.edges.size,
      layout: layoutSelect.value,
      nodes: Array.from(state.nodes.values()),
      edges: Array.from(state.edges).map((k) => {
        const [source, target] = k.split("->");
        return { source, target };
      }),
      edgeColors: Array.from(state.edgeColors.entries()),
      expansionColorByPaper: Array.from(state.expansionColorByPaper.entries()),
      expansionColorIdx: state.expansionColorIdx,
    };

    const filtered = items.filter((item) => item.id !== id);
    filtered.unshift(entry);
    writeHistory(filtered);
    renderHistory();
  }

  function formatTimeAgo(ts) {
    const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return new Date(ts).toLocaleDateString();
  }

  function restoreHistoryItem(id) {
    const item = readHistory().find((h) => h.id === id);
    if (!item) return;

    state.nodes.clear();
    state.edges.clear();
    state.edgeColors = new Map(item.edgeColors || []);
    state.expansionColorByPaper = new Map(item.expansionColorByPaper || []);
    state.expansionColorIdx = item.expansionColorIdx || state.expansionColorByPaper.size;
    state.primarySeedId = (item.nodes || []).find((n) => n.is_seed)?.id || null;
    state.undoStack = [];
    state.selectedId = null;
    state.activeHistoryId = item.id;
    updateUndoButton();
    hideTooltip();
    showMessages([]);

    for (const node of item.nodes || []) {
      state.nodes.set(node.id, { ...node });
    }
    for (const edge of item.edges || []) {
      if (state.nodes.has(edge.source) && state.nodes.has(edge.target)) {
        state.edges.add(`${edge.source}->${edge.target}`);
      }
    }
    if (item.layout) {
      layoutSelect.value = item.layout;
    }
    renderGraph();
    renderHistory();
  }

  function deleteHistoryItem(id) {
    const next = readHistory().filter((h) => h.id !== id);
    if (state.activeHistoryId === id) state.activeHistoryId = null;
    writeHistory(next);
    renderHistory();
  }

  function renderHistory() {
    const items = readHistory();
    historyList.innerHTML = "";
    if (items.length === 0) {
      const li = document.createElement("li");
      li.className = "history-empty";
      li.textContent = "No recent graphs yet.";
      historyList.appendChild(li);
      return;
    }

    for (const item of items) {
      const li = document.createElement("li");
      li.className = "history-item" + (item.id === state.activeHistoryId ? " active" : "");

      const loadBtn = document.createElement("button");
      loadBtn.type = "button";
      loadBtn.className = "history-load-btn";
      loadBtn.title = item.title;
      loadBtn.addEventListener("click", () => restoreHistoryItem(item.id));

      const titleSpan = document.createElement("span");
      titleSpan.className = "history-title";
      titleSpan.textContent = item.title;

      const metaSpan = document.createElement("span");
      metaSpan.className = "history-meta";
      metaSpan.textContent = `${item.nodeCount} papers · ${formatTimeAgo(item.savedAt)}`;

      loadBtn.appendChild(titleSpan);
      loadBtn.appendChild(metaSpan);

      const delBtn = document.createElement("button");
      delBtn.type = "button";
      delBtn.className = "history-del-btn";
      delBtn.title = "Remove from history";
      delBtn.textContent = "✕";
      delBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteHistoryItem(item.id);
      });

      li.appendChild(loadBtn);
      li.appendChild(delBtn);
      historyList.appendChild(li);
    }
  }

  // API calls
  async function uploadPdfs(fileList) {
    const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
    if (files.length === 0) {
      showMessages(["Please select one or more .pdf files."], true);
      return;
    }

    const form = new FormData();
    for (const f of files) form.append("files", f);

    setLoading(true, `Extracting references from ${files.length} PDF(s)...`);
    showMessages([]);
    try {
      const resp = await fetch("/api/papers/pdf", { method: "POST", body: form });
      const data = await resp.json();
      if (!resp.ok) {
        showMessages([data.detail || "Failed to parse PDF."], true);
        return;
      }
      mergeGraphPayload(data);
      saveCurrentToHistory();
      if (data.warnings?.length) showMessages(data.warnings);
    } catch (err) {
      showMessages([`Network error: ${err.message}`], true);
    } finally {
      setLoading(false);
      pdfInput.value = "";
    }
  }

  async function lookupIdentifiers(rawText) {
    const ids = rawText
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (ids.length === 0) {
      showMessages(["Enter at least one DOI, arXiv ID, or OpenAlex ID."], true);
      return;
    }

    setLoading(true, `Fetching citations for ${ids.length} paper(s)...`);
    showMessages([]);
    try {
      const resp = await fetch("/api/papers/lookup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identifiers: ids }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showMessages([data.detail || "Lookup failed."], true);
        return;
      }
      mergeGraphPayload(data);
      saveCurrentToHistory();
      if (data.warnings?.length) showMessages(data.warnings);
    } catch (err) {
      showMessages([`Network error: ${err.message}`], true);
    } finally {
      setLoading(false);
    }
  }

  async function expandSelectedNode() {
    if (!state.selectedId) return;
    const node = state.nodes.get(state.selectedId);
    if (!node || node.is_expanded) return;

    expandBtn.disabled = true;
    expandBtn.textContent = "Expanding...";
    showMessages([]);
    try {
      const resp = await fetch("/api/papers/expand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node: {
            id: node.id,
            title: node.title,
            year: node.year,
            doi: node.doi,
            arxiv_id: node.arxiv_id,
            openalex_id: node.openalex_id,
          },
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showMessages([data.detail || "Expansion failed."], true);
        expandBtn.disabled = false;
        expandBtn.textContent = "Expand Citations";
        return;
      }
      if (data.nodes?.length) {
        pushUndoSnapshot(`Expand references of "${formatCompactLabel(node)}"`);
        const edgeColor = node.is_seed ? null : getColorForExpandedPaper(node.id);
        mergeGraphPayload(data, node.id, edgeColor);
        saveCurrentToHistory();
      } else {
        openInspector(node.id);
      }
      if (data.warnings?.length) showMessages(data.warnings);
    } catch (err) {
      showMessages([`Network error: ${err.message}`], true);
      expandBtn.disabled = false;
      expandBtn.textContent = "Expand References (← older)";
    }
  }

  async function expandCitedBySelectedNode() {
    if (!state.selectedId) return;
    const node = state.nodes.get(state.selectedId);
    if (!node || node.is_cited_by_expanded) return;

    expandCitedByBtn.disabled = true;
    expandCitedByBtn.textContent = "Fetching forward citations...";
    showMessages([]);
    try {
      const resp = await fetch("/api/papers/cited-by", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          node: {
            id: node.id,
            title: node.title,
            year: node.year,
            doi: node.doi,
            arxiv_id: node.arxiv_id,
            openalex_id: node.openalex_id,
          },
          limit: 30,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showMessages([data.detail || "Forward citation lookup failed."], true);
        expandCitedByBtn.disabled = false;
        expandCitedByBtn.textContent = "Expand Cited By (→ newer)";
        return;
      }
      if (data.nodes?.length) {
        pushUndoSnapshot(`Expand cited by "${formatCompactLabel(node)}"`);
        const edgeColor = node.is_seed ? null : getColorForExpandedPaper(node.id);
        mergeGraphPayload(data, node.id, edgeColor);
        saveCurrentToHistory();
      } else {
        openInspector(node.id);
      }
      if (data.warnings?.length) showMessages(data.warnings);
    } catch (err) {
      showMessages([`Network error: ${err.message}`], true);
      expandCitedByBtn.disabled = false;
      expandCitedByBtn.textContent = "Expand Cited By (→ newer)";
    }
  }

  async function resolveUnknownYears() {
    const undated = Array.from(state.nodes.values()).filter((n) => !n.year);
    if (undated.length === 0) return;

    enrichYearsBtn.disabled = true;
    setLoading(true, `Looking up publication years for ${undated.length} paper(s) via OpenAlex & Crossref...`);
    showMessages([]);
    try {
      const resp = await fetch("/api/papers/enrich", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodes: undated.map((n) => ({
            id: n.id,
            title: n.title,
            year: n.year,
            doi: n.doi,
            arxiv_id: n.arxiv_id,
            openalex_id: n.openalex_id,
            raw_citation: n.raw_citation,
          })),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        showMessages([data.detail || "Failed to resolve unknown years."], true);
        return;
      }

      const updates = data.updates || [];
      for (const upd of updates) {
        mergeGraphPayload({ nodes: [upd.node], edges: [], source_id: upd.node.id }, upd.old_id);
      }
      if (updates.length > 0) {
        saveCurrentToHistory();
      }

      const msgs = [...(data.warnings || [])];
      if (updates.length > 0) {
        msgs.unshift(`Resolved publication years for ${updates.length} of ${undated.length} paper(s).`);
      } else {
        msgs.unshift(`Could not find publication years for the remaining ${undated.length} paper(s) in OpenAlex or Crossref.`);
      }
      showMessages(msgs);
    } catch (err) {
      showMessages([`Network error: ${err.message}`], true);
    } finally {
      enrichYearsBtn.disabled = false;
      setLoading(false);
    }
  }

  // Event wiring
  themeToggle.addEventListener("click", () => {
    const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    applyTheme(current === "dark" ? "light" : "dark");
  });

  clearHistoryBtn.addEventListener("click", () => {
    state.activeHistoryId = null;
    writeHistory([]);
    renderHistory();
  });
  dropzone.addEventListener("click", () => pdfInput.click());
  dropzone.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pdfInput.click();
    }
  });
  pdfInput.addEventListener("change", (e) => {
    if (e.target.files?.length) uploadPdfs(e.target.files);
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files?.length) uploadPdfs(e.dataTransfer.files);
  });

  lookupBtn.addEventListener("click", () => lookupIdentifiers(idInput.value));
  demoBtn.addEventListener("click", () => {
    idInput.value = "1706.03762\n1810.04805";
    lookupIdentifiers(idInput.value);
  });

  layoutSelect.addEventListener("change", () => applyLayout());
  labelModeSelect.addEventListener("change", () => updateLabelVisibility());
  sharedOnlyToggle.addEventListener("change", () => renderGraph());
  searchInput.addEventListener("input", () => applySearchHighlight());
  enrichYearsBtn.addEventListener("click", resolveUnknownYears);
  undoBtn.addEventListener("click", undoLastAction);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
      const tag = (document.activeElement?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea") return;
      if (state.undoStack.length > 0) {
        e.preventDefault();
        undoLastAction();
      }
    }
  });
  fitBtn.addEventListener("click", () => {
    cy.fit(undefined, 56);
    updateLabelVisibility();
  });

  exportBtn.addEventListener("click", () => {
    const payload = {
      nodes: Array.from(state.nodes.values()),
      edges: Array.from(state.edges).map((k) => {
        const [source, target] = k.split("->");
        return { source, target };
      }),
      edgeColors: Array.from(state.edgeColors.entries()),
      expansionColorByPaper: Array.from(state.expansionColorByPaper.entries()),
      expansionColorIdx: state.expansionColorIdx,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "citation-graph.json";
    a.click();
    URL.revokeObjectURL(url);
  });

  clearBtn.addEventListener("click", () => {
    state.nodes.clear();
    state.edges.clear();
    state.edgeColors.clear();
    state.expansionColorByPaper.clear();
    state.expansionColorIdx = 0;
    state.primarySeedId = null;
    state.undoStack = [];
    state.selectedId = null;
    state.activeHistoryId = null;
    updateUndoButton();
    hideTooltip();
    showMessages([]);
    renderGraph();
    renderHistory();
  });

  inspClose.addEventListener("click", () => {
    cy.elements().unselect();
    closeInspector();
  });
  expandBtn.addEventListener("click", expandSelectedNode);
  expandCitedByBtn.addEventListener("click", expandCitedBySelectedNode);

  // Cytoscape interaction events
  let zoomTimer = null;
  cy.on("zoom", () => {
    if (labelModeSelect.value !== "auto") return;
    clearTimeout(zoomTimer);
    zoomTimer = setTimeout(updateLabelVisibility, 80);
  });

  cy.on("tap", "node.paper", (evt) => {
    openInspector(evt.target.id());
  });
  cy.on("tap", (evt) => {
    if (evt.target === cy) closeInspector();
  });

  cy.on("mouseover", "node.paper", (evt) => {
    const node = evt.target;
    const neighborhood = node.closedNeighborhood();
    cy.elements(".paper, edge").addClass("dimmed");
    neighborhood.removeClass("dimmed").addClass("highlighted");
    node.addClass("hovered");
    showTooltip(node.id(), node.renderedPosition());
  });
  cy.on("mouseout", "node.paper", () => {
    cy.elements().removeClass("dimmed highlighted hovered");
    hideTooltip();
  });

  // Initialize saved theme and history on page load
  let initialTheme = "light";
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "dark" || saved === "light") {
      initialTheme = saved;
    } else if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
      initialTheme = "dark";
    }
  } catch (_) {}
  applyTheme(initialTheme);
  renderHistory();
})();
