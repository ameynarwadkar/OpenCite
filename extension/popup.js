const DEFAULT_BASE_URL = "http://127.0.0.1:8000";

const urlInput = document.getElementById("base-url");
const saveBtn = document.getElementById("save-btn");
const localBtn = document.getElementById("local-btn");
const openCurrentBtn = document.getElementById("open-current-btn");
const statusEl = document.getElementById("status");

function setStatus(msg) {
  statusEl.textContent = msg;
  window.setTimeout(() => {
    if (statusEl.textContent === msg) statusEl.textContent = "";
  }, 2000);
}

chrome.storage.sync.get({ baseUrl: DEFAULT_BASE_URL }, (items) => {
  urlInput.value = items.baseUrl || DEFAULT_BASE_URL;
});

saveBtn.addEventListener("click", () => {
  const cleaned = (urlInput.value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  urlInput.value = cleaned;
  chrome.storage.sync.set({ baseUrl: cleaned }, () => setStatus("Saved."));
});

localBtn.addEventListener("click", () => {
  urlInput.value = DEFAULT_BASE_URL;
  chrome.storage.sync.set({ baseUrl: DEFAULT_BASE_URL }, () => setStatus("Set to localhost:8000."));
});

openCurrentBtn.addEventListener("click", () => {
  const base = (urlInput.value || DEFAULT_BASE_URL).trim().replace(/\/+$/, "");
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs[0];
    if (!tab?.id) return;
    chrome.tabs.sendMessage(tab.id, { type: "OPENCITE_GET_ID" }, (resp) => {
      const paperId = resp?.paperId;
      const target = paperId ? `${base}/?id=${encodeURIComponent(paperId)}` : base;
      chrome.tabs.create({ url: target });
    });
  });
});
