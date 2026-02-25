#!/usr/bin/env node

/**
 * boost-reputation.ts
 *
 * Simple reputation flow:
 * 1. Call POST /scrape with a URL and x-wallet-address (from private key).
 * 2. Server returns { result..., feedbackAuth: { agentId, taskId, signature } }.
 * 3. Submit feedback to the ERC-8004 Reputation Registry via giveFeedback().
 *    (feedbackAuth is attached off-chain in feedbackURI/feedbackHash.)
 *
 * ERC-8004 has two registries: Identity (register, agent IDs) and Reputation
 * (giveFeedback). giveFeedback lives on the Reputation Registry only.
 *
 * Usage:
 *   REPUTATION_SIGNER_PRIVATE_KEY=0x... \
 *   REPUTATION_REGISTRY_ADDRESS=0x... \   # Reputation Registry (not Identity)
 *   AGENT_ID=1 \                          # Identity Registry token ID for your agent
 *   npx tsx scripts/boost-reputation.ts <url-to-scrape>
 *
 * Optional env:
 *   BASE_URL          – scraper API base (default: http://localhost:8080)
 *   BASE_RPC_URL      – chain RPC (default: https://mainnet.base.org)
 */

import "dotenv/config";
import { ethers } from "ethers";
import axios from "axios";

const URL_TO_SCRAPE = process.argv[2];
if (!URL_TO_SCRAPE) {
  console.error("Usage: npx tsx scripts/boost-reputation.ts <url-to-scrape>");
  process.exit(1);
}

const SIGNER_KEY = process.env.REPUTATION_SIGNER_PRIVATE_KEY;
// Reputation Registry (giveFeedback) – different from Identity Registry (register)
// Base Mainnet: 0x8004BAa17C55a88189AE136b182e5fdA19dE9b63
// Base Sepolia: 0x8004B663056A597Dffe9eCcC1965A193B7388713
const REGISTRY_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS;
const AGENT_ID = process.env.AGENT_ID; // Identity Registry token ID (uint256)
const SCRAPER_BASE = process.env.BASE_URL || "http://localhost:8080";
const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

if (!SIGNER_KEY || !REGISTRY_ADDRESS) {
  console.error(
    "Set REPUTATION_SIGNER_PRIVATE_KEY and REPUTATION_REGISTRY_ADDRESS",
  );
  process.exit(1);
}
if (!AGENT_ID || Number.isNaN(Number(AGENT_ID))) {
  console.error("Set AGENT_ID to your agent's Identity Registry token ID (uint256).");
  process.exit(1);
}
const signerKey = SIGNER_KEY;
const registryAddress = REGISTRY_ADDRESS;
const agentIdToken = BigInt(AGENT_ID);

// Reputation Registry ABI (giveFeedback: value/valueDecimals + tags + optional URI/hash)
const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external",
];

async function main(): Promise<void> {
  const wallet = new ethers.Wallet(signerKey);
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = wallet.connect(provider);

  console.log("Calling POST /scrape with x-wallet-address...");
  const { data } = await axios.post(
    `${SCRAPER_BASE.replace(/\/$/, "")}/scrape`,
    { url: URL_TO_SCRAPE },
    {
      headers: { "x-wallet-address": wallet.address },
      validateStatus: () => true,
    },
  );

  const feedbackAuth = data?.feedbackAuth;
  if (!feedbackAuth?.agentId || !feedbackAuth?.taskId || !feedbackAuth?.signature) {
    console.error("Response missing feedbackAuth (agentId, taskId, signature).", data?.error ? data.error : "Is AGENT_PRIVATE_KEY set on the server?");
    process.exit(1);
  }

  // Attestation is stored off-chain; contract uses value + tags + optional feedbackURI/feedbackHash
  const feedbackPayload = JSON.stringify(feedbackAuth);
  const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes(feedbackPayload));
  const value = 100; // 100 = 5-star equivalent on 0–100 scale
  const valueDecimals = 0;

  const registry = new ethers.Contract(
    registryAddress,
    REPUTATION_ABI,
    signer,
  );

  console.log("Submitting ERC-8004 feedback to Reputation Registry...");
  const tx = await registry.giveFeedback(
    agentIdToken,
    value,
    valueDecimals,
    "web-scraper",
    "scrape",
    SCRAPER_BASE,
    `data:application/json,${encodeURIComponent(feedbackPayload)}`,
    feedbackHash,
  );
  await tx.wait();
  console.log("✓ Reputation updated. Tx:", tx.hash);
}

main().catch((err: Error) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});
