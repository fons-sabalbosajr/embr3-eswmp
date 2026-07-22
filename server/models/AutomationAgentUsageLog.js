const mongoose = require("mongoose");

// One row per Automation Agent request (test-connection or query). Drives the
// per-user + global daily rate limits and cost visibility. Full prompt/response
// text is stored ONLY when the agent's loggingLevel is "full" (access-controlled,
// developer-only surface); otherwise just metadata is kept.
const automationAgentUsageLogSchema = new mongoose.Schema(
  {
    // Who / what / where
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    userEmail: { type: String, default: "" },
    userRole: { type: String, default: "" },
    feature: { type: String, default: "query" }, // "query" | "test" | function id
    model: { type: String, default: "" },

    // Cost signals
    inputTokens: { type: Number, default: 0 },
    outputTokens: { type: Number, default: 0 },
    durationMs: { type: Number, default: 0 },
    success: { type: Boolean, default: false },
    stopReason: { type: String, default: "" },

    // Data governance — which categories of context were sent to the model, and
    // whether masking was applied when the context was built.
    dataCategories: { type: [String], default: [] },
    maskingApplied: { type: Boolean, default: false },

    // Optional full transcript (loggingLevel === "full" only).
    promptText: { type: String, default: "" },
    responseText: { type: String, default: "" },

    // Sanitized error (never contains the API key or raw provider payloads).
    errorMessage: { type: String, default: "" },
    // Duplicate-request guard: hash of (userId + normalized prompt); short TTL.
    requestHash: { type: String, default: "", index: true },
  },
  { timestamps: true }
);

// Fast "how many today" counts for the rate limiter.
automationAgentUsageLogSchema.index({ createdAt: 1 });
automationAgentUsageLogSchema.index({ userId: 1, createdAt: 1 });

module.exports = mongoose.model("AutomationAgentUsageLog", automationAgentUsageLogSchema);
