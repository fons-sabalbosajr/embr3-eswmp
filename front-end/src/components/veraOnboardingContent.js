// Portal-specific onboarding content for the VERA introduction carousel.
// Concise, non-sensitive copy only — NO developer-only functions are described.
// Shared slide structure; the "What VERA Can Do" and "How VERA Helps" slides
// differ per portal.

const COMMON = {
  cannotDo: [
    "See or change your live records, or submit/approve on your behalf",
    "Reveal credentials, API keys, settings, or any developer-only function",
    "Invent policies, deadlines, or a record's real status",
  ],
  privacy:
    "VERA gives guidance grounded in the portal's help library — not confirmed system data. It never sends your private records to the model, and always tells you when it can't verify something.",
};

const CONTENT = {
  slf: {
    tagline: "Your guide to the SLF Portal",
    purpose:
      "VERA helps you submit disposal data correctly, understand forms and statuses, and avoid submission errors.",
    canDo: [
      { icon: "send", title: "Submission guidance", text: "Step-by-step help through Data Entry and Review & Submit." },
      { icon: "form", title: "Form & field explanations", text: "What each field means and why it's required." },
      { icon: "calendar", title: "Disposal calendar help", text: "Reading the calendar and your submission dates." },
      { icon: "safety", title: "Prevention Measures", text: "Guidance on prevention records and documents." },
      { icon: "status", title: "Status explanations", text: "Pending, acknowledged, reverted, rejected — what to do next." },
      { icon: "warn", title: "Error warnings", text: "Heads-up on incomplete or invalid submissions before you submit." },
    ],
    helps: [
      "Ask “Why is Review & Submit disabled?” to see exactly what's missing.",
      "Ask how to organize cells, add haulers, or fix a validation error.",
      "Open a support ticket right from the chat when you need a person.",
    ],
  },
  admin: {
    tagline: "Your guide to the Admin Portal",
    purpose:
      "VERA helps you review submissions, read the dashboard and map, and find the right admin function fast.",
    canDo: [
      { icon: "check", title: "Workflow guidance", text: "How to approve, revert, or reject submissions." },
      { icon: "dashboard", title: "Dashboard & reports", text: "What tiles, charts, and reports mean." },
      { icon: "audit", title: "Submission review", text: "Step-by-step review instructions." },
      { icon: "team", title: "SLF accounts & records", text: "Where to find and update facility records." },
      { icon: "map", title: "Calendar & map statuses", text: "What each marker colour and status means." },
      { icon: "safety", title: "Prevention review", text: "Reviewing Prevention Measures and document summaries." },
    ],
    helps: [
      "Ask “How do I approve a disposal submission?” for the exact steps.",
      "Ask what a dashboard status or map marker means.",
      "Ask where to update an SLF account or generate a report.",
    ],
  },
};

export function getOnboarding(portal) {
  const key = portal === "admin" ? "admin" : "slf";
  return { ...CONTENT[key], ...COMMON, portal: key };
}

export default getOnboarding;
