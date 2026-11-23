(() => {
  // In-memory graph state
  const state = {
    nodes: new Map(), // id -> PaperNode
    edges: new Set(), // "source->target"
    selectedId: null,
  };

  // DOM elements
  const dropzone = document.getElementById("dropzone");
  const pdfInput = document.getElementById("pdf-input");
  const idInput = document.getElementById("id-input");
  const lookupBtn = document.getElementById("lookup-btn");
  const demoBtn = document.getElementById("demo-btn");
  const layoutSelect = document.getElementById("layout-select");
  const sharedOnlyToggle = document.getElementById("shared-only-toggle");
  const searchInput = document.getElementById("search-input");
  const fitBtn = document.getElementById("fit-btn");
  const exportBtn = document.getElementById("export-btn");
  const clearBtn = document.getElementById("clear-btn");
  const statusArea = document.getElementById("status-area");
  const emptyState = document.getElementById("empty-state");
  const loadingOverlay = document.getElementById("loading-overlay");
  const loadingText = document.getElementById("loading-text");

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
  const inspLinks = document.getElementById("insp-links");
  const expandBtn = document.getElementById("expand-btn");
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
          label: "data(shortLabel)",
          "font-size": 11,
          "font-family": "-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif",
          color: "#1e293b",
          "text-valign": "bottom",
          "text-halign": "center",
          "text-margin-y": 6,
          "text-wrap": "wrap",
          "text-max-width": 135,
          "background-color": "#64748b",
          width: "data(size)",
          height: "data(size)",
          "border-width": 0,
          "border-color": "#4f46e5",
          "overlay-padding": 5,
        },
      },
      {
        selector: "node.paper.shared",
        style: {
          "background-color": "#f59e0b",
          "font-weight": 600,
        },
      },
      {
        selector: "node.paper.seed",
        style: {
          "background-color": "#4f46e5",
          "font-weight": 700,
          "font-size": 12,
          color: "#0f172a",
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
        selector: "node.paper:selected",
        style: {
          "border-width": 4,
          "border-color": "#0f172a",
        },
      },
      {
        selector: "node.year-header",
        style: {
          label: "data(label)",
          shape: "round-rectangle",
          width: 78,
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
        },
      },
      {
        selector: "edge",
        style: {
          width: 1.5,
          "line-color": "#cbd5e1",
          "target-arrow-color": "#94a3b8",
          "target-arrow-shape": "triangle",
          "arrow-scale": 0.85,
          "curve-style": "bezier",
          opacity: 0.8,
        },
      },
      {
        selector: ".dimmed",
        style: {
          opacity: 0.16,
        },
      },
      {
        selector: ".highlighted",
        style: {
          opacity: 1,
        },
      },
      {
        selector: "edge.highlighted",
        style: {
          "line-color": "#4f46e5",
          "target-arrow-color": "#4f46e5",
          width: 2.4,
          opacity: 1,
        },
      },
      {
        selector: "node.search-hit",
        style: {
          "border-width": 4,
          "border-color": "#ec4899",
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

  function shortLabel(node) {
    const title = node.title || "Untitled";
    const truncated = title.length > 42 ? title.slice(0, 40).trimEnd() + "…" : title;
    return node.year ? `${truncated} (${node.year})` : truncated;
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
    for (const key of state.edges) {
      const [s, t] = key.split("->");
      const ns = s === oldId ? newId : s;
      const nt = t === oldId ? newId : t;
      if (ns !== nt) next.add(`${ns}->${nt}`);
    }
    state.edges = next;
    if (state.selectedId === oldId) state.selectedId = newId;
  }

  function mergeGraphPayload(payload, preferredOldSourceId = null) {
    const idMap = new Map();

    for (const incoming of payload.nodes || []) {
      let existingId = findExistingNodeId(incoming);
      if (!existingId && preferredOldSourceId && payload.source_id === incoming.id && state.nodes.has(preferredOldSourceId)) {
        existingId = preferredOldSourceId;
      }

      if (!existingId) {
        state.nodes.set(incoming.id, { ...incoming });
        idMap.set(incoming.id, incoming.id);
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
          is_seed: Boolean(existing.is_seed || incoming.is_seed),
          is_expanded: Boolean(existing.is_expanded || incoming.is_expanded),
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
        state.edges.add(`${src}->${dst}`);
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
            ? Math.min(44, 24 + deg * 4)
            : 20;

        const classes = ["paper"];
        if (node.is_seed) classes.push("seed");
        else if (isShared) classes.push("shared");
        if (node.is_expanded && !node.is_seed) classes.push("expanded");

        cy.add({
          group: "nodes",
          data: {
            id,
            shortLabel: shortLabel(node),
            size,
            inDegree: deg,
            year: node.year ?? null,
          },
          classes: classes.join(" "),
        });
      }

      for (const key of state.edges) {
        const [source, target] = key.split("->");
        if (visibleIds.has(source) && visibleIds.has(target)) {
          cy.add({
            group: "edges",
            data: { id: key, source, target },
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
    for (const [id, node] of state.nodes.entries()) {
      if (node.is_seed) seeds++;
      else if ((inDeg.get(id) || 0) >= 2) shared++;
    }
    statSeeds.textContent = String(seeds);
    statNodes.textContent = String(state.nodes.size);
    statShared.textContent = String(shared);
    statEdges.textContent = String(state.edges.size);
  }

  function applyTimelineLayout() {
    cy.nodes(".year-header").remove();
    const paperNodes = cy.nodes(".paper");
    if (paperNodes.length === 0) return;

    // Group visible paper nodes by year
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

    const colSpacing = 220;
    const rowSpacing = 105;
    const positions = {};
    let maxColHeight = 0;

    columns.forEach((col, colIdx) => {
      // Order within column: seeds first, then higher in-degree, then alphabetical
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

    const headerY = -maxColHeight / 2 - 78;
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
      padding: 48,
    }).run();
  }

  function applyLayout() {
    const mode = layoutSelect.value;
    if (cy.nodes(".paper").length === 0) return;

    if (mode === "timeline") {
      applyTimelineLayout();
      return;
    }

    // Remove timeline headers for non-timeline layouts
    cy.nodes(".year-header").remove();

    const opts = {
      cose: {
        name: "cose",
        animate: true,
        animationDuration: 400,
        padding: 48,
        nodeRepulsion: () => 8500,
        idealEdgeLength: () => 110,
      },
      breadthfirst: {
        name: "breadthfirst",
        directed: true,
        spacingFactor: 1.35,
        animate: true,
        animationDuration: 400,
        padding: 48,
      },
      concentric: {
        name: "concentric",
        concentric: (node) => (node.hasClass("seed") ? 100 : (node.data("inDegree") || 0) * 10 + 1),
        levelWidth: () => 2,
        minNodeSpacing: 55,
        animate: true,
        animationDuration: 400,
        padding: 48,
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
      expandBtn.textContent = "Citations Expanded";
      expandBtn.disabled = true;
    } else {
      expandBtn.textContent = "Expand Citations";
      expandBtn.disabled = !node.expandable;
    }

    // Cited by list
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
        btn.textContent = shortLabel(citer);
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
        mergeGraphPayload(data, node.id);
      } else {
        openInspector(node.id);
      }
      if (data.warnings?.length) showMessages(data.warnings);
    } catch (err) {
      showMessages([`Network error: ${err.message}`], true);
      expandBtn.disabled = false;
      expandBtn.textContent = "Expand Citations";
    }
  }

  // Event wiring
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
  sharedOnlyToggle.addEventListener("change", () => renderGraph());
  searchInput.addEventListener("input", () => applySearchHighlight());
  fitBtn.addEventListener("click", () => cy.fit(undefined, 48));

  exportBtn.addEventListener("click", () => {
    const payload = {
      nodes: Array.from(state.nodes.values()),
      edges: Array.from(state.edges).map((k) => {
        const [source, target] = k.split("->");
        return { source, target };
      }),
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
    state.selectedId = null;
    showMessages([]);
    renderGraph();
  });

  inspClose.addEventListener("click", () => {
    cy.elements().unselect();
    closeInspector();
  });
  expandBtn.addEventListener("click", expandSelectedNode);

  // Cytoscape interaction events
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
  });
  cy.on("mouseout", "node.paper", () => {
    cy.elements().removeClass("dimmed highlighted");
  });
})();
