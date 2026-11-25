(() => {
  const DEFAULT_BASE_URL = "http://127.0.0.1:8000";
  const BUTTON_HOST_ID = "opencite-floating-host";

  function extractPaperId() {
    const href = window.location.href;
    const host = window.location.hostname.toLowerCase();

    // 1. arXiv / alphaXiv URLs
    const arxivMatch = href.match(
      /(?:arxiv\.org|alphaxiv\.org)\/(?:abs|pdf)\/(\d{4}\.\d{4,5}(?:v\d+)?|[a-z-]+\/\d{7}(?:v\d+)?)/i
    );
    if (arxivMatch) {
      return `arxiv:${arxivMatch[1].replace(/v\d+$/i, "")}`;
    }

    // 2. Meta tags (PubMed, Nature, Science, bioRxiv, Springer, ACM, IEEE, etc.)
    const metaSelectors = [
      'meta[name="citation_doi"]',
      'meta[name="dc.identifier"]',
      'meta[name="DC.Identifier"]',
      'meta[name="prism.doi"]',
      'meta[name="citation_arxiv_id"]'
    ];
    for (const sel of metaSelectors) {
      const el = document.querySelector(sel);
      const val = el?.getAttribute("content")?.trim();
      if (!val) continue;
      if (sel.includes("arxiv")) {
        return `arxiv:${val.replace(/^arxiv:/i, "").replace(/v\d+$/i, "")}`;
      }
      const doiInMeta = val.match(/(10\.\d{4,9}\/[^\s;]+)/i);
      if (doiInMeta) {
        return doiInMeta[1].replace(/[.,;]+$/, "");
      }
    }

    // 3. PubMed DOI link in header
    if (host.includes("pubmed.ncbi.nlm.nih.gov")) {
      const doiEl = document.querySelector(".citation-doi, a.id-link[href*='doi.org/']");
      const txt = doiEl?.getAttribute("href") || doiEl?.textContent || "";
      const m = txt.match(/(10\.\d{4,9}\/[^\s.;]+(?:\.[^\s.;]+)*)/i);
      if (m) return m[1].replace(/[.,;]+$/, "");
    }

    // 4. Direct doi.org URL
    const urlDoi = href.match(/doi\.org\/(10\.\d{4,9}\/[^\s?#]+)/i);
    if (urlDoi) {
      return decodeURIComponent(urlDoi[1]);
    }

    return null;
  }

  function injectButton(paperId) {
    if (document.getElementById(BUTTON_HOST_ID)) return;

    const host = document.createElement("div");
    host.id = BUTTON_HOST_ID;
    host.style.position = "fixed";
    host.style.right = "18px";
    host.style.bottom = "18px";
    host.style.zIndex = "2147483647";

    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = `
      .oc-btn {
        display: inline-flex;
        align-items: center;
        gap: 7px;
        padding: 9px 14px;
        border-radius: 999px;
        border: 1px solid #27272a;
        background: #09090b;
        color: #fafafa;
        font-family: "Google Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
        transition: transform 0.14s ease, background 0.14s ease, box-shadow 0.14s ease;
      }
      .oc-btn:hover {
        background: #18181b;
        transform: translateY(-1px);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.28);
      }
      .oc-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: #38bdf8;
        flex-shrink: 0;
      }
    `;

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "oc-btn";
    btn.title = `Open ${paperId} in OpenCite`;
    btn.innerHTML = `<span class="oc-dot"></span><span>Open in OpenCite ↗</span>`;

    btn.addEventListener("click", () => {
      const storage = typeof chrome !== "undefined" && chrome.storage?.sync ? chrome.storage.sync : null;
      if (storage) {
        storage.get({ baseUrl: DEFAULT_BASE_URL }, (items) => {
          const base = String(items.baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, "");
          window.open(`${base}/?id=${encodeURIComponent(paperId)}`, "_blank", "noopener");
        });
      } else {
        window.open(`${DEFAULT_BASE_URL}/?id=${encodeURIComponent(paperId)}`, "_blank", "noopener");
      }
    });

    shadow.appendChild(style);
    shadow.appendChild(btn);
    document.body.appendChild(host);
  }

  const paperId = extractPaperId();
  if (paperId) {
    injectButton(paperId);
  }

  // Expose extraction to the popup if clicked manually
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (msg?.type === "OPENCITE_GET_ID") {
        sendResponse({ paperId: extractPaperId() });
      }
    });
  }
})();
