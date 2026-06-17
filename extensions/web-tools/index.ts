import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parseHTML } from "linkedom";
import * as fs from "node:fs";
import * as path from "node:path";

// ---------------------------------------------------------------------------
// In-memory cache with TTL — avoids redundant network calls within a session
// ---------------------------------------------------------------------------
interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function cacheGet<T>(key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return undefined;
  }
  return entry.value as T;
}

function cacheSet<T>(key: string, value: T): void {
  cache.set(key, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
}

// Periodically clean expired entries (every 2 minutes)
const cacheCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now > entry.expiresAt) cache.delete(key);
  }
}, 2 * 60 * 1000);

// Prevent the interval from keeping the process alive
if (cacheCleanupInterval.unref) cacheCleanupInterval.unref();

// ---------------------------------------------------------------------------
// Retry with exponential backoff — handles transient network failures
// ---------------------------------------------------------------------------
interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_RETRY_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  baseDelayMs: 1000,
  maxDelayMs: 8000,
};

function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const cfg = { ...DEFAULT_RETRY_OPTIONS, ...options };
  let lastError: Error | undefined;

  return Promise.resolve().then(() => {
    let attempt = 0;
    async function tryOnce(): Promise<T> {
      try {
        return await fn();
      } catch (err) {
        const isLast = attempt >= cfg.maxRetries;
        lastError = err instanceof Error ? err : new Error(String(err));

        if (isLast) {
          throw lastError;
        }

        attempt++;
        const delay = Math.min(
          cfg.baseDelayMs * Math.pow(2, attempt - 1),
          cfg.maxDelayMs,
        );

        // Add jitter to avoid thundering herd
        const jitteredDelay = delay * (0.5 + Math.random() * 0.5);

        await new Promise((resolve) => setTimeout(resolve, jitteredDelay));
        return tryOnce();
      }
    }

    return tryOnce();
  });
}

// ---------------------------------------------------------------------------
// Web tool config — reads URLs from root .env or environment
// ---------------------------------------------------------------------------
function loadEnv() {
  const home = process.env.HOME ?? "";
  const envPaths = [
    // package root: extensions/web-tools/index.ts -> ../../.env
    path.resolve(__dirname, "..", "..", ".env"),
    // backwards-compatible fallback for your current global setup
    path.join(home, ".pi", "agent", ".env"),
  ];

  for (const envPath of envPaths) {
    if (!fs.existsSync(envPath)) continue;
    for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      // Prefer variables already exported by the shell.
      if (process.env[key] !== undefined) continue;
      const value = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
      process.env[key] = value;
    }
  }
}

loadEnv();

function normalizeBaseUrl(value: string): string {
  const withProtocol = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(value)
    ? value
    : `http://${value}`;
  return withProtocol.replace(/\/+$/, "");
}

function getSearxngUrl(): string {
  return normalizeBaseUrl(process.env.SEARXNG_URL ?? "http://localhost:8080");
}

function getFirecrawlUrl(): string {
  return normalizeBaseUrl(process.env.FIRECRAWL_URL ?? "http://localhost:3002");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

async function searchSearxng(query: string, maxResults: number, signal?: AbortSignal): Promise<SearchResult[]> {
  const cacheKey = `search:${query}:${maxResults}`;
  const cached = cacheGet<SearchResult[]>(cacheKey);
  if (cached) return cached;

  const results = await withRetry(async () => {
    const baseUrl = getSearxngUrl();
    const url = `${baseUrl}/search?q=${encodeURIComponent(query)}&format=json&categories=general&language=auto`;
    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`SearXNG returned ${response.status}: ${response.statusText}`);
    const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
    return (data.results ?? [])
      .slice(0, maxResults)
      .map((r, i) => ({
        title: r.title ?? "(no title)",
        url: r.url ?? "",
        snippet: (r.content ?? "").slice(0, 300),
      }));
  });

  cacheSet(cacheKey, results);
  return results;
}

/** Strip HTML tags and collapse whitespace to produce readable plain text. */
function htmlToText(html: string): string {
  const { document } = parseHTML(html);
  const text = document.body?.textContent ?? "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[\t]+/g, " ")
    .replace(/[ ]{4,}/g, "   ") // collapse long runs but keep up to 3 spaces
    .replace(/\n{3,}/g, "\n\n");
}

async function fetchPage(url: string, signal?: AbortSignal): Promise<{ title: string; text: string }> {
  const cacheKey = `fetch:${url}`;
  const cached = cacheGet<{ title: string; text: string }>(cacheKey);
  if (cached) return cached;

  const result = await withRetry(async () => {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; pi-coding-agent/1.0)" },
      signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);

    const contentType = response.headers.get("content-type") ?? "";
    let html = await response.text();

    // If it's JSON, return as-is
    if (contentType.includes("application/json")) {
      return { title: url, text: html.slice(0, 50_000) };
    }

    const { document } = parseHTML(html);
    const title = document.title || url;
    const text = htmlToText(html);

    return { title, text: text.slice(0, 50_000) };
  });

  cacheSet(cacheKey, result);
  return result;
}

async function extractWithFirecrawl(
  url: string,
  options: {
    format: "markdown" | "html";
    onlyMainContent: boolean;
    waitFor?: number;
    timeout?: number;
  },
  signal?: AbortSignal,
): Promise<{ title: string; text: string; metadata: Record<string, unknown> }> {
  const cacheKey = `firecrawl:${url}:${options.format}:${options.onlyMainContent}`;
  const cached = cacheGet<{ title: string; text: string; metadata: Record<string, unknown> }>(cacheKey);
  if (cached) return cached;

  const baseUrl = getFirecrawlUrl();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; pi-coding-agent/1.0)",
  };

  if (process.env.FIRECRAWL_API_KEY) {
    headers.Authorization = `Bearer ${process.env.FIRECRAWL_API_KEY}`;
  }

  const result = await withRetry(async () => {
    const response = await fetch(`${baseUrl}/v1/scrape`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        url,
        formats: [options.format],
        onlyMainContent: options.onlyMainContent,
        waitFor: options.waitFor,
        timeout: options.timeout,
      }),
      signal,
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Firecrawl returned ${response.status}: ${response.statusText}${body ? ` — ${body.slice(0, 500)}` : ""}`);
    }

    const payload = (await response.json()) as {
      success?: boolean;
      error?: string;
      data?: {
        markdown?: string;
        html?: string;
        rawHtml?: string;
        metadata?: Record<string, unknown>;
      };
    };

    if (payload.success === false) {
      throw new Error(payload.error ?? "Firecrawl scrape failed");
    }

    const data = payload.data ?? {};
    const metadata = data.metadata ?? {};
    const title = typeof metadata.title === "string" && metadata.title.length > 0
      ? metadata.title
      : url;
    const text = options.format === "html"
      ? (data.html ?? data.rawHtml ?? data.markdown ?? "")
      : (data.markdown ?? data.html ?? data.rawHtml ?? "");

    return { title, text: text.slice(0, 100_000), metadata };
  });

  cacheSet(cacheKey, result);
  return result;
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    if (!process.env.SEARXNG_URL && getSearxngUrl().includes("localhost")) {
      ctx.ui.notify(
        "web-tools: SEARXNG_URL not set — defaults to http://localhost:8080",
        "info",
      );
    }
    if (!process.env.FIRECRAWL_URL) {
      ctx.ui.notify(
        "web-tools: FIRECRAWL_URL not set — defaults to http://localhost:3002",
        "info",
      );
    }
  });

  // ── web_search ────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "web_search",
    label: "Web Search",
    description: "Search the web using SearXNG and return titles, URLs, and snippets.",
    promptSnippet: "Search the web for current information, documentation, or news.",
    promptGuidelines: [
      "Use web_search when the user asks about current events, recent releases, or topics that may not be in training data.",
      "Pass a concise query (3-8 words) to web_search for best results.",
    ],
    parameters: Type.Object({
      query: Type.String({ description: "Search query (concise, 3-8 words recommended)" }),
      max_results: Type.Optional(
        Type.Integer({ default: 5, description: "Maximum number of results to return (default: 5, max: 20)" }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const query = params.query;
      const maxResults = Math.min(params.max_results ?? 5, 20);

      onUpdate?.({ content: [{ type: "text", text: `Searching for "${query}"...` }] });

      try {
        const results = await searchSearxng(query, maxResults, _signal);

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `No results found for "${query}".` }],
          };
        }

        const lines = results.map(
          (r, i) => `${i + 1}. ${r.title}\n   URL: ${r.url}\n   ${r.snippet}`,
        );

        return {
          content: [{
            type: "text",
            text: `Search results for "${query}" (${results.length} results):\n\n${lines.join("\n\n")}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Search failed: ${msg}\n\nMake sure SEARXNG_URL is set and the SearXNG instance is reachable.` }],
          isError: true,
        };
      }
    },
  });

  // ── fetch_url ─────────────────────────────────────────────────────────────
  pi.registerTool({
    name: "fetch_url",
    label: "Fetch URL",
    description: "Fetch a web page and return its cleaned text content. Good for reading articles, docs, or any HTML page.",
    promptSnippet: "Fetch and read the text content of a web page.",
    promptGuidelines: [
      "Use fetch_url to read the full content of a specific URL (article, documentation page, etc.).",
      "fetch_url returns plain text — it does not execute JavaScript. For JS-heavy SPAs, prefer web_search snippets or look for a /api endpoint.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to fetch (must include https://)" }),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const url = params.url;

      onUpdate?.({ content: [{ type: "text", text: `Fetching ${url}...` }] });

      try {
        const { title, text } = await fetchPage(url, _signal);

        return {
          content: [{
            type: "text",
            text: `--- Page: ${title} ---\nURL: ${url}\n\n${text}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Failed to fetch ${url}: ${msg}` }],
          isError: true,
        };
      }
    },
  });

  // ── web_extract ───────────────────────────────────────────────────────────
  pi.registerTool({
    name: "web_extract",
    label: "Web Extract",
    description: "Extract clean page content from a URL using a locally hosted Firecrawl instance.",
    promptSnippet: "Extract clean markdown or HTML from a web page using Firecrawl.",
    promptGuidelines: [
      "Use web_extract when fetch_url returns noisy content, misses JS-rendered page content, or the user asks to extract page content.",
      "web_extract uses FIRECRAWL_URL, defaulting to http://localhost:3002 for the local Firecrawl instance.",
    ],
    parameters: Type.Object({
      url: Type.String({ description: "URL to extract content from." }),
      format: Type.Optional(
        Type.Union([
          Type.Literal("markdown"),
          Type.Literal("html"),
        ], { default: "markdown", description: "Output format (default: markdown)." }),
      ),
      only_main_content: Type.Optional(
        Type.Boolean({ default: true, description: "Extract only the main page content when possible (default: true)." }),
      ),
      wait_for: Type.Optional(
        Type.Integer({ description: "Optional milliseconds for Firecrawl to wait before extracting." }),
      ),
      timeout: Type.Optional(
        Type.Integer({ description: "Optional Firecrawl timeout in milliseconds." }),
      ),
    }),
    async execute(_toolCallId, params, _signal, onUpdate, ctx) {
      const url = params.url;
      const format = params.format ?? "markdown";
      const onlyMainContent = params.only_main_content ?? true;

      onUpdate?.({ content: [{ type: "text", text: `Extracting ${url} with Firecrawl...` }] });

      try {
        const { title, text, metadata } = await extractWithFirecrawl(
          url,
          {
            format,
            onlyMainContent,
            waitFor: params.wait_for,
            timeout: params.timeout,
          },
          _signal,
        );

        if (!text.trim()) {
          return {
            content: [{ type: "text", text: `Firecrawl extracted no ${format} content from ${url}.` }],
            details: { metadata },
          };
        }

        return {
          content: [{
            type: "text",
            text: `--- Extracted: ${title} ---\nURL: ${url}\nExtractor: Firecrawl (${getFirecrawlUrl()})\nFormat: ${format}\n\n${text}`,
          }],
          details: { metadata },
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text", text: `Firecrawl extraction failed for ${url}: ${msg}\n\nMake sure FIRECRAWL_URL is set and the Firecrawl instance is reachable.` }],
          isError: true,
        };
      }
    },
  });
}
