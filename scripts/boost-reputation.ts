#!/usr/bin/env node

/**
 * boost-reputation.ts
 *
 * Reputation script for the Web Scraper (402-gas) agent.
 *
 * ── What it does ────────────────────────────────────────────────────────
 *
 *   1. Takes a transaction hash from a completed x402 payment to this agent.
 *   2. Fetches the tx receipt from Base to prove the payment happened.
 *   3. Builds a "Proof of Payment" JSON object.
 *   4. Uploads it to IPFS via Pinata and returns a CID.
 *   5. Calls the `postFeedback` function on an ERC-8004 Reputation
 *      Registry contract, submitting a 5-star verified review that
 *      references the IPFS proof.
 *
 * ── Usage ───────────────────────────────────────────────────────────────
 *
 *   BASE_RPC_URL=https://mainnet.base.org \
 *   REPUTATION_SIGNER_PRIVATE_KEY=0x... \
 *   REPUTATION_REGISTRY_ADDRESS=0x... \
 *   npx tsx scripts/boost-reputation.ts <txHash>
 *
 * ── ERC-8004 Reputation Registry ABI (minimal) ─────────────────────────
 *
 *   function postFeedback(
 *     address agent,
 *     uint8   rating,        // 1-5 stars
 *     string  proofCID,      // IPFS CID pointing to proof JSON
 *     bytes   paymentProof   // abi-encoded tx hash
 *   ) external;
 */

import "dotenv/config";
import { ethers } from "ethers";
import crypto from "node:crypto";
import axios from "axios";

// ── Config ────────────────────────────────────────────────────────────

const TX_HASH = process.argv[2];
if (!TX_HASH) {
  console.error("Usage: npx tsx scripts/boost-reputation.ts <txHash>");
  process.exit(1);
}

const RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const SIGNER_KEY = process.env.REPUTATION_SIGNER_PRIVATE_KEY;
const REGISTRY_ADDRESS = process.env.REPUTATION_REGISTRY_ADDRESS;

if (!SIGNER_KEY || !REGISTRY_ADDRESS) {
  console.error(
    "Missing REPUTATION_SIGNER_PRIVATE_KEY or REPUTATION_REGISTRY_ADDRESS",
  );
  process.exit(1);
}

const AGENT_ADDRESS =
  process.env.PAYMENT_RECEIVER_ADDRESS || "0xYourWalletAddressHere";

// Minimal ABI for the postFeedback function
const REGISTRY_ABI = [
  "function postFeedback(address agent, uint8 rating, string proofCID, bytes paymentProof) external",
];

// ── Main ──────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = new ethers.Wallet(SIGNER_KEY!, provider);

  console.log(`\n  Fetching tx receipt for ${TX_HASH} ...`);
  const receipt = await provider.getTransactionReceipt(TX_HASH);

  if (!receipt) {
    console.error("  Transaction not found or not yet confirmed.");
    process.exit(1);
  }

  if (receipt.status !== 1) {
    console.error("  Transaction reverted — cannot use a failed tx as proof.");
    process.exit(1);
  }

  console.log(
    `  ✓ Confirmed in block ${receipt.blockNumber}  (gas used: ${receipt.gasUsed})`,
  );

  // ── Build Proof of Payment ────────────────────────────────────────

  const proof = {
    version: "1.0",
    type: "x402-payment-proof",
    agent: AGENT_ADDRESS,
    txHash: TX_HASH,
    chain: "eip155:8453",
    blockNumber: receipt.blockNumber,
    from: receipt.from,
    to: receipt.to,
    gasUsed: receipt.gasUsed.toString(),
    timestamp: new Date().toISOString(),
  };

  console.log("\n  Proof of Payment:");
  console.log(JSON.stringify(proof, null, 4));

  // ── Upload proof to IPFS via Pinata ─────────────────────────────────

  let proofCID: string;
  const pinataJwt = process.env.PINATA_JWT;

  if (pinataJwt) {
    console.log("\n  Uploading proof to IPFS (Pinata) ...");
    const { data } = await axios.post(
      "https://api.pinata.cloud/pinning/pinJSONToIPFS",
      {
        pinataContent: proof,
        pinataMetadata: { name: `x402-proof-${TX_HASH.slice(0, 10)}` },
      },
      { headers: { Authorization: `Bearer ${pinataJwt}` } },
    );
    proofCID = data.IpfsHash;
    console.log(`  ✓ Pinned to IPFS: ${proofCID}`);
  } else {
    console.log(
      "\n  ⚠ PINATA_JWT not set — using deterministic mock CID (set PINATA_JWT for real uploads)",
    );
    const proofBytes = Buffer.from(JSON.stringify(proof));
    proofCID =
      "bafkrei" +
      crypto.createHash("sha256").update(proofBytes).digest("hex").slice(0, 52);
    console.log(`  Mock IPFS CID: ${proofCID}`);
  }

  // ── Submit on-chain review ────────────────────────────────────────

  const registry = new ethers.Contract(
    REGISTRY_ADDRESS!,
    REGISTRY_ABI,
    signer,
  );

  const paymentProofBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes32"],
    [TX_HASH],
  );

  console.log("\n  Submitting 5-star review to Reputation Registry ...");

  const tx = await registry.postFeedback(
    AGENT_ADDRESS,
    5,
    proofCID,
    paymentProofBytes,
  );

  console.log(`  Tx sent: ${tx.hash}`);
  console.log("  Waiting for confirmation ...");

  const reviewReceipt = await tx.wait();
  if (!reviewReceipt) {
    throw new Error("Review transaction receipt is null.");
  }
  console.log(
    `  ✓ Review confirmed in block ${reviewReceipt.blockNumber}\n`,
  );
}

main().catch((err: Error) => {
  console.error("\n  Fatal error:", err.message);
  process.exit(1);
});
