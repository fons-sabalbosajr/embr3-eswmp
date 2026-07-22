// ─────────────────────────────────────────────────────────────────────────────
// SAMPLE test + sample operation for the Gemini provider (INACTIVE by default).
//
// This is a standalone demonstration ONLY. It does NOT touch the live Automation
// Agent, MongoDB, or the running server. The active agent still uses Anthropic.
// Run it manually to verify a free-tier Gemini key works before deciding whether
// to wire Gemini into the app for real.
//
// How to run:
//   1. Get a FREE key at https://aistudio.google.com/apikey (no billing needed).
//   2. Add to server/.env (or export inline):  GEMINI_API_KEY=your_key_here
//   3. From the server/ folder:  node scripts/testGemini.js
//
// It performs two things:
//   • Sample TEST      — a tiny "reply OK" round-trip that confirms auth + model.
//   • Sample OPERATION — a read-only summarization of mock ESWMP data, mirroring
//                        the real agent's contract (system instruction + prompt).
// ─────────────────────────────────────────────────────────────────────────────

require("dotenv").config();
const gemini = require("../utils/geminiProvider");

// Mock, read-only structured context — shaped like what the real agent would
// receive (e.g. SLF capacity snapshot). No database access; purely illustrative.
const SAMPLE_CONTEXT = {
  label: "SLF capacity snapshot (Region III) — sample",
  generatedAt: new Date().toISOString(),
  facilities: [
    { name: "Sample SLF Alpha", province: "Bulacan", designCapacityTons: 500000, usedTons: 430000, status: "operational" },
    { name: "Sample SLF Bravo", province: "Pampanga", designCapacityTons: 300000, usedTons: 295000, status: "operational" },
    { name: "Sample SLF Charlie", province: "Bataan", designCapacityTons: 250000, usedTons: 90000, status: "operational" },
  ],
};

// Same read-only posture the live agent uses.
const SYSTEM_INSTRUCTION =
  "You are a read-only operations assistant for an Ecological Solid Waste " +
  "Management Pipeline (ESWMP) system. Summarize and explain the structured data " +
  "provided. Never invent data not present in the context, and clearly flag any " +
  "facility that is at or near capacity.";

function buildPrompt(ctx) {
  return (
    `Task: ${ctx.label}\n` +
    `Question: Which facilities are near or over capacity, and what is the overall utilization?\n\n` +
    `Structured context (JSON):\n${JSON.stringify(ctx, null, 2)}`
  );
}

async function main() {
  console.log("=== Gemini provider — SAMPLE test (inactive; app still uses Anthropic) ===\n");
  console.log("Status:", gemini.safeStatus(), "\n");

  if (!gemini.isConfigured()) {
    console.log("SKIPPED: No usable Gemini configuration.");
    console.log("  • Get a FREE key: https://aistudio.google.com/apikey");
    console.log("  • Then set GEMINI_API_KEY in server/.env and re-run:");
    console.log("      node scripts/testGemini.js\n");
    process.exit(0);
  }

  // 1) Sample TEST — connection / auth check.
  console.log("[1/2] Sample connection test…");
  const test = await gemini.testConnection();
  if (!test.ok) {
    console.log(`  ✗ FAILED (${test.code}): ${test.message}\n`);
    process.exit(1);
  }
  console.log(`  ✓ OK — model=${test.model}, reply="${test.text}", ${test.durationMs}ms\n`);

  // 2) Sample OPERATION — read-only summarization of mock ESWMP data.
  console.log("[2/2] Sample operation (read-only summarization)…");
  const op = await gemini.generate({
    system: SYSTEM_INSTRUCTION,
    prompt: buildPrompt(SAMPLE_CONTEXT),
  });
  if (!op.ok) {
    console.log(`  ✗ FAILED (${op.code}): ${op.message}\n`);
    process.exit(1);
  }
  console.log(`  ✓ OK — model=${op.model}, ${op.durationMs}ms\n`);
  console.log("--- Model summary ---");
  console.log(op.text);
  console.log("---------------------\n");
  console.log("Done. This was a sample only — nothing in the live app was changed.");
}

main().catch((err) => {
  console.error("Unexpected error:", err?.message || err);
  process.exit(1);
});
