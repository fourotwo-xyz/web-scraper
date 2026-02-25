/**
 * Web-Scraper API — Express Server
 *
 * Single paid endpoint: POST /scrape — extract content from a URL (Simplescraper).
 * x402 payments; first 2 requests per wallet are free.
 */

import "dotenv/config";
import express from "express";
import { Wallet, id, getBytes, AbiCoder, keccak256, hexlify } from "ethers";
import { paymentMiddleware } from "@x402/express";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { createPaywall } from "@x402/paywall";
import { evmPaywall } from "@x402/paywall/evm";

import { freemiumGate } from "./middleware/freemium.js";
import { extractUrl } from "./services/simplescraper.js";

const PORT = process.env.PORT || 8080;
const RECEIVER = process.env.PAYMENT_RECEIVER_ADDRESS || "0xYourWalletAddressHere";

// Agent wallet for ERC-8004 feedback auth (optional; when set, responses include feedbackAuth)
const agentWallet = process.env.AGENT_PRIVATE_KEY
  ? new Wallet(process.env.AGENT_PRIVATE_KEY)
  : null;
// CHAOSCHAIN Base Sepolia: Identity 0x8004AA63c570c570eBF15376c0dB199918BFe9Fb
const IDENTITY_REGISTRY =
  process.env.IDENTITY_REGISTRY_ADDRESS || "0x8004AA63c570c570eBF15376c0dB199918BFe9Fb";
const CHAIN_ID = parseInt(process.env.CHAIN_ID || "84532", 10); // Base Sepolia
const NUMERIC_AGENT_ID = process.env.AGENT_ID ? BigInt(process.env.AGENT_ID) : null;

const FACILITATOR_URL =
  process.env.X402_FACILITATOR_URL || "https://x402.org/facilitator";
const X402_NETWORK = (process.env.X402_NETWORK || "eip155:84532") as `${string}:${string}`;

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);
registerExactEvmScheme(resourceServer);

const app = express();
app.use(express.json());

// ── Payment config for POST /scrape ───────────────────────────────────

const scrapePaymentConfig = {
  "POST /scrape": {
    accepts: [
      {
        scheme: "exact",
        price: "$0.03",
        network: X402_NETWORK,
        payTo: RECEIVER,
      },
    ],
    description: "Scrape a URL and return metadata, optionally markdown or HTML",
    mimeType: "application/json",
  },
};

const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: "Web Scraper",
    testnet: X402_NETWORK.includes("84532"),
  })
  .build();

const x402Middleware = paymentMiddleware(scrapePaymentConfig, resourceServer, undefined, paywall);

// ── POST /scrape (402 + freemium: first 2 free) ─────────────────────────

app.post("/scrape", freemiumGate(x402Middleware), async (req, res) => {
  const body = req.body as {
    url?: string;
    markdown?: boolean;
    html?: boolean;
    clientAddress?: string;
  };
  const url = typeof body?.url === "string" ? body.url.trim() : undefined;

  if (!url) {
    res.status(400).json({
      error: "Missing required field: url",
      optional: ["markdown", "html", "clientAddress"],
    });
    return;
  }

  try {
    const result = await extractUrl(url, {
      markdown: body.markdown,
      html: body.html,
    });

    if (!result.ok) {
      res.status(result.status ?? 503).json({
        error: result.error,
      });
      return;
    }

    const payload: Record<string, unknown> = { ...result.data };

    // ERC-8004 feedback auth: allow clients to submit feedback on-chain (ReputationRegistry)
    const clientAddress =
      (typeof body?.clientAddress === "string" ? body.clientAddress.trim() : null) ||
      (typeof req.headers["x-wallet-address"] === "string"
        ? (req.headers["x-wallet-address"] as string).trim()
        : null);
    if (agentWallet && clientAddress) {
      const taskId = id(url + Date.now());

      // Single signature: contract-format auth (289 bytes) for CHAOSCHAIN ReputationRegistry
      if (NUMERIC_AGENT_ID !== null) {
        const indexLimit = 1000n;
        const expiry = BigInt(Math.floor(Date.now() / 1000) + 3600);
        const abiCoder = AbiCoder.defaultAbiCoder();
        const encodedStruct = abiCoder.encode(
          ["uint256", "address", "uint64", "uint256", "uint256", "address", "address"],
          [
            NUMERIC_AGENT_ID,
            clientAddress,
            indexLimit,
            expiry,
            BigInt(CHAIN_ID),
            IDENTITY_REGISTRY,
            agentWallet.address,
          ]
        );
        const structHash = keccak256(encodedStruct);
        const contractSig = await agentWallet.signMessage(getBytes(structHash));
        const authBytes = new Uint8Array(224 + 65);
        authBytes.set(getBytes(encodedStruct), 0);
        authBytes.set(getBytes(contractSig), 224);
        payload.feedbackAuthContract = hexlify(authBytes);
      }

      // Lightweight metadata for feedbackUri payload (no second signature)
      payload.feedbackAuth = {
        agentId: agentWallet.address,
        taskId,
      };
    }

    res.json(payload);
  } catch (err) {
    console.error("[scrape] unexpected error:", err);
    res.status(500).json({ error: "Internal server error during scrape." });
  }
});

// ── Root: usage info ───────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({
    name: "Web-Scraper API",
    description: "Scrape a URL and get metadata, optional markdown or HTML. Paid via x402; first 2 requests per wallet are free.",
    usage: {
      endpoint: "POST /scrape",
      body: {
        url: { required: true, type: "string", description: "URL to scrape" },
        markdown: { required: false, type: "boolean", description: "Include markdown of page content" },
        html: { required: false, type: "boolean", description: "Include raw HTML" },
        clientAddress: { required: false, type: "string", description: "Client wallet for ERC-8004 feedback auth (else x-wallet-address header)" },
      },
      example: "POST /scrape with body: { \"url\": \"https://example.com\" }",
      payment: "x402 ($0.03 USDC per call after free tier)",
    },
    links: {
      health: "GET /health",
      agentCard: "GET /.well-known/agent.json",
    },
  });
});

// ── Health (free) ───────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    agent: "web-scraper",
    version: "1.0.0",
  });
});

// ── Agent card (OASF) ───────────────────────────────────────────────────

app.get("/.well-known/agent.json", (_req, res) => {
  res.json({
    schema: "oasf/1.0",
    name: "Web-Scraper",
    description:
      "Scrape a given URL and get metadata, optional markdown or HTML. Paid API for agents with x402; first 2 requests per wallet are free.",
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },
    endpoints: [
      {
        method: "POST",
        path: "/scrape",
        description: "Scrape a URL and return metadata, optionally markdown or HTML (Simplescraper)",
        params: {
          url: { type: "string", required: true, description: "URL to scrape" },
          markdown: { type: "boolean", required: false, description: "Include markdown of page content" },
          html: { type: "boolean", required: false, description: "Include raw HTML" },
          clientAddress: { type: "string", required: false, description: "Client wallet for ERC-8004 feedback auth (else x-wallet-address header)" },
        },
        payment: {
          protocol: "x402",
          price: "$0.03",
          currency: "USDC",
          network: `Base (${X402_NETWORK})`,
          payTo: RECEIVER,
          freeTier: "First 2 calls per wallet are free",
        },
      },
    ],
    contact: { type: "url", value: "https://www.fourotwo.xyz" },
  });
});

// ── Start ───────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  Web-Scraper listening on http://localhost:${PORT}`);
  console.log(`  POST /scrape — 402: $0.03 USDC → ${RECEIVER}`);
  console.log(`  Network: ${X402_NETWORK}  Facilitator: ${FACILITATOR_URL}`);
  console.log(`  Free tier: 2 calls per wallet\n`);
});
