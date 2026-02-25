#!/usr/bin/env node

/**
 * generate-agent-card.ts
 *
 * Outputs a valid OASF (Open Agentic Schema Framework) JSON file
 * that describes the Web Scraper agent's capabilities, endpoints,
 * and x402 payment requirements.
 *
 * Usage:
 *   npx tsx scripts/generate-agent-card.ts                     → prints JSON to stdout
 *   npx tsx scripts/generate-agent-card.ts --upload            → uploads to IPFS via Pinata (writes agent-card.json + agent-card-cid.txt)
 *   npx tsx scripts/generate-agent-card.ts --register [cid]    → registers on-chain (mints NFT). Uses CID from file agent-card-cid.txt if no cid given.
 *
 * Other agents can discover this card at:
 *   GET /.well-known/agent.json  (served live by the Express app)
 *
 * Required env vars for --upload:
 *   PINATA_JWT
 *
 * Additional env vars for --register:
 *   IDENTITY_SIGNER_PRIVATE_KEY     (wallet that signs the tx and owns the Agent ID NFT)
 *   BASE_RPC_URL                    (defaults to https://mainnet.base.org)
 *   IDENTITY_REGISTRY_ADDRESS       (defaults to the official ERC-8004 registry on Base)
 */

import "dotenv/config";
import { ethers } from "ethers";
import axios from "axios";
import fs from "node:fs";

// ── Config ────────────────────────────────────────────────────────────────────

function requireEnv(name: string, rejectIfEqual?: string): string {
  const value = process.env[name]?.trim() ?? "";
  if (!value) {
    console.error(`Missing required env: ${name}. Set it in .env (see .env.example).`);
    process.exit(1);
  }
  if (rejectIfEqual && value === rejectIfEqual) {
    console.error(`Invalid ${name}: must be set to a real value, not the placeholder.`);
    process.exit(1);
  }
  return value;
}

// Reject value from .env.example so we don’t run with an unconfigured receiver
function getReceiver(): string {
  return requireEnv("PAYMENT_RECEIVER_ADDRESS", "0xYourWalletAddressHere");
}
function getBaseUrl(): string {
  return requireEnv("BASE_URL");
}

// ERC-8004 Identity Registry — official deployment on Base Mainnet (chain 8453)
const IDENTITY_REGISTRY_ADDRESS =
  process.env.IDENTITY_REGISTRY_ADDRESS?.trim() ||
  "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";

const IDENTITY_REGISTRY_ABI = [
  "function register(string agentURI) external returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];

// ── Agent Card ────────────────────────────────────────────────────────────────

const agentCard = {
  schema: "oasf/1.0",
  humanReadableId: "web-scraper",
  agentId: "web-scraper",
  name: "Web Scraper",
  version: "1.0.0",
  lastUpdated: new Date().toISOString(),

  description:
    "Scrape any URL and get clean metadata, optional markdown or raw HTML. " +
    "JavaScript is evaluated to get final results. " +
    "Simple paid API for agents: first 2 requests per wallet free, then $0.03 USDC per call via x402. " +
    "No API keys, no subscriptions.",

  image: "https://i.ibb.co/kgBZz0Tb/Screenshot-2026-02-25-at-16-59-05.png", 

  tags: [
    "web-scraping",
    "content-extraction",
    "markdown",
    "html",
    "base",
    "x402",
    "agent-api",
  ],

  capabilities: ["web-scraping", "data-analysis", "automated-reporting"],

  protocols: ["x402", "oasf/1.0", "mcp"],
  authSchemes: ["x402"],
  defaultInputModes: ["application/json"],
  defaultOutputModes: ["application/json"],

  skills: [
    {
      id: "url-scrape",
      name: "URL Scrape",
      description:
        "Extract content from a given URL. JavaScript is evaluated to get final results. Returns metadata (title, description, word count); optionally markdown or raw HTML.",
      tags: ["web-scraping", "markdown", "html"],
      examples: [
        "Scrape https://example.com",
        "Get markdown for this URL",
        "Extract content from a webpage",
      ],
    },
  ],

  provider: {
    name: "Web Scraper",
    get url() {
      return getBaseUrl();
    },
  },

  pricing: {
    model: "usage-based",
    protocol: "x402",
    currency: "USDC",
    network: "eip155:8453",
    pricePerCall: 0.03,
    freeTier: {
      enabled: true,
      calls: 2,
      scope: "per wallet address",
    },
    noSubscription: true,
    noAPIKey: true,
  },

  endpoints: [
    {
      method: "POST",
      path: "/scrape",
      url: `${getBaseUrl()}/scrape`,
      description:
        "Scrape a URL and return metadata, optionally markdown or HTML",
      parameters: {
        url: {
          type: "string",
          required: true,
          description: "URL to scrape",
        },
        markdown: {
          type: "boolean",
          required: false,
          description: "Include markdown of page content (default: true)",
        },
        html: {
          type: "boolean",
          required: false,
          description: "Include raw HTML",
        },
        clientAddress: {
          type: "string",
          required: false,
          description: "Client wallet for ERC-8004 feedback auth (else x-wallet-address header used)",
        },
      },
      response: {
        mimeType: "application/json",
        schema: {
          url: "string",
          status: "string",
          date_scraped: "string",
          metadata: "object (title?, description?, word_count?)",
          markdown: "string (optional)",
          html: "string (optional)",
          data: "array (optional)",
          feedbackAuth: "object — { agentId, taskId, signature } for ERC-8004 feedback (included when client address is provided)",
        },
      },
      payment: {
        protocol: "x402",
        scheme: "exact",
        price: "$0.03",
        currency: "USDC",
        network: "eip155:8453",
        networkName: "Base Mainnet",
        payTo: getReceiver(),
        facilitator: "https://facilitator.openx402.ai",
        freeTier: {
          enabled: true,
          limit: 2,
          scope: "per wallet (identified by x-wallet-address header)",
        },
      },
    },
    {
      method: "GET",
      path: "/health",
      url: `${getBaseUrl()}/health`,
      description: "Health check — always free, no payment required",
      payment: null,
    },
    {
      method: "GET",
      path: "/.well-known/agent.json",
      url: `${getBaseUrl()}/.well-known/agent.json`,
      description: "This OASF agent card (machine-readable metadata)",
      payment: null,
    },
  ],

  services: [
    {
      name: "web",
      endpoint: getBaseUrl(),
      description: "REST API — POST /scrape with x402 payment",
    },
    {
      name: "MCP",
      endpoint: `${getBaseUrl()}/mcp`,
      version: "2025-03-26",
      description: "Model Context Protocol server for LLM integration (Streamable HTTP)",
      capabilities: ["tools"],
      tools: ["scrape", "get_metadata", "get_markdown", "get_html", "evaluate_javascript"],
    },
  ],

  dataSources: [],

  benchmarks: {
    avgLatencyMs: 5000,
    chainsSupported: ["eip155:8453"],
  },

  agentFacts: {
    identityStandard: "ERC-8004",
    identityRegistry: `eip155:8453:${IDENTITY_REGISTRY_ADDRESS}`,
    chain: "eip155:8453",
    paymentProtocol: "x402",
  },

  // EIP-8004 / discovery-friendly fields (aligned with popular agent cards)
  x402Support: true,
  active: true,
  supportedTrust: ["reputation", "crypto-economic", "tee-attestation"] as const,
  updatedAt: Math.floor(Date.now() / 1000),
  // ...(process.env.AGENT_ID && {
  //   registrations: [
  //     {
  //       agentId: parseInt(process.env.AGENT_ID, 10),
  //       agentRegistry: `eip155:8453:${IDENTITY_REGISTRY_ADDRESS}`,
  //     },
  //   ],
  // }),
  attributes: {
    blockchain: { chain: "base", chainId: 8453 },
    protocols: ["x402", "mcp"],
    tags: [
      "web-scraping",
      "content-extraction",
      "markdown",
      "html",
      "base",
      "x402",
      "mcp",
      "agent-api",
    ],
  },

  deployment: {
    runtime: "Node.js >= 20",
    port: 8080,
  },

  contact: {
    type: "url",
    get value() {
      return getBaseUrl();
    },
  },
};

// ── IPFS Upload ───────────────────────────────────────────────────────────────

async function uploadToIPFS(card: typeof agentCard): Promise<string> {
  const pinataJwt = process.env.PINATA_JWT;
  if (!pinataJwt) {
    throw new Error(
      "PINATA_JWT is not set. Add it to your .env file to upload to IPFS.",
    );
  }

  console.error("  Uploading agent card to IPFS via Pinata ...");

  const { data } = await axios.post(
    "https://api.pinata.cloud/pinning/pinJSONToIPFS",
    {
      pinataContent: card,
      pinataMetadata: { name: `web-scraper-card-v${card.version}` },
      pinataOptions: { cidVersion: 1 },
    },
    { headers: { Authorization: `Bearer ${pinataJwt}` } },
  );

  const cid: string = data.IpfsHash;
  console.error(`  ✓ Pinned to IPFS: ${cid}`);
  console.error(`  ✓ Gateway URL:    https://ipfs.io/ipfs/${cid}`);
  return cid;
}

// ── On-Chain Registration ─────────────────────────────────────────────────────

async function registerOnChain(
  cid: string,
): Promise<{ txHash: string; agentId: string | undefined; blockNumber: number }> {
  const privateKey = process.env.IDENTITY_SIGNER_PRIVATE_KEY;
  const rpcUrl = process.env.BASE_RPC_URL || "https://mainnet.base.org";

  if (!privateKey) {
    throw new Error(
      "IDENTITY_SIGNER_PRIVATE_KEY is not set. Add it to your .env file to register on-chain.",
    );
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(privateKey, provider);
  const registry = new ethers.Contract(
    IDENTITY_REGISTRY_ADDRESS,
    IDENTITY_REGISTRY_ABI,
    signer,
  );

  const agentURI = `ipfs://${cid}`;

  console.error(`\n  Registering agent on ERC-8004 Identity Registry ...`);
  console.error(`  Registry:  ${IDENTITY_REGISTRY_ADDRESS}`);
  console.error(`  Agent URI: ${agentURI}`);
  console.error(`  Signer:    ${signer.address}`);

  const tx = await registry["register(string)"](agentURI);
  console.error(`  Tx sent:   ${tx.hash}`);
  console.error("  Waiting for confirmation ...");

  const receipt = await tx.wait();
  if (!receipt) {
    throw new Error("Transaction receipt is null — tx may have been dropped.");
  }
  console.error(`  ✓ Confirmed in block ${receipt.blockNumber}`);

  const iface = new ethers.Interface(IDENTITY_REGISTRY_ABI);
  let agentId: string | undefined;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({
        topics: log.topics as string[],
        data: log.data,
      });
      if (parsed?.name === "Registered") {
        agentId = parsed.args.agentId.toString();
        break;
      }
    } catch {
      // skip logs from other contracts
    }
  }

  if (agentId) {
    console.error(`  ✓ Agent ID (NFT #${agentId}) minted`);
    console.error(
      `  ✓ Explorer:  https://8004agents.ai/base/agent/${agentId}`,
    );
  }

  return { txHash: tx.hash, agentId, blockNumber: receipt.blockNumber };
}

const CID_FILE = "agent-card-cid.txt";

function getCidForRegister(): string {
  const args = process.argv.slice(2);
  const registerIdx = args.indexOf("--register");
  // --register QmXXX or --register cid=QmXXX
  const nextArg = args[registerIdx + 1];
  if (nextArg && !nextArg.startsWith("--")) {
    return nextArg.startsWith("cid=") ? nextArg.slice(4) : nextArg;
  }
  if (fs.existsSync(CID_FILE)) {
    return fs.readFileSync(CID_FILE, "utf8").trim();
  }
  console.error(
    `No CID provided. Either run upload first (writes ${CID_FILE}) or pass CID: --register <cid>`,
  );
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const shouldUpload = args.includes("--upload");
const shouldRegister = args.includes("--register");

if (shouldUpload && shouldRegister) {
  console.error("Use either --upload or --register, not both. Run upload first, then register.");
  process.exit(1);
}

if (!shouldUpload && !shouldRegister) {
  console.log(JSON.stringify(agentCard, null, 2));
} else if (shouldUpload) {
  try {
    fs.writeFileSync("agent-card.json", JSON.stringify(agentCard, null, 2));
    console.error("  ✓ agent-card.json written locally");

    const cid = await uploadToIPFS(agentCard);
    fs.writeFileSync(CID_FILE, cid);
    console.error(`  ✓ ${CID_FILE} written (use for: npm run register-agent)`);

    console.log(
      JSON.stringify(
        { ipfsCid: cid, ipfsGateway: `https://ipfs.io/ipfs/${cid}` },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(`\n  Fatal: ${(err as Error).message}`);
    process.exit(1);
  }
} else {
  try {
    const cid = getCidForRegister();
    const { txHash, agentId, blockNumber } = await registerOnChain(cid);
    console.log(
      JSON.stringify(
        {
          ipfsCid: cid,
          ipfsGateway: `https://ipfs.io/ipfs/${cid}`,
          txHash,
          agentId,
          blockNumber,
          explorerUrl: agentId
            ? `https://8004agents.ai/base/agent/${agentId}`
            : null,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    console.error(`\n  Fatal: ${(err as Error).message}`);
    process.exit(1);
  }
}
