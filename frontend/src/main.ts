import "./styles.css";
import {
  apiEnrichNodes,
  apiExpandCitedBy,
  apiExpandReferences,
  apiFetchPaperDetails,
  apiFindCrossCitations,
  apiLookupIdentifiers,
  apiUploadBibs,
  apiUploadPdfs,
  apiUploadRis,
} from "./api";
import { enhanceSelect, type CustomDropdown } from "./dropdown";
import { CitationGraphView } from "./graph";
import { formatCompactLabel, formatFullLabel, GraphStore } from "./store";
import type {
  DepthMode,
  DirectionMode,
  GraphFilters,
  LabelMode,
  LayoutMode,
  NodeSizeMode,
  PaperNode,
  RelevanceMode,
  ThemeMode,
} from "./types";

const THEME_KEY = "citation-graph:theme";
const PANEL_LAYOUT_KEY = "citation-graph:panel-layout";
const OFFLINE_KEY = "citation-graph:offline";

interface PanelLayoutState {
  leftWidth: number;
  rightWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
}

const SUN_SVG = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_SVG = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

// Top nav & layout elements
const toggleLeftBtn = byId<HTMLButtonElement>("toggle-left-btn");
const toggleRightBtn = byId<HTMLButtonElement>("toggle-right-btn");
const tabWorkspaceBtn = byId<HTMLButtonElement>("tab-workspace-btn");
const tabDiscoverBtn = byId<HTMLButtonElement>("tab-discover-btn");
const themeToggle = byId<HTMLButtonElement>("theme-toggle");
const offlineToggleBtn = byId<HTMLButtonElement>("offline-toggle-btn");
const exportBibBtn = byId<HTMLButtonElement>("export-bib-btn");
const exportSvgBtn = byId<HTMLButtonElement>("export-svg-btn");
const exportPngBtn = byId<HTMLButtonElement>("export-png-btn");
const exportBtn = byId<HTMLButtonElement>("export-btn");
const searchInput = byId<HTMLInputElement>("search-input");

const leftSidebar = byId<HTMLElement>("left-sidebar");
const leftResizer = byId<HTMLDivElement>("left-resizer");
const rightResizer = byId<HTMLDivElement>("right-resizer");
const inspector = byId<HTMLElement>("inspector");

// Left sidebar controls
const dropzone = byId<HTMLDivElement>("dropzone");
const pdfInput = byId<HTMLInputElement>("pdf-input");
const idInput = byId<HTMLTextAreaElement>("id-input");
const lookupBtn = byId<HTMLButtonElement>("lookup-btn");
const demoBtn = byId<HTMLButtonElement>("demo-btn");
const seedSection = byId<HTMLElement>("seed-section");
const seedList = byId<HTMLUListElement>("seed-list");
const resetFiltersBtn = byId<HTMLButtonElement>("reset-filters-btn");
const relevanceSelect = byId<HTMLSelectElement>("relevance-select");
const directionSelect = byId<HTMLSelectElement>("direction-select");
const densitySelect = byId<HTMLSelectElement>("density-select");
const depthSelect = byId<HTMLSelectElement>("depth-select");
const sizeModeSelect = byId<HTMLSelectElement>("size-mode-select");
const minYearInput = byId<HTMLInputElement>("min-year-input");
const maxYearInput = byId<HTMLInputElement>("max-year-input");
const minCitesSelect = byId<HTMLSelectElement>("min-cites-select");
const topicFilterWrap = byId<HTMLDivElement>("topic-filter-wrap");
const topicSelect = byId<HTMLSelectElement>("topic-select");
const enrichYearsBtn = byId<HTMLButtonElement>("enrich-years-btn");
const restoreHiddenBtn = byId<HTMLButtonElement>("restore-hidden-btn");
const historyList = byId<HTMLUListElement>("history-list");
const historyCount = byId<HTMLSpanElement>("history-count");
const clearHistoryBtn = byId<HTMLButtonElement>("clear-history-btn");

// Graph toolbar & canvas overlays
const layoutSelect = byId<HTMLSelectElement>("layout-select");
const labelModeSelect = byId<HTMLSelectElement>("label-mode-select");
const crossCiteBtn = byId<HTMLButtonElement>("cross-cite-btn");
const rearrangeBtn = byId<HTMLButtonElement>("rearrange-btn");
const undoBtn = byId<HTMLButtonElement>("undo-btn");
const zoomOutBtn = byId<HTMLButtonElement>("zoom-out-btn");
const zoomInBtn = byId<HTMLButtonElement>("zoom-in-btn");
const fitBtn = byId<HTMLButtonElement>("fit-btn");
const clearBtn = byId<HTMLButtonElement>("clear-btn");
const pathBanner = byId<HTMLDivElement>("path-banner");
const pathBannerText = byId<HTMLSpanElement>("path-banner-text");
const pathClearBtn = byId<HTMLButtonElement>("path-clear-btn");
const statusArea = byId<HTMLDivElement>("status-area");
const emptyState = byId<HTMLDivElement>("empty-state");
const loadingOverlay = byId<HTMLDivElement>("loading-overlay");
const loadingText = byId<HTMLSpanElement>("loading-text");
const hoverTooltip = byId<HTMLDivElement>("hover-tooltip");
const legendRetracted = byId<HTMLSpanElement>("legend-retracted");

// Discover view
const discoverPanel = byId<HTMLElement>("discover-panel");
const discoverSortSelect = byId<HTMLSelectElement>("discover-sort-select");
const discoverCloseBtn = byId<HTMLButtonElement>("discover-close-btn");
const discoverEmpty = byId<HTMLDivElement>("discover-empty");
const discoverList = byId<HTMLDivElement>("discover-list");

// Inspector elements
const inspClose = byId<HTMLButtonElement>("insp-close");
const inspTitle = byId<HTMLHeadingElement>("insp-title");
const inspSubtitle = byId<HTMLDivElement>("insp-subtitle");
const inspHeaderMeta = byId<HTMLDivElement>("insp-header-meta");
const inspEmpty = byId<HTMLDivElement>("insp-empty");
const inspContent = byId<HTMLDivElement>("insp-content");
const inspBadges = byId<HTMLDivElement>("insp-badges");
const inspAbstract = byId<HTMLParagraphElement>("insp-abstract");
const inspContextsSection = byId<HTMLDivElement>("insp-contexts-section");
const inspContexts = byId<HTMLUListElement>("insp-contexts");
const inspYear = byId<HTMLElement>("insp-year");
const inspVenue = byId<HTMLElement>("insp-venue");
const inspAuthors = byId<HTMLElement>("insp-authors");
const inspGlobalCites = byId<HTMLElement>("insp-global-cites");
const inspLinks = byId<HTMLDivElement>("insp-links");
const expandBtn = byId<HTMLButtonElement>("expand-btn");
const expandCitedByBtn = byId<HTMLButtonElement>("expand-cited-by-btn");
const toggleSeedBtn = byId<HTMLButtonElement>("toggle-seed-btn");
const newGraphBtn = byId<HTMLButtonElement>("new-graph-btn");
const pathBtn = byId<HTMLButtonElement>("path-btn");
const copyBibtexBtn = byId<HTMLButtonElement>("copy-bibtex-btn");
const hideNodeBtn = byId<HTMLButtonElement>("hide-node-btn");
const connCitesCount = byId<HTMLElement>("conn-cites-count");
const connCitedByCount = byId<HTMLElement>("conn-citedby-count");
const connSharedCount = byId<HTMLElement>("conn-shared-count");
const inspCitesSection = byId<HTMLDivElement>("insp-cites-section");
const inspCites = byId<HTMLUListElement>("insp-cites");
const inspCitedBySection = byId<HTMLDivElement>("insp-cited-by-section");
const inspCitedBy = byId<HTMLUListElement>("insp-cited-by");
const inspSharedSection = byId<HTMLDivElement>("insp-shared-section");
const inspShared = byId<HTMLUListElement>("insp-shared");
const inspConnEmpty = byId<HTMLParagraphElement>("insp-conn-empty");
const inspReasons = byId<HTMLUListElement>("insp-reasons");
const insBridgeScore = byId<HTMLElement>("ins-bridge-score");
const insIndeg = byId<HTMLElement>("ins-indeg");
const insOutdeg = byId<HTMLElement>("ins-outdeg");
const inspTopicsSection = byId<HTMLDivElement>("insp-topics-section");
const inspTopics = byId<HTMLDivElement>("insp-topics");
const inspBridgeSeedsSection = byId<HTMLDivElement>("insp-bridge-seeds-section");
const inspBridgeSeeds = byId<HTMLUListElement>("insp-bridge-seeds");
const inspRawSection = byId<HTMLDivElement>("insp-raw-section");
const inspRaw = byId<HTMLParagraphElement>("insp-raw");

type InspectorTab = "overview" | "connections" | "insights" | "actions";
let activeInspectorTab: InspectorTab = "overview";
const inspTabButtons = Array.from(document.querySelectorAll<HTMLButtonElement>(".insp-tab"));
const inspTabPanels: Record<InspectorTab, HTMLElement> = {
  overview: byId<HTMLElement>("tab-panel-overview"),
  connections: byId<HTMLElement>("tab-panel-connections"),
  insights: byId<HTMLElement>("tab-panel-insights"),
  actions: byId<HTMLElement>("tab-panel-actions"),
};

// Bottom status bar
const statSeeds = byId<HTMLElement>("stat-seeds");
const statNodes = byId<HTMLElement>("stat-nodes");
const statShared = byId<HTMLElement>("stat-shared");
const statEdges = byId<HTMLElement>("stat-edges");
const statusBarMsg = byId<HTMLDivElement>("status-bar-msg");

const store = new GraphStore();
const detailsAttemptedIds = new Set<string>();
let pathStartId: string | null = null;
let pathActive = false;
let discoverOpen = false;
let offlineMode = false;
let toastTimer: number | null = null;

const panelState: PanelLayoutState = loadPanelLayout();

const graphView = new CitationGraphView(byId<HTMLDivElement>("cy"), store, {
  onSelectNode: (nodeId) => handleNodeSelected(nodeId),
  onClearSelection: () => {
    if (!pathActive && !pathStartId) closeInspector();
  },
  onHoverNode: (nodeId, pos) => showTooltip(nodeId, pos),
  onUnhoverNode: () => hideTooltip(),
});

// Panel Layout Persistence & Resizing
function loadPanelLayout(): PanelLayoutState {
  const defaults: PanelLayoutState = {
    leftWidth: 260,
    rightWidth: 340,
    leftOpen: true,
    rightOpen: false,
  };
  try {
    const raw = localStorage.getItem(PANEL_LAYOUT_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<PanelLayoutState>;
    return {
      leftWidth: clamp(parsed.leftWidth ?? defaults.leftWidth, 200, 420),
      rightWidth: clamp(parsed.rightWidth ?? defaults.rightWidth, 260, 520),
      leftOpen: parsed.leftOpen ?? defaults.leftOpen,
      rightOpen: false, // Start closed until a paper is selected
    };
  } catch {
    return defaults;
  }
}

function savePanelLayout(): void {
  try {
    localStorage.setItem(PANEL_LAYOUT_KEY, JSON.stringify(panelState));
  } catch {
    // Ignore storage errors
  }
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

function applyPanelLayout(): void {
  leftSidebar.style.width = `${panelState.leftWidth}px`;
  leftSidebar.classList.toggle("hidden", !panelState.leftOpen);
  leftResizer.classList.toggle("hidden", !panelState.leftOpen);
  toggleLeftBtn.classList.toggle("active", panelState.leftOpen);

  inspector.style.width = `${panelState.rightWidth}px`;
  inspector.classList.toggle("hidden", !panelState.rightOpen);
  rightResizer.classList.toggle("hidden", !panelState.rightOpen);
  toggleRightBtn.classList.toggle("active", panelState.rightOpen);

  savePanelLayout();
  requestAnimationFrame(() => graphView.cy.resize());
}

function wireResizer(
  handle: HTMLElement,
  side: "left" | "right"
): void {
  handle.addEventListener("mousedown", (startEvent) => {
    startEvent.preventDefault();
    handle.classList.add("dragging");
    const startX = startEvent.clientX;
    const startWidth = side === "left" ? panelState.leftWidth : panelState.rightWidth;

    const onMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      if (side === "left") {
        panelState.leftWidth = clamp(startWidth + delta, 200, 420);
        leftSidebar.style.width = `${panelState.leftWidth}px`;
      } else {
        panelState.rightWidth = clamp(startWidth - delta, 260, 520);
        inspector.style.width = `${panelState.rightWidth}px`;
      }
      graphView.cy.resize();
    };

    const onUp = () => {
      handle.classList.remove("dragging");
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      savePanelLayout();
      graphView.cy.resize();
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });
}

wireResizer(leftResizer, "left");
wireResizer(rightResizer, "right");

// Discover view
function setDiscoverOpen(open: boolean): void {
  discoverOpen = open;
  discoverPanel.classList.toggle("hidden", !open);
  tabWorkspaceBtn.classList.toggle("active", !open);
  tabDiscoverBtn.classList.toggle("active", open);
  if (open) renderDiscover();
  else requestAnimationFrame(() => graphView.cy.resize());
}

function formatCompactCount(n: number | null): string {
  if (n === null) return "";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function getCurrentFilters(): GraphFilters {
  const minY = parseInt(minYearInput.value, 10);
  const maxY = parseInt(maxYearInput.value, 10);
  const maxN = densitySelect.value === "all" ? null : parseInt(densitySelect.value, 10);
  return {
    relevance: relevanceSelect.value as RelevanceMode,
    direction: directionSelect.value as DirectionMode,
    depth: depthSelect.value as DepthMode,
    maxNodes: maxN !== null && !Number.isNaN(maxN) ? maxN : null,
    minYear: Number.isNaN(minY) ? null : minY,
    maxYear: Number.isNaN(maxY) ? null : maxY,
    minCitations: parseInt(minCitesSelect.value, 10) || 0,
    topic: topicSelect.value,
    sizeBy: sizeModeSelect.value as NodeSizeMode,
  };
}

function updateFilterResetVisibility(): void {
  const f = getCurrentFilters();
  const active =
    f.relevance !== "all" ||
    f.direction !== "both" ||
    f.depth !== "all" ||
    f.maxNodes !== null ||
    f.minYear !== null ||
    f.maxYear !== null ||
    f.minCitations > 0 ||
    f.topic !== "" ||
    f.sizeBy !== "degree";
  resetFiltersBtn.classList.toggle("hidden", !active);
}

function syncTopicFilterOptions(): void {
  const topics = store.getAvailableTopics();
  const prevVal = topicSelect.value;
  topicSelect.innerHTML = `<option value="">Topic: All</option>`;
  for (const t of topics) {
    const opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    topicSelect.appendChild(opt);
  }
  topicSelect.value = topics.includes(prevVal) ? prevVal : "";
  topicFilterWrap.classList.toggle("hidden", topics.length === 0);
  topicDropdown?.sync();
}

function renderDiscover(): void {
  const mode = discoverSortSelect.value;
  const bridgeRanked = store.getBridgePapers();

  const candidates = [...bridgeRanked];
  candidates.sort((a, b) => {
    if (mode === "bridge") {
      if (b.connectedSeedCount !== a.connectedSeedCount) {
        return b.connectedSeedCount - a.connectedSeedCount;
      }
      if (b.localCites !== a.localCites) return b.localCites - a.localCites;
      return (b.node.cited_by_count ?? 0) - (a.node.cited_by_count ?? 0);
    }
    if (mode === "local") {
      if (b.localCites !== a.localCites) return b.localCites - a.localCites;
      return (b.node.cited_by_count ?? 0) - (a.node.cited_by_count ?? 0);
    }
    if (mode === "global") {
      return (b.node.cited_by_count ?? 0) - (a.node.cited_by_count ?? 0);
    }
    if (mode === "newest") {
      return (b.node.year ?? 0) - (a.node.year ?? 0);
    }
    // foundational
    const scoreA = a.localCites * 3 + Math.log10((a.node.cited_by_count ?? 0) + 1);
    const scoreB = b.localCites * 3 + Math.log10((b.node.cited_by_count ?? 0) + 1);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.node.cited_by_count ?? 0) - (a.node.cited_by_count ?? 0);
  });

  discoverList.innerHTML = "";
  discoverEmpty.classList.toggle("hidden", candidates.length > 0);

  candidates.slice(0, 30).forEach((entry, idx) => {
    const card = document.createElement("button");
    card.type = "button";
    card.className = "discover-card";
    card.addEventListener("click", () => {
      setDiscoverOpen(false);
      graphView.focusNode(entry.node.id);
      openInspector(entry.node.id);
    });

    const top = document.createElement("div");
    top.className = "discover-card-top";
    const metaParts: string[] = [`#${idx + 1}`];
    if (entry.localCites > 0) metaParts.push(`${entry.localCites} local`);
    const gStr = formatCompactCount(entry.node.cited_by_count);
    if (gStr) metaParts.push(`${gStr} cites`);
    const leftMeta = document.createElement("span");
    leftMeta.textContent = metaParts.join(" · ");
    const rightMeta = document.createElement("span");
    rightMeta.textContent = entry.node.year ? String(entry.node.year) : "—";
    top.appendChild(leftMeta);
    top.appendChild(rightMeta);

    const title = document.createElement("div");
    title.className = "discover-card-title";
    title.textContent = entry.node.title;

    const authors = document.createElement("div");
    authors.className = "discover-card-authors";
    authors.textContent =
      entry.node.authors.length > 0
        ? entry.node.authors.slice(0, 4).join(", ")
        : entry.node.venue ?? "";

    card.appendChild(top);
    card.appendChild(title);
    if (entry.node.is_retracted) {
      const retBadge = document.createElement("span");
      retBadge.className = "badge badge-danger";
      retBadge.style.alignSelf = "flex-start";
      retBadge.textContent = "Retracted";
      card.appendChild(retBadge);
    }
    if (entry.totalSeeds >= 2 && entry.connectedSeedCount >= 2) {
      const bridgeBadge = document.createElement("span");
      bridgeBadge.className = "discover-bridge-pill";
      bridgeBadge.textContent = `Bridges ${entry.connectedSeedCount}/${entry.totalSeeds} seeds`;
      card.appendChild(bridgeBadge);
    }
    if (authors.textContent) card.appendChild(authors);
    discoverList.appendChild(card);
  });
}

// Loading & Status
function setLoading(isLoading: boolean, text = "Loading"): void {
  loadingText.textContent = text;
  loadingOverlay.classList.toggle("hidden", !isLoading);
  statusBarMsg.textContent = isLoading ? text : "Ready";
}

function showMessages(messages: string[], isError = false): void {
  statusArea.innerHTML = "";
  if (toastTimer !== null) window.clearTimeout(toastTimer);
  if (messages.length === 0) return;

  statusBarMsg.textContent = messages[0];
  for (const msg of messages) {
    const div = document.createElement("div");
    div.className = isError ? "toast error" : "toast";
    div.textContent = msg;
    statusArea.appendChild(div);
  }
  if (!isError) {
    toastTimer = window.setTimeout(() => {
      statusArea.innerHTML = "";
    }, 6500);
  }
}

function applyOfflineMode(enabled: boolean): void {
  offlineMode = enabled;
  offlineToggleBtn.classList.toggle("active", enabled);
  try {
    localStorage.setItem(OFFLINE_KEY, enabled ? "1" : "0");
  } catch {
    // Ignore storage errors
  }

  lookupBtn.disabled = enabled;
  demoBtn.disabled = enabled;
  idInput.disabled = enabled;
  idInput.placeholder = enabled ? "Disabled in Local-only mode" : "DOI or arXiv ID\n1706.03762";
  crossCiteBtn.disabled = enabled;
  enrichYearsBtn.disabled = enabled;

  statusBarMsg.textContent = enabled ? "Local-only · zero outbound requests" : "Ready";
  if (store.selectedId && store.nodes.has(store.selectedId)) {
    openInspector(store.selectedId);
  }
}

function applyTheme(theme: ThemeMode): void {
  document.documentElement.dataset.theme = theme;
  themeToggle.innerHTML = theme === "dark" ? SUN_SVG : MOON_SVG;
  themeToggle.title = theme === "dark" ? "Light mode" : "Dark mode";
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore storage errors
  }
  graphView.applyTheme(theme);
}

function updateStatsAndSeeds(): void {
  const inDeg = store.computeInDegrees();
  let seeds = 0;
  let shared = 0;
  let unknownYears = 0;
  let retractedCount = 0;
  const seedNodes: PaperNode[] = [];

  for (const [id, node] of store.nodes.entries()) {
    if (node.is_seed) {
      seeds += 1;
      seedNodes.push(node);
    } else if ((inDeg.get(id) ?? 0) >= 2) {
      shared += 1;
    }
    if (!node.year) unknownYears += 1;
    if (node.is_retracted) retractedCount += 1;
  }

  legendRetracted.classList.toggle("hidden", retractedCount === 0);

  statSeeds.textContent = String(seeds);
  statNodes.textContent = String(store.nodes.size);
  statShared.textContent = String(shared);
  statEdges.textContent = String(store.edges.size);

  if (unknownYears > 0) {
    enrichYearsBtn.textContent = `Resolve years (${unknownYears})`;
    enrichYearsBtn.classList.remove("hidden");
  } else {
    enrichYearsBtn.classList.add("hidden");
  }

  if (store.hiddenIds.size > 0) {
    restoreHiddenBtn.textContent = `Restore hidden (${store.hiddenIds.size})`;
    restoreHiddenBtn.classList.remove("hidden");
  } else {
    restoreHiddenBtn.classList.add("hidden");
  }

  crossCiteBtn.classList.toggle("hidden", store.nodes.size < 3);

  // Render Seed Papers list
  seedList.innerHTML = "";
  seedSection.classList.toggle("hidden", seedNodes.length === 0);
  for (const seed of seedNodes) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "seed-item-btn";
    btn.title = seed.title;
    btn.addEventListener("click", () => {
      setDiscoverOpen(false);
      graphView.focusNode(seed.id);
      openInspector(seed.id);
    });

    const title = document.createElement("span");
    title.className = "seed-title";
    title.textContent = seed.title;

    const meta = document.createElement("span");
    meta.className = "seed-meta";
    meta.textContent = [seed.year, seed.id === store.primarySeedId ? "Primary" : "Seed"]
      .filter(Boolean)
      .join(" · ");

    btn.appendChild(title);
    btn.appendChild(meta);
    li.appendChild(btn);
    seedList.appendChild(li);
  }
}

function updateUndoButton(): void {
  const count = store.undoStack.length;
  undoBtn.disabled = count === 0;
  undoBtn.title =
    count > 0 ? `Undo: ${store.undoStack[count - 1].label} (Ctrl+Z)` : "Nothing to undo";
}

function clearPathMode(): void {
  pathStartId = null;
  pathActive = false;
  pathBanner.classList.add("hidden");
  graphView.clearPathHighlight();
}

function startPathFromSelected(): void {
  if (!store.selectedId) return;
  const startNode = store.nodes.get(store.selectedId);
  if (!startNode) return;
  pathStartId = startNode.id;
  pathActive = false;
  graphView.clearPathHighlight();
  pathBannerText.textContent = `Path from "${formatCompactLabel(startNode)}" — click target`;
  pathBanner.classList.remove("hidden");
}

function handleNodeSelected(nodeId: string): void {
  if (pathStartId && nodeId !== pathStartId) {
    const startNode = store.nodes.get(pathStartId);
    const targetNode = store.nodes.get(nodeId);
    const result = store.findShortestPath(pathStartId, nodeId);
    pathStartId = null;
    if (!result) {
      pathActive = false;
      pathBannerText.textContent = `No path between "${formatCompactLabel(startNode!)}" and "${formatCompactLabel(targetNode!)}"`;
      pathBanner.classList.remove("hidden");
      openInspector(nodeId);
      return;
    }
    pathActive = true;
    const hops = result.edgeKeys.length;
    const kindLabel =
      result.kind === "undirected" ? "via shared citation" : "directed";
    pathBannerText.textContent = `Path · ${hops} hop${hops === 1 ? "" : "s"} (${kindLabel})`;
    pathBanner.classList.remove("hidden");
    graphView.highlightPath(result.nodeIds, result.edgeKeys);
    openInspector(nodeId);
    return;
  }
  openInspector(nodeId);
}

function renderAll(): void {
  clearPathMode();
  syncTopicFilterOptions();
  updateFilterResetVisibility();
  graphView.render(getCurrentFilters(), searchInput.value);
  updateStatsAndSeeds();
  updateUndoButton();
  if (discoverOpen) renderDiscover();
  emptyState.classList.toggle("hidden", store.nodes.size > 0);

  if (store.selectedId && store.nodes.has(store.selectedId)) {
    openInspector(store.selectedId);
  } else if (panelState.rightOpen) {
    renderEmptyInspector();
  }
}

function showTooltip(nodeId: string, pos: { x: number; y: number }): void {
  const node = store.nodes.get(nodeId);
  if (!node) return;
  const authors =
    node.authors.length > 0
      ? node.authors.slice(0, 3).join(", ") + (node.authors.length > 3 ? " et al." : "")
      : "";
  const metaParts = [authors, node.year, node.venue].filter(Boolean);

  hoverTooltip.innerHTML = "";
  const titleEl = document.createElement("div");
  titleEl.className = "tt-title";
  titleEl.textContent = node.title || "Untitled";
  hoverTooltip.appendChild(titleEl);

  if (metaParts.length > 0) {
    const metaEl = document.createElement("div");
    metaEl.className = "tt-meta";
    metaEl.textContent = metaParts.join(" · ");
    hoverTooltip.appendChild(metaEl);
  }

  const wrap = graphView.cy.container()?.getBoundingClientRect();
  let left = pos.x + 16;
  let top = pos.y - 10;
  if (wrap) {
    if (left + 320 > wrap.width) left = Math.max(12, pos.x - 326);
    if (top + 86 > wrap.height) top = Math.max(12, pos.y - 80);
  }
  hoverTooltip.style.left = `${left}px`;
  hoverTooltip.style.top = `${top}px`;
  hoverTooltip.classList.remove("hidden");
}

function hideTooltip(): void {
  hoverTooltip.classList.add("hidden");
}

function setInspectorTab(tab: InspectorTab): void {
  activeInspectorTab = tab;
  for (const btn of inspTabButtons) {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  }
  (Object.keys(inspTabPanels) as InspectorTab[]).forEach((key) => {
    inspTabPanels[key].classList.toggle("hidden", key !== tab);
  });
}

function renderPaperJumpList(
  listEl: HTMLUListElement,
  items: Array<{ node: PaperNode; suffix?: string }>
): void {
  listEl.innerHTML = "";
  for (const { node, suffix } of items) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = suffix ? `${formatFullLabel(node)} · ${suffix}` : formatFullLabel(node);
    btn.addEventListener("click", () => {
      graphView.focusNode(node.id);
      openInspector(node.id);
    });
    li.appendChild(btn);
    listEl.appendChild(li);
  }
}

function renderEmptyInspector(): void {
  inspTitle.textContent = "Paper Inspector";
  inspSubtitle.classList.add("hidden");
  inspHeaderMeta.classList.add("hidden");
  inspEmpty.classList.remove("hidden");
  inspContent.classList.add("hidden");
}

function openInspector(nodeId: string): void {
  const node = store.nodes.get(nodeId);
  if (!node) return;
  store.selectedId = nodeId;

  const inDeg = store.computeInDegrees().get(nodeId) ?? 0;
  const conn = store.getNodeConnections(nodeId);
  const totalSeeds = Array.from(store.nodes.values()).filter((n) => n.is_seed).length;

  // Sticky header
  inspTitle.textContent = node.title || "Untitled";
  const subParts = [node.year, node.venue].filter(Boolean);
  if (subParts.length > 0) {
    inspSubtitle.textContent = subParts.join(" · ");
    inspSubtitle.classList.remove("hidden");
  } else {
    inspSubtitle.classList.add("hidden");
  }
  inspHeaderMeta.classList.remove("hidden");
  inspEmpty.classList.add("hidden");
  inspContent.classList.remove("hidden");

  inspBadges.innerHTML = "";
  if (node.is_retracted) inspBadges.innerHTML += `<span class="badge badge-danger">Retracted</span>`;
  if (node.is_seed) inspBadges.innerHTML += `<span class="badge">Source</span>`;
  if (inDeg >= 2) inspBadges.innerHTML += `<span class="badge">Shared · ${inDeg}</span>`;
  if (node.is_expanded) inspBadges.innerHTML += `<span class="badge">Older</span>`;
  if (node.is_cited_by_expanded) inspBadges.innerHTML += `<span class="badge">Newer</span>`;

  inspLinks.innerHTML = "";
  const links: Array<{ label: string; href: string }> = [];
  if (node.doi) links.push({ label: "DOI", href: `https://doi.org/${node.doi}` });
  if (node.arxiv_id) links.push({ label: "arXiv", href: `https://arxiv.org/abs/${node.arxiv_id}` });
  if (node.openalex_id) {
    links.push({ label: "OpenAlex", href: `https://openalex.org/${node.openalex_id}` });
  }
  if (links.length === 0 && node.url) links.push({ label: "Link", href: node.url });

  for (const link of links) {
    const a = document.createElement("a");
    a.className = "ext-link";
    a.href = link.href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = `${link.label} ↗`;
    inspLinks.appendChild(a);
  }

  // Tab 1: Overview
  if (node.abstract) {
    inspAbstract.textContent = node.abstract;
    inspAbstract.classList.remove("muted");
  } else if (!offlineMode && !detailsAttemptedIds.has(nodeId) && node.expandable) {
    inspAbstract.textContent = "Fetching abstract...";
    inspAbstract.classList.add("muted");
    void lazyLoadPaperDetails(nodeId);
  } else {
    inspAbstract.textContent = offlineMode
      ? "Abstract lookup paused (Local-only mode)."
      : "No abstract indexed for this paper.";
    inspAbstract.classList.add("muted");
  }
  inspYear.textContent = node.year ? String(node.year) : "—";
  inspVenue.textContent = node.venue ?? "—";
  inspAuthors.textContent = node.authors.length ? node.authors.join(", ") : "—";
  inspGlobalCites.textContent =
    typeof node.cited_by_count === "number" ? node.cited_by_count.toLocaleString() : "—";

  if (node.raw_citation) {
    inspRawSection.classList.remove("hidden");
    inspRaw.textContent = node.raw_citation;
  } else {
    inspRawSection.classList.add("hidden");
  }

  const contexts = node.citation_contexts ?? [];
  inspContexts.innerHTML = "";
  if (contexts.length > 0) {
    inspContextsSection.classList.remove("hidden");
    for (const ctx of contexts) {
      const li = document.createElement("li");
      li.textContent = `“${ctx}”`;
      inspContexts.appendChild(li);
    }
  } else {
    inspContextsSection.classList.add("hidden");
  }

  // Tab 2: Connections
  connCitesCount.textContent = String(conn.cites.length);
  connCitedByCount.textContent = String(conn.citedBy.length);
  connSharedCount.textContent = String(conn.sharedWith.length);

  inspCitesSection.classList.toggle("hidden", conn.cites.length === 0);
  renderPaperJumpList(inspCites, conn.cites.map((n) => ({ node: n })));

  inspCitedBySection.classList.toggle("hidden", conn.citedBy.length === 0);
  renderPaperJumpList(inspCitedBy, conn.citedBy.map((n) => ({ node: n })));

  inspSharedSection.classList.toggle("hidden", conn.sharedWith.length === 0);
  renderPaperJumpList(
    inspShared,
    conn.sharedWith.map(({ node: n, count }) => ({ node: n, suffix: `${count} shared` }))
  );

  const hasAnyConn =
    conn.cites.length > 0 || conn.citedBy.length > 0 || conn.sharedWith.length > 0;
  inspConnEmpty.classList.toggle("hidden", hasAnyConn);

  // Tab 3: Insights
  const reasons: string[] = [];
  if (node.is_retracted) {
    reasons.push("Marked as retracted in OpenAlex — verify claims and retraction notice before citing.");
  }
  if (node.is_seed) {
    reasons.push("Seed paper directly loaded into your workspace.");
  }
  if (conn.connectedSeeds.length >= 2) {
    reasons.push(
      `Bridge paper connecting ${conn.connectedSeeds.length} of ${totalSeeds} seed papers.`
    );
  }
  if (inDeg >= 2) {
    reasons.push(`Cited by ${inDeg} papers within this graph.`);
  }
  if (typeof node.cited_by_count === "number" && node.cited_by_count >= 500) {
    reasons.push(`High global impact (${node.cited_by_count.toLocaleString()} citations).`);
  }
  if (conn.sharedWith.length > 0) {
    reasons.push(
      `Shares references with ${conn.sharedWith.length} other paper${conn.sharedWith.length === 1 ? "" : "s"} in the network.`
    );
  }
  if (reasons.length === 0) {
    reasons.push("Direct citation in your current literature network. Expand older/newer to uncover more links.");
  }

  inspReasons.innerHTML = "";
  for (const r of reasons) {
    const li = document.createElement("li");
    li.textContent = r;
    inspReasons.appendChild(li);
  }

  const seedDenom = node.is_seed ? Math.max(1, totalSeeds - 1) : totalSeeds;
  insBridgeScore.textContent = `${conn.connectedSeeds.length}/${seedDenom}`;
  insIndeg.textContent = String(inDeg);
  insOutdeg.textContent = String(conn.cites.length);

  const topics = node.topics ?? [];
  inspTopics.innerHTML = "";
  if (topics.length > 0) {
    inspTopicsSection.classList.remove("hidden");
    for (const t of topics) {
      const span = document.createElement("span");
      span.className = "badge";
      span.textContent = t;
      inspTopics.appendChild(span);
    }
  } else {
    inspTopicsSection.classList.add("hidden");
  }

  inspBridgeSeedsSection.classList.toggle("hidden", conn.connectedSeeds.length === 0);
  renderPaperJumpList(inspBridgeSeeds, conn.connectedSeeds.map((n) => ({ node: n })));

  // Tab 4: Actions
  expandBtn.textContent = node.is_expanded ? "Older ✓" : "← Older";
  expandBtn.disabled = offlineMode || node.is_expanded || !node.expandable;

  expandCitedByBtn.textContent = node.is_cited_by_expanded ? "Newer ✓" : "→ Newer";
  expandCitedByBtn.disabled = offlineMode || node.is_cited_by_expanded || !node.expandable;

  toggleSeedBtn.textContent = node.is_seed ? "Remove seed" : "Add as seed";
  newGraphBtn.disabled = offlineMode || !node.expandable;
  copyBibtexBtn.textContent = "Copy BibTeX";

  setInspectorTab(activeInspectorTab);

  if (!panelState.rightOpen) {
    panelState.rightOpen = true;
    applyPanelLayout();
  }
}

async function lazyLoadPaperDetails(nodeId: string): Promise<void> {
  if (detailsAttemptedIds.has(nodeId)) return;
  detailsAttemptedIds.add(nodeId);
  const existing = store.nodes.get(nodeId);
  if (!existing || existing.abstract) return;

  try {
    const upd = await apiFetchPaperDetails(existing);
    if (upd && upd.node) {
      const target = store.nodes.get(nodeId);
      if (target) {
        if (upd.node.abstract) target.abstract = upd.node.abstract;
        if ((upd.node.topics?.length ?? 0) > (target.topics?.length ?? 0)) {
          target.topics = upd.node.topics;
        }
        if (target.cited_by_count === null && upd.node.cited_by_count !== null) {
          target.cited_by_count = upd.node.cited_by_count;
        }
        if (!target.doi && upd.node.doi) target.doi = upd.node.doi;
        if (!target.arxiv_id && upd.node.arxiv_id) target.arxiv_id = upd.node.arxiv_id;
        if (!target.openalex_id && upd.node.openalex_id) target.openalex_id = upd.node.openalex_id;
        if (!target.venue && upd.node.venue) target.venue = upd.node.venue;
        if (!target.year && upd.node.year) target.year = upd.node.year;
        if (upd.node.is_retracted) target.is_retracted = true;
        if (target.authors.length === 0 && upd.node.authors.length > 0) {
          target.authors = upd.node.authors;
        }
        store.saveHistory(layoutSelect.value as LayoutMode);
      }
    }
  } catch {
    // Ignore transient network errors
  }

  if (store.selectedId === nodeId) {
    openInspector(nodeId);
  }
}

function closeInspector(): void {
  store.selectedId = null;
  if (panelState.rightOpen) {
    panelState.rightOpen = false;
    applyPanelLayout();
  }
}

function formatTimeAgo(ts: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return "now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h`;
  return new Date(ts).toLocaleDateString();
}

function renderHistory(): void {
  const items = store.readHistory();
  historyCount.textContent = String(items.length);
  historyList.innerHTML = "";
  if (items.length === 0) {
    const li = document.createElement("li");
    li.className = "muted-empty";
    li.textContent = "Empty";
    historyList.appendChild(li);
    return;
  }

  for (const item of items) {
    const li = document.createElement("li");
    li.className = `history-item${item.id === store.activeHistoryId ? " active" : ""}`;

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.className = "history-load-btn";
    loadBtn.title = item.title;
    loadBtn.addEventListener("click", () => {
      const restoredLayout = store.restoreHistory(item.id);
      if (restoredLayout) {
        layoutSelect.value = restoredLayout;
        layoutDropdown.sync();
        graphView.setLayoutMode(restoredLayout);
      }
      setDiscoverOpen(false);
      hideTooltip();
      showMessages([]);
      renderAll();
      renderHistory();
    });

    const titleSpan = document.createElement("span");
    titleSpan.className = "history-title";
    titleSpan.textContent = item.title;

    const metaSpan = document.createElement("span");
    metaSpan.className = "history-meta";
    metaSpan.textContent = `${item.nodeCount} · ${formatTimeAgo(item.savedAt)}`;

    loadBtn.appendChild(titleSpan);
    loadBtn.appendChild(metaSpan);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "history-del-btn";
    delBtn.title = "Remove";
    delBtn.textContent = "×";
    delBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      store.deleteHistory(item.id);
      renderHistory();
    });

    li.appendChild(loadBtn);
    li.appendChild(delBtn);
    historyList.appendChild(li);
  }
}

// API Handlers
async function handleFileUpload(fileList: FileList): Promise<void> {
  const all = Array.from(fileList);
  const pdfFiles = all.filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  const bibFiles = all.filter((f) => f.name.toLowerCase().endsWith(".bib"));
  const risFiles = all.filter((f) => f.name.toLowerCase().endsWith(".ris"));
  if (pdfFiles.length === 0 && bibFiles.length === 0 && risFiles.length === 0) {
    showMessages(["Select one or more .pdf, .bib, or .ris files."], true);
    return;
  }

  setDiscoverOpen(false);
  setLoading(
    true,
    `Parsing ${pdfFiles.length + bibFiles.length + risFiles.length} file(s)${offlineMode ? " (local only)" : ""}...`
  );
  showMessages([]);
  try {
    const warnings: string[] = [];
    if (pdfFiles.length > 0) {
      const data = await apiUploadPdfs(pdfFiles, offlineMode);
      store.mergePayload(data);
      warnings.push(...data.warnings);
    }
    if (bibFiles.length > 0) {
      const data = await apiUploadBibs(bibFiles, offlineMode);
      store.mergePayload(data);
      warnings.push(...data.warnings);
    }
    if (risFiles.length > 0) {
      const data = await apiUploadRis(risFiles, offlineMode);
      store.mergePayload(data);
      warnings.push(...data.warnings);
    }
    renderAll();
    store.saveHistory(layoutSelect.value as LayoutMode);
    renderHistory();

    if (warnings.length) showMessages(warnings);
    if ((bibFiles.length > 0 || risFiles.length > 0) && !offlineMode && store.nodes.size >= 3) {
      // Offer one-click cross-citation linking right after bibliography import
      const toast = document.createElement("div");
      toast.className = "toast toast-action";
      const txt = document.createElement("span");
      txt.textContent = "Bibliography imported. Interconnect citations?";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-primary btn-sm";
      btn.textContent = "Connect refs";
      btn.addEventListener("click", () => void handleCrossCitations());
      toast.appendChild(txt);
      toast.appendChild(btn);
      statusArea.prepend(toast);
    }
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Upload failed."], true);
  } finally {
    setLoading(false);
    if (offlineMode) statusBarMsg.textContent = "Local-only · zero outbound requests";
    pdfInput.value = "";
  }
}

async function handleLookup(rawText: string): Promise<void> {
  if (offlineMode) return;
  const ids = rawText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    showMessages(["Enter a DOI or arXiv ID."], true);
    return;
  }

  setDiscoverOpen(false);
  setLoading(true, `Fetching ${ids.length} paper(s)...`);
  showMessages([]);
  try {
    const data = await apiLookupIdentifiers(ids);
    store.mergePayload(data);
    renderAll();
    store.saveHistory(layoutSelect.value as LayoutMode);
    renderHistory();
    if (data.warnings.length) showMessages(data.warnings);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Lookup failed."], true);
  } finally {
    setLoading(false);
  }
}

async function handleExpandOlder(): Promise<void> {
  if (!store.selectedId) return;
  const node = store.nodes.get(store.selectedId);
  if (!node || node.is_expanded) return;

  expandBtn.disabled = true;
  expandBtn.textContent = "Loading...";
  statusBarMsg.textContent = "Expanding references...";
  showMessages([]);
  try {
    const data = await apiExpandReferences(node);
    if (data.nodes.length > 0) {
      store.pushUndoSnapshot(`Older · ${formatCompactLabel(node)}`);
      const edgeColor = node.is_seed ? null : store.getColorForExpandedPaper(node.id);
      store.mergePayload(data, node.id, edgeColor);
      renderAll();
      store.saveHistory(layoutSelect.value as LayoutMode);
      renderHistory();
    } else {
      openInspector(node.id);
    }
    statusBarMsg.textContent = "Ready";
    if (data.warnings.length) showMessages(data.warnings);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Expansion failed."], true);
    expandBtn.disabled = false;
    expandBtn.textContent = "← Older";
  }
}

async function handleExpandNewer(): Promise<void> {
  if (!store.selectedId) return;
  const node = store.nodes.get(store.selectedId);
  if (!node || node.is_cited_by_expanded) return;

  expandCitedByBtn.disabled = true;
  expandCitedByBtn.textContent = "Loading...";
  statusBarMsg.textContent = "Fetching forward citations...";
  showMessages([]);
  try {
    const data = await apiExpandCitedBy(node, 30);
    if (data.nodes.length > 0) {
      store.pushUndoSnapshot(`Newer · ${formatCompactLabel(node)}`);
      const edgeColor = node.is_seed ? null : store.getColorForExpandedPaper(node.id);
      store.mergePayload(data, node.id, edgeColor);
      renderAll();
      store.saveHistory(layoutSelect.value as LayoutMode);
      renderHistory();
    } else {
      openInspector(node.id);
    }
    statusBarMsg.textContent = "Ready";
    if (data.warnings.length) showMessages(data.warnings);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Forward lookup failed."], true);
    expandCitedByBtn.disabled = false;
    expandCitedByBtn.textContent = "→ Newer";
  }
}

async function handleNewGraphFromNode(): Promise<void> {
  if (!store.selectedId) return;
  const node = store.nodes.get(store.selectedId);
  if (!node) return;

  store.saveHistory(layoutSelect.value as LayoutMode);
  setLoading(true, `Building graph for "${formatCompactLabel(node)}"...`);
  showMessages([]);
  try {
    const data = await apiExpandReferences(node);
    store.clear();

    const seedNodes = data.nodes.map((n) =>
      n.id === data.source_id ? { ...n, is_seed: true, is_expanded: true } : n
    );
    if (seedNodes.length === 0) {
      seedNodes.push({ ...node, is_seed: true, is_expanded: false, is_cited_by_expanded: false });
    }

    store.mergePayload({ nodes: seedNodes, edges: data.edges, source_id: data.source_id });
    store.selectedId = store.primarySeedId;
    renderAll();
    store.saveHistory(layoutSelect.value as LayoutMode);
    renderHistory();
    if (data.warnings.length) showMessages(data.warnings);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Failed to create new graph."], true);
  } finally {
    setLoading(false);
  }
}

async function handleCrossCitations(): Promise<void> {
  if (offlineMode) return;
  const allNodes = Array.from(store.nodes.values());
  if (allNodes.length < 3) return;

  crossCiteBtn.disabled = true;
  setLoading(true, `Checking cross-citations across ${allNodes.length} papers...`);
  showMessages([]);
  try {
    const data = await apiFindCrossCitations(allNodes);
    const beforeEdges = store.edges.size;
    store.pushUndoSnapshot("Connect references");

    for (const upd of data.updates) {
      store.mergePayload({ nodes: [upd.node], edges: [], source_id: upd.node.id }, upd.old_id);
    }
    store.mergePayload({ nodes: [], edges: data.edges });
    const added = store.edges.size - beforeEdges;

    if (added > 0 || data.updates.length > 0) {
      renderAll();
      store.saveHistory(layoutSelect.value as LayoutMode);
      renderHistory();
    } else {
      store.undoStack.pop();
      updateUndoButton();
    }

    const msgs = [...data.warnings];
    msgs.unshift(
      added > 0
        ? `Connected ${added} cross-citation${added === 1 ? "" : "s"} between references.`
        : "No additional cross-citations found among current papers."
    );
    showMessages(msgs);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Cross-citation lookup failed."], true);
  } finally {
    crossCiteBtn.disabled = offlineMode;
    setLoading(false);
  }
}

async function handleEnrichYears(): Promise<void> {
  if (offlineMode) return;
  const undated = Array.from(store.nodes.values()).filter((n) => !n.year);
  if (undated.length === 0) return;

  enrichYearsBtn.disabled = true;
  setLoading(true, `Resolving ${undated.length} year(s)...`);
  showMessages([]);
  try {
    const data = await apiEnrichNodes(undated);
    for (const upd of data.updates) {
      store.mergePayload({ nodes: [upd.node], edges: [], source_id: upd.node.id }, upd.old_id);
    }
    if (data.updates.length > 0) {
      renderAll();
      store.saveHistory(layoutSelect.value as LayoutMode);
      renderHistory();
    }
    const msgs = [...data.warnings];
    msgs.unshift(
      data.updates.length > 0
        ? `Resolved ${data.updates.length} of ${undated.length} year(s).`
        : `No years found for ${undated.length} paper(s).`
    );
    showMessages(msgs);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Enrichment failed."], true);
  } finally {
    enrichYearsBtn.disabled = offlineMode;
    setLoading(false);
  }
}

function handleUndo(): void {
  const undone = store.undo();
  if (!undone) return;
  hideTooltip();
  renderAll();
  store.saveHistory(layoutSelect.value as LayoutMode);
  renderHistory();
  showMessages([`Undid: ${undone}`]);
}

// Event listeners
toggleLeftBtn.addEventListener("click", () => {
  panelState.leftOpen = !panelState.leftOpen;
  applyPanelLayout();
});

toggleRightBtn.addEventListener("click", () => {
  panelState.rightOpen = !panelState.rightOpen;
  if (panelState.rightOpen && !store.selectedId) {
    renderEmptyInspector();
  }
  applyPanelLayout();
});

tabWorkspaceBtn.addEventListener("click", () => setDiscoverOpen(false));
tabDiscoverBtn.addEventListener("click", () => setDiscoverOpen(true));
discoverCloseBtn.addEventListener("click", () => setDiscoverOpen(false));
discoverSortSelect.addEventListener("change", () => renderDiscover());

themeToggle.addEventListener("click", () => {
  const next: ThemeMode = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
});

offlineToggleBtn.addEventListener("click", () => {
  applyOfflineMode(!offlineMode);
});

exportBibBtn.addEventListener("click", () => {
  const visibleIds = new Set<string>(
    graphView.cy.nodes(".paper").not(".ego-hidden").map((n) => n.id())
  );
  const entries: string[] = [];
  for (const id of visibleIds) {
    const node = store.nodes.get(id);
    if (node && node.expandable) {
      entries.push(store.toBibtex(node));
    }
  }
  if (entries.length === 0) {
    showMessages(["No papers to export as BibTeX."], true);
    return;
  }
  const blob = new Blob([entries.join("\n\n") + "\n"], { type: "application/x-bibtex;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "citation-graph.bib";
  a.click();
  URL.revokeObjectURL(url);
  showMessages([`Exported ${entries.length} paper(s) to citation-graph.bib.`]);
});

dropzone.addEventListener("click", () => pdfInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pdfInput.click();
  }
});
pdfInput.addEventListener("change", () => {
  if (pdfInput.files?.length) void handleFileUpload(pdfInput.files);
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) void handleFileUpload(e.dataTransfer.files);
});

lookupBtn.addEventListener("click", () => void handleLookup(idInput.value));
demoBtn.addEventListener("click", () => {
  idInput.value = "1706.03762\n1810.04805";
  void handleLookup(idInput.value);
});

layoutSelect.addEventListener("change", () =>
  graphView.setLayoutMode(layoutSelect.value as LayoutMode)
);
labelModeSelect.addEventListener("change", () =>
  graphView.setLabelMode(labelModeSelect.value as LabelMode)
);
relevanceSelect.addEventListener("change", () => renderAll());
directionSelect.addEventListener("change", () => renderAll());
densitySelect.addEventListener("change", () => renderAll());
depthSelect.addEventListener("change", () => renderAll());
sizeModeSelect.addEventListener("change", () => renderAll());
minCitesSelect.addEventListener("change", () => renderAll());
topicSelect.addEventListener("change", () => renderAll());
minYearInput.addEventListener("input", () => renderAll());
maxYearInput.addEventListener("input", () => renderAll());
resetFiltersBtn.addEventListener("click", () => {
  relevanceSelect.value = "all";
  directionSelect.value = "both";
  densitySelect.value = "all";
  depthSelect.value = "all";
  sizeModeSelect.value = "degree";
  minCitesSelect.value = "0";
  topicSelect.value = "";
  minYearInput.value = "";
  maxYearInput.value = "";
  relevanceDropdown.sync();
  directionDropdown.sync();
  densityDropdown.sync();
  depthDropdown.sync();
  sizeDropdown.sync();
  minCitesDropdown.sync();
  topicDropdown?.sync();
  renderAll();
});
searchInput.addEventListener("input", () => graphView.applySearchHighlight(searchInput.value));
crossCiteBtn.addEventListener("click", () => void handleCrossCitations());
rearrangeBtn.addEventListener("click", () => graphView.applyLayout(true));
enrichYearsBtn.addEventListener("click", () => void handleEnrichYears());
pathClearBtn.addEventListener("click", () => clearPathMode());
undoBtn.addEventListener("click", () => handleUndo());
fitBtn.addEventListener("click", () => graphView.fit());

zoomInBtn.addEventListener("click", () => {
  const cy = graphView.cy;
  const center = { x: cy.width() / 2, y: cy.height() / 2 };
  cy.zoom({ level: Math.min(5, cy.zoom() * 1.3), renderedPosition: center });
});

zoomOutBtn.addEventListener("click", () => {
  const cy = graphView.cy;
  const center = { x: cy.width() / 2, y: cy.height() / 2 };
  cy.zoom({ level: Math.max(0.1, cy.zoom() / 1.3), renderedPosition: center });
});

exportSvgBtn.addEventListener("click", () => {
  if (store.nodes.size === 0) {
    showMessages(["Graph is empty."], true);
    return;
  }
  const isDark = document.documentElement.dataset.theme === "dark";
  const svgContent = graphView.exportSvg(isDark ? "#09090b" : "#fafafa");
  const blob = new Blob([svgContent], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "citation-graph.svg";
  a.click();
  URL.revokeObjectURL(url);
});

exportPngBtn.addEventListener("click", () => {
  if (store.nodes.size === 0) {
    showMessages(["Graph is empty."], true);
    return;
  }
  const isDark = document.documentElement.dataset.theme === "dark";
  const dataUrl = graphView.cy.png({
    full: true,
    scale: 2,
    bg: isDark ? "#09090b" : "#fafafa",
  });
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = "citation-graph.png";
  a.click();
});

exportBtn.addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(store.toExportJson(), null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "citation-graph.json";
  a.click();
  URL.revokeObjectURL(url);
});

clearBtn.addEventListener("click", () => {
  store.clear();
  hideTooltip();
  showMessages([]);
  closeInspector();
  renderAll();
  renderHistory();
});

clearHistoryBtn.addEventListener("click", () => {
  store.clearHistory();
  renderHistory();
});

inspClose.addEventListener("click", () => {
  graphView.cy.elements().unselect();
  closeInspector();
});
inspTabButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    const tab = btn.dataset.tab as InspectorTab | undefined;
    if (tab) setInspectorTab(tab);
  });
});

restoreHiddenBtn.addEventListener("click", () => {
  store.hiddenIds.clear();
  renderAll();
});

toggleSeedBtn.addEventListener("click", () => {
  if (!store.selectedId) return;
  const node = store.nodes.get(store.selectedId);
  if (!node) return;
  node.is_seed = !node.is_seed;
  if (node.is_seed && !store.primarySeedId) store.primarySeedId = node.id;
  renderAll();
  store.saveHistory(layoutSelect.value as LayoutMode);
  renderHistory();
});

copyBibtexBtn.addEventListener("click", async () => {
  if (!store.selectedId) return;
  const node = store.nodes.get(store.selectedId);
  if (!node) return;
  const bib = store.toBibtex(node);
  try {
    await navigator.clipboard.writeText(bib);
    copyBibtexBtn.textContent = "Copied ✓";
    window.setTimeout(() => {
      copyBibtexBtn.textContent = "Copy BibTeX";
    }, 1800);
  } catch {
    showMessages(["Could not access clipboard."], true);
  }
});

hideNodeBtn.addEventListener("click", () => {
  if (!store.selectedId) return;
  store.hiddenIds.add(store.selectedId);
  closeInspector();
  renderAll();
});

expandBtn.addEventListener("click", () => void handleExpandOlder());
expandCitedByBtn.addEventListener("click", () => void handleExpandNewer());
newGraphBtn.addEventListener("click", () => void handleNewGraphFromNode());
pathBtn.addEventListener("click", () => startPathFromSelected());

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (pathStartId || pathActive) {
      clearPathMode();
      return;
    }
    if (discoverOpen) {
      setDiscoverOpen(false);
      return;
    }
    if (panelState.rightOpen) {
      graphView.cy.elements().unselect();
      closeInspector();
      return;
    }
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (store.undoStack.length > 0) {
      e.preventDefault();
      handleUndo();
    }
  }
});

// Init theme, panels, and history
let initialTheme: ThemeMode = "light";
try {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "dark" || saved === "light") {
    initialTheme = saved;
  } else if (window.matchMedia?.("(prefers-color-scheme: dark)").matches) {
    initialTheme = "dark";
  }
} catch {
  // Ignore storage errors
}
const layoutDropdown = enhanceSelect(layoutSelect);
enhanceSelect(labelModeSelect);
enhanceSelect(discoverSortSelect);
const relevanceDropdown = enhanceSelect(relevanceSelect);
const directionDropdown = enhanceSelect(directionSelect);
const densityDropdown = enhanceSelect(densitySelect);
const depthDropdown = enhanceSelect(depthSelect);
const sizeDropdown = enhanceSelect(sizeModeSelect);
const minCitesDropdown = enhanceSelect(minCitesSelect);
let topicDropdown: CustomDropdown | null = enhanceSelect(topicSelect);

applyTheme(initialTheme);
try {
  applyOfflineMode(localStorage.getItem(OFFLINE_KEY) === "1");
} catch {
  applyOfflineMode(false);
}
applyPanelLayout();
renderHistory();
updateUndoButton();
