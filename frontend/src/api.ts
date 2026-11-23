import type {
  CrossCitationsResponse,
  EnrichResponse,
  ExpandResponse,
  GraphPayload,
  PaperNode,
} from "./types";

async function parseJsonOrThrow<T>(resp: Response, fallbackMsg: string): Promise<T> {
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : fallbackMsg;
    throw new Error(detail);
  }
  return data as T;
}

export async function apiUploadPdfs(files: File[]): Promise<GraphPayload> {
  const form = new FormData();
  for (const file of files) {
    form.append("files", file);
  }
  const resp = await fetch("/api/papers/pdf", { method: "POST", body: form });
  return parseJsonOrThrow<GraphPayload>(resp, "Failed to parse PDF.");
}

export async function apiLookupIdentifiers(identifiers: string[]): Promise<GraphPayload> {
  const resp = await fetch("/api/papers/lookup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifiers }),
  });
  return parseJsonOrThrow<GraphPayload>(resp, "Lookup failed.");
}

export async function apiExpandReferences(node: PaperNode): Promise<ExpandResponse> {
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
  return parseJsonOrThrow<ExpandResponse>(resp, "Expansion failed.");
}

export async function apiExpandCitedBy(node: PaperNode, limit = 30): Promise<ExpandResponse> {
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
      limit,
    }),
  });
  return parseJsonOrThrow<ExpandResponse>(resp, "Forward citation lookup failed.");
}

export async function apiEnrichNodes(nodes: PaperNode[]): Promise<EnrichResponse> {
  const resp = await fetch("/api/papers/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodes: nodes.map((n) => ({
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
  return parseJsonOrThrow<EnrichResponse>(resp, "Failed to resolve unknown years.");
}

export async function apiFindCrossCitations(
  nodes: PaperNode[]
): Promise<CrossCitationsResponse> {
  const resp = await fetch("/api/papers/cross-citations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nodes: nodes.map((n) => ({
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
  return parseJsonOrThrow<CrossCitationsResponse>(resp, "Cross-citation lookup failed.");
}
