import "./styles.css";
import {
  apiEnrichNodes,
  apiExpandCitedBy,
  apiExpandReferences,
  apiLookupIdentifiers,
  apiUploadPdfs,
} from "./api";
import { CitationGraphView } from "./graph";
import { formatCompactLabel, formatFullLabel, GraphStore } from "./store";
import type { LabelMode, LayoutMode, PaperNode, ThemeMode } from "./types";

const THEME_KEY = "citation-graph:theme";

const SUN_SVG = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_SVG = `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function byId<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing required element #${id}`);
  return el as T;
}

const themeToggle = byId<HTMLButtonElement>("theme-toggle");
const dropzone = byId<HTMLDivElement>("dropzone");
const pdfInput = byId<HTMLInputElement>("pdf-input");
const idInput = byId<HTMLTextAreaElement>("id-input");
const lookupBtn = byId<HTMLButtonElement>("lookup-btn");
const demoBtn = byId<HTMLButtonElement>("demo-btn");
const layoutSelect = byId<HTMLSelectElement>("layout-select");
const labelModeSelect = byId<HTMLSelectElement>("label-mode-select");
const sharedOnlyToggle = byId<HTMLInputElement>("shared-only-toggle");
const searchInput = byId<HTMLInputElement>("search-input");
const enrichYearsBtn = byId<HTMLButtonElement>("enrich-years-btn");
const undoBtn = byId<HTMLButtonElement>("undo-btn");
const fitBtn = byId<HTMLButtonElement>("fit-btn");
const exportBtn = byId<HTMLButtonElement>("export-btn");
const clearBtn = byId<HTMLButtonElement>("clear-btn");
const statusArea = byId<HTMLDivElement>("status-area");
const historyList = byId<HTMLUListElement>("history-list");
const clearHistoryBtn = byId<HTMLButtonElement>("clear-history-btn");
const emptyState = byId<HTMLDivElement>("empty-state");
const loadingOverlay = byId<HTMLDivElement>("loading-overlay");
const loadingText = byId<HTMLSpanElement>("loading-text");
const hoverTooltip = byId<HTMLDivElement>("hover-tooltip");

const statSeeds = byId<HTMLElement>("stat-seeds");
const statNodes = byId<HTMLElement>("stat-nodes");
const statShared = byId<HTMLElement>("stat-shared");
const statEdges = byId<HTMLElement>("stat-edges");

const inspector = byId<HTMLElement>("inspector");
const inspClose = byId<HTMLButtonElement>("insp-close");
const inspTitle = byId<HTMLHeadingElement>("insp-title");
const inspBadges = byId<HTMLDivElement>("insp-badges");
const inspYear = byId<HTMLElement>("insp-year");
const inspVenue = byId<HTMLElement>("insp-venue");
const inspAuthors = byId<HTMLElement>("insp-authors");
const inspGlobalCites = byId<HTMLElement>("insp-global-cites");
const inspLinks = byId<HTMLDivElement>("insp-links");
const expandBtn = byId<HTMLButtonElement>("expand-btn");
const expandCitedByBtn = byId<HTMLButtonElement>("expand-cited-by-btn");
const newGraphBtn = byId<HTMLButtonElement>("new-graph-btn");
const inspCitedBySection = byId<HTMLDivElement>("insp-cited-by-section");
const inspCitedBy = byId<HTMLUListElement>("insp-cited-by");
const inspRawSection = byId<HTMLDivElement>("insp-raw-section");
const inspRaw = byId<HTMLParagraphElement>("insp-raw");

const store = new GraphStore();

const graphView = new CitationGraphView(byId<HTMLDivElement>("cy"), store, {
  onSelectNode: (nodeId) => openInspector(nodeId),
  onClearSelection: () => closeInspector(),
  onHoverNode: (nodeId, pos) => showTooltip(nodeId, pos),
  onUnhoverNode: () => hideTooltip(),
});

function setLoading(isLoading: boolean, text = "Loading"): void {
  loadingText.textContent = text;
  loadingOverlay.classList.toggle("hidden", !isLoading);
}

function showMessages(messages: string[], isError = false): void {
  statusArea.innerHTML = "";
  for (const msg of messages) {
    const div = document.createElement("div");
    div.className = isError ? "toast error" : "toast";
    div.textContent = msg;
    statusArea.appendChild(div);
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

function updateStats(): void {
  const inDeg = store.computeInDegrees();
  let seeds = 0;
  let shared = 0;
  let unknownYears = 0;
  for (const [id, node] of store.nodes.entries()) {
    if (node.is_seed) seeds += 1;
    else if ((inDeg.get(id) ?? 0) >= 2) shared += 1;
    if (!node.year) unknownYears += 1;
  }

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
}

function updateUndoButton(): void {
  const count = store.undoStack.length;
  undoBtn.disabled = count === 0;
  undoBtn.title =
    count > 0 ? `Undo: ${store.undoStack[count - 1].label} (Ctrl+Z)` : "Nothing to undo";
}

function renderAll(): void {
  graphView.render(sharedOnlyToggle.checked, searchInput.value);
  updateStats();
  updateUndoButton();
  emptyState.classList.toggle("hidden", store.nodes.size > 0);

  if (store.selectedId && store.nodes.has(store.selectedId)) {
    openInspector(store.selectedId);
  } else {
    closeInspector();
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

function openInspector(nodeId: string): void {
  const node = store.nodes.get(nodeId);
  if (!node) return;
  store.selectedId = nodeId;

  const inDeg = store.computeInDegrees().get(nodeId) ?? 0;
  inspTitle.textContent = node.title || "Untitled";
  inspYear.textContent = node.year ? String(node.year) : "—";
  inspVenue.textContent = node.venue ?? "—";
  inspAuthors.textContent = node.authors.length ? node.authors.join(", ") : "—";
  inspGlobalCites.textContent =
    typeof node.cited_by_count === "number" ? node.cited_by_count.toLocaleString() : "—";

  inspBadges.innerHTML = "";
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

  expandBtn.textContent = node.is_expanded ? "Older ✓" : "← Older";
  expandBtn.disabled = node.is_expanded || !node.expandable;

  expandCitedByBtn.textContent = node.is_cited_by_expanded ? "Newer ✓" : "→ Newer";
  expandCitedByBtn.disabled = node.is_cited_by_expanded || !node.expandable;

  newGraphBtn.disabled = !node.expandable;

  const citers: PaperNode[] = [];
  for (const key of store.edges) {
    const [src, dst] = key.split("->");
    if (dst === nodeId) {
      const citer = store.nodes.get(src);
      if (citer) citers.push(citer);
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
        graphView.focusNode(citer.id);
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

function closeInspector(): void {
  store.selectedId = null;
  inspector.classList.add("hidden");
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
        graphView.setLayoutMode(restoredLayout);
      }
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

async function handlePdfUpload(fileList: FileList): Promise<void> {
  const files = Array.from(fileList).filter((f) => f.name.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    showMessages(["Select a PDF file."], true);
    return;
  }

  setLoading(true, `Parsing ${files.length} PDF(s)...`);
  showMessages([]);
  try {
    const data = await apiUploadPdfs(files);
    store.mergePayload(data);
    renderAll();
    store.saveHistory(layoutSelect.value as LayoutMode);
    renderHistory();
    if (data.warnings.length) showMessages(data.warnings);
  } catch (err) {
    showMessages([err instanceof Error ? err.message : "Upload failed."], true);
  } finally {
    setLoading(false);
    pdfInput.value = "";
  }
}

async function handleLookup(rawText: string): Promise<void> {
  const ids = rawText
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    showMessages(["Enter a DOI or arXiv ID."], true);
    return;
  }

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

  // Preserve current graph in history before starting fresh
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

async function handleEnrichYears(): Promise<void> {
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
    enrichYearsBtn.disabled = false;
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
themeToggle.addEventListener("click", () => {
  const next: ThemeMode = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
});

dropzone.addEventListener("click", () => pdfInput.click());
dropzone.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    pdfInput.click();
  }
});
pdfInput.addEventListener("change", () => {
  if (pdfInput.files?.length) void handlePdfUpload(pdfInput.files);
});
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  if (e.dataTransfer?.files?.length) void handlePdfUpload(e.dataTransfer.files);
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
sharedOnlyToggle.addEventListener("change", () => renderAll());
searchInput.addEventListener("input", () => graphView.applySearchHighlight(searchInput.value));
enrichYearsBtn.addEventListener("click", () => void handleEnrichYears());
undoBtn.addEventListener("click", () => handleUndo());
fitBtn.addEventListener("click", () => graphView.fit());

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
expandBtn.addEventListener("click", () => void handleExpandOlder());
expandCitedByBtn.addEventListener("click", () => void handleExpandNewer());
newGraphBtn.addEventListener("click", () => void handleNewGraphFromNode());

document.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !e.shiftKey) {
    const tag = (document.activeElement?.tagName ?? "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (store.undoStack.length > 0) {
      e.preventDefault();
      handleUndo();
    }
  }
});

// Init theme & history
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
applyTheme(initialTheme);
renderHistory();
updateUndoButton();
