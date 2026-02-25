#!/usr/bin/env node

import "dotenv/config";
import { ethers } from "ethers";
import axios from "axios";

// --- Config ---
const URL_TO_SCRAPE = process.argv[2];
if (!URL_TO_SCRAPE) {
  console.error("Usage: npx tsx scripts/boost-reputation.ts <url-to-scrape>");
  process.exit(1);
}

const SIGNER_KEY = process.env.REPUTATION_SIGNER_PRIVATE_KEY;
/** * CHAOSCHAIN v1.1 REGISTRIES (Base Sepolia)
 * Identity: 0x8004AA63c570c570eBF15376c0dB199918BFe9Fb
 * Reputation: 0x8004bd8daB57f14Ed299135749a5CB5c42d341BF
 */
const REGISTRY_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS || "0x8004bd8daB57f14Ed299135749a5CB5c42d341BF";
const AGENT_ID = process.env.AGENT_ID; 
const SCRAPER_BASE = process.env.BASE_URL || "http://localhost:8080";
const RPC_URL = process.env.BASE_RPC_URL || "https://sepolia.base.org";

if (!SIGNER_KEY || !AGENT_ID) {
  console.error("Set REPUTATION_SIGNER_PRIVATE_KEY and AGENT_ID");
  process.exit(1);
}

// Match on-chain giveFeedback UI: value/valueDecimals, string tag1/tag2, endpoint, feedbackURI, feedbackHash
const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash) external"
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(SIGNER_KEY!, provider);
  const agentIdToken = BigInt(AGENT_ID!);

  console.log(`\n🚀 Calling Scraper at ${SCRAPER_BASE}...`);
  
  const { data } = await axios.post(
    `${SCRAPER_BASE.replace(/\/$/, "")}/scrape`,
    { url: URL_TO_SCRAPE },
    {
      headers: { "x-wallet-address": signer.address },
      validateStatus: () => true,
    }
  );

  const feedbackAuth = data?.feedbackAuth;

  const feedbackPayload = JSON.stringify({
    ...(feedbackAuth || {}),
    client: signer.address,
    timestamp: Date.now(),
  });
  const feedbackUri = `data:application/json,${encodeURIComponent(feedbackPayload)}`;

  const tag1 = "web-scraper";
  const tag2 = "reliable";
  const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes(feedbackPayload));

  const registry = new ethers.Contract(REGISTRY_ADDRESS, REPUTATION_ABI, signer);

  const value = 100;       // score 100
  const valueDecimals = 0; // integer score
  const endpoint = URL_TO_SCRAPE;

  console.log(`⭐️ Submitting 100/100 score for Agent #${AGENT_ID}...`);

  const tx = await registry.giveFeedback(
    agentIdToken,
    value,
    valueDecimals,
    tag1,
    tag2,
    endpoint,
    feedbackUri,
    feedbackHash
  );

  console.log(`⏳ Transaction sent: ${tx.hash}`);
  await tx.wait();
  console.log("✅ Reputation successfully boosted on-chain!");
}

main().catch((err) => {
  console.error("Fatal error:", err.message);
  process.exit(1);
});