/**
 * Simplescraper API Service
 *
 * Extracts content from a URL via the Simplescraper /extract endpoint
 * (synchronous — no job queue or polling).
 *
 * Docs: https://simplescraper.io/docs/api-guide
 */

import axios from "axios";

const BASE_URL = "https://api.simplescraper.io/v1";

export interface SimplescraperExtractOptions {
  /** Include markdown version of the page content */
  markdown?: boolean;
  /** Include raw HTML */
  html?: boolean;
}

export interface SimplescraperExtractResult {
  id: string;
  url: string;
  status: string;
  date_scraped: string;
  metadata: {
    title?: string | null;
    description?: string | null;
    word_count?: number;
  };
  markdown?: string;
  html?: string;
  data?: unknown[];
  screenshots?: Array<{ url: string; screenshot: string }>;
}

export interface SimplescraperError {
  error: { type: string; message: string };
}

/**
 * Extract content from a single URL using Simplescraper.
 * Returns metadata at minimum; optionally markdown and/or html based on options.
 */
export async function extractUrl(
  url: string,
  options: SimplescraperExtractOptions = {},
): Promise<
  | { ok: true; data: SimplescraperExtractResult }
  | { ok: false; error: string; status?: number }
> {
  const apiKey = process.env.SIMPLESCRAPER_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "SIMPLESCRAPER_API_KEY not configured",
    };
  }

  try {
    const { data, status } = await axios.post<SimplescraperExtractResult | SimplescraperError>(
      `${BASE_URL}/extract`,
      {
        url,
        markdown: options.markdown ?? false,
        html: options.html ?? false,
        screenshot: false,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60_000,
        validateStatus: () => true,
      },
    );

    if (status >= 400) {
      const err = data as SimplescraperError;
      return {
        ok: false,
        error: err?.error?.message ?? `HTTP ${status}`,
        status,
      };
    }

    return {
      ok: true,
      data: data as SimplescraperExtractResult,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      ok: false,
      error: message,
    };
  }
}
