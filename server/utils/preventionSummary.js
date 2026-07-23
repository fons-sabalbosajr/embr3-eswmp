// Prevention-Measures document summarizer.
//
// Turns EXTRACTED document text (from utils/docExtract.js) into a concise,
// faithful summary using the existing Automation Agent provider layer. It is
// grounded strictly in the supplied text: the system instruction forbids
// inventing content and asks the model to preserve the operationally important
// details (preventive actions, responsible parties, schedule/frequency, required
// equipment, monitoring procedures, risks, corrective actions). The result is
// clearly a DOCUMENT summary — separate from the SLF's official narrative — and
// always carries a reference to the source document.

const agent = require("./automationAgent");

const MAX_DOC_CHARS = 24000; // bound the tokens sent to the model

const SYSTEM_INSTRUCTION = [
  "You summarize an environmental facility's Prevention-Measures document for EMB Region III staff.",
  "Summarize ONLY the document text provided. Do NOT invent, infer, or add anything not present in the text.",
  "If a detail is not in the document, omit it — never guess dates, parties, equipment, or figures.",
  "Preserve these when present: preventive actions; responsible parties; schedule or frequency; required equipment; monitoring procedures; identified risks; corrective actions.",
  "Be concise and factual: a short overview sentence, then compact bullet points grouped by the categories above (only those actually present).",
  "Do not include any preamble like 'Here is the summary'. Plain text only.",
].join("\n");

// Summarize extracted text. Returns { ok, summary, model, provider } or
// { ok:false, code, message }. `agentConfig` is the AppSettings.automationAgent.
async function summarizeDocument({ text, docName = "", slfName = "", agentConfig, signal } = {}) {
  const body = String(text || "").trim();
  if (!body) return { ok: false, code: "empty", message: "No document text to summarize." };
  if (!agentConfig || !agent.isOperational(agentConfig)) {
    return { ok: false, code: "unavailable", message: "The AI summary service is not configured." };
  }

  const prompt =
    `Source document: ${docName || "(unnamed)"}${slfName ? ` — SLF: ${slfName}` : ""}\n\n` +
    `Document text:\n"""\n${body.slice(0, MAX_DOC_CHARS)}\n"""\n\n` +
    "Write the faithful summary now.";

  const resp = await agent.complete(agentConfig, { system: SYSTEM_INSTRUCTION, prompt, signal });
  const summary = String(resp.text || "").trim();
  if (!summary) return { ok: false, code: "no_output", message: "The summarizer returned no text." };
  return { ok: true, summary, model: resp.model, provider: resp.provider };
}

module.exports = { summarizeDocument, MAX_DOC_CHARS };
