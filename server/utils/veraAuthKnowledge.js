// VERA — PUBLIC (unauthenticated) knowledge for the auth pages: login, sign up,
// forgot password, account recovery.
//
// This is the ONLY knowledge base reachable without a token, and it is deliberately
// narrow. Rules that hold for every entry here:
//
//   * NOTHING is looked up. VERA never checks whether an email is registered, what
//     an account's status is, or whether a reset code was issued — answering any of
//     those to an anonymous caller would turn the assistant into an account
//     enumeration oracle. Guidance only, identical for every visitor.
//   * No credential ever gets handled. VERA cannot read, retrieve, verify or reset
//     a password, and it must say so plainly rather than appear to try.
//   * Everything that genuinely needs a human goes to the support address, because
//     an anonymous visitor has no other verified channel.

const { ASSISTANT_NAME, ASSISTANT_FULL_NAME } = require("./veraKnowledge");

const SUPPORT_EMAIL = "eswmr3@emb.gov.ph";

const AUTH_KNOWLEDGE_BASE = [
  {
    id: "auth-forgot-password",
    category: "recovery",
    question: "I forgot my password — how do I reset it?",
    keywords: [
      "forgot password", "forgot my password", "reset password", "reset my password",
      "change password", "new password", "password", "lost password", "cannot remember",
      "forgotten",
    ],
    answer:
      "Use the “Forgot password?” link on the sign-in page. Enter your registered email and you'll be sent a 6-digit code, then: (1) type the code on the next screen, (2) set a new password of at least 6 characters, (3) sign in with it. The code is valid for 10 minutes — if it expires, use “Resend” to get a fresh one. Nobody, including me, can read or retrieve your existing password; it can only be replaced this way.",
    related: ["auth-code-not-arriving", "auth-no-email-access"],
  },
  {
    id: "auth-code-not-arriving",
    category: "recovery",
    question: "The reset code never arrived — what now?",
    keywords: [
      "code not received", "no code", "didn't receive", "did not receive", "not arriving",
      "no email", "never got", "missing code", "resend", "spam", "junk", "waiting",
      "how long", "delayed",
    ],
    answer:
      "Work through these in order: (1) allow 1–2 minutes — delivery is not instant; (2) check the Spam / Junk and Promotions folders, and search your mailbox for “EMBR3” or “VERA”; (3) confirm you typed the same address the account was registered with, including the exact domain; (4) press “Resend” on the code screen — the previous code stops working once a new one is issued; (5) if a corporate mail server may be filtering it, ask your IT to allow mail from the EMB Region III sender. If nothing arrives after all of that, email " + SUPPORT_EMAIL + " from any address you can access and describe the problem — an administrator will verify you another way.",
    related: ["auth-forgot-password", "auth-no-email-access"],
  },
  {
    id: "auth-no-email-access",
    category: "recovery",
    question: "I no longer have access to the registered email address",
    keywords: [
      "lost access", "no longer have", "old email", "changed email", "email changed",
      "cannot access email", "staff left", "resigned", "previous officer", "handover",
      "update email", "change registered email", "wrong email",
    ],
    answer:
      "A password reset can only go to the address already on the account, so this needs an administrator and cannot be done self-service. Email " + SUPPORT_EMAIL + " from an address you control and include: your facility / LGU name, the old registered email if you know it, the new email to use, and your role at the facility. EMB Region III verifies the request before changing anything — expect to be asked for proof, which is deliberate, since this is exactly the route someone else would try to take over an account.",
    related: ["auth-contact-support", "auth-forgot-password"],
  },
  {
    id: "auth-locked-or-disabled",
    category: "recovery",
    question: "My account seems locked, disabled, or not yet approved",
    keywords: [
      "locked", "lockout", "disabled", "deactivated", "suspended", "blocked",
      "not approved", "pending approval", "awaiting approval", "inactive", "access denied",
      "too many attempts", "429", "rate limit",
    ],
    answer:
      "There are a few different causes and they need different actions. Repeated failed sign-ins temporarily throttle attempts — wait a few minutes and try again rather than retrying immediately. A newly registered portal account stays pending until EMB Region III approves it, which is normal and not an error. If an administrator has deactivated the account, or it is awaiting a verification document, only EMB Region III can change that: email " + SUPPORT_EMAIL + " with your facility name and registered email. I cannot look up any account's status from this page.",
    related: ["auth-contact-support"],
  },
  {
    id: "auth-pending-approval",
    category: "recovery",
    question: "It says my account is still pending approval",
    keywords: [
      "pending approval", "still pending", "awaiting approval", "wait for admin",
      "not approved yet", "how long approval", "approve my account", "waiting for approval",
      "registered but cannot login", "signed up but",
    ],
    answer:
      "That message means registration worked and the account now needs an EMB Region III administrator to approve it — it is a normal step, not a fault, and no password reset will change it. Approval also involves assigning your SLF facility, so it is not instant. If it has been longer than you'd expect, or the timing is urgent, email " +
      SUPPORT_EMAIL + " with your facility / LGU name and the email you registered with, and ask for the registration to be reviewed. I can't see or influence any account's approval state from this page.",
    related: ["auth-signup", "auth-contact-support"],
  },
  {
    id: "auth-registration-rejected",
    category: "recovery",
    question: "My registration was rejected",
    keywords: [
      "rejected", "registration rejected", "declined", "refused", "denied registration",
      "contact the administrator", "why was i rejected", "reapply", "register again",
    ],
    answer:
      "A rejection is an administrator decision and the reason is not shown on this screen, so the only way forward is to ask. Email " +
      SUPPORT_EMAIL + " with your facility / LGU name, the email you used, and a request for the reason — common causes are details that didn't match the facility on record, a duplicate of an existing account, or missing verification documents. Once you know the reason you can correct it and register again; creating extra accounts before that usually just adds another rejection.",
    related: ["auth-signup", "auth-contact-support"],
  },
  {
    id: "auth-verification-document",
    category: "recovery",
    question: "I'm being asked for verification documents / mine are under review",
    keywords: [
      "verification", "verify", "verification document", "verification file", "attachment",
      "upload document", "under review", "awaiting review", "verification required",
      "hold", "held", "verify update", "resubmit document", "proof",
    ],
    answer:
      "Some accounts are held until a verification attachment is supplied — after signing in you're taken to the verification form instead of the portal, where you upload the requested file and submit. Once submitted it sits with EMB Region III for review and you'll see \"awaiting admin review\" until they act; re-uploading repeatedly does not speed that up. If you were asked for a document you don't have, or you believe the hold is a mistake, email " +
      SUPPORT_EMAIL + " with your facility name and registered email. This is separate from a password problem — a reset won't clear a verification hold.",
    related: ["auth-pending-approval", "auth-contact-support"],
  },
  {
    id: "auth-username-vs-email",
    category: "login",
    question: "Do I sign in with my username or my email? / my username isn't working",
    keywords: [
      "username", "user name", "email or username", "which one", "login id", "user id",
      "username not working", "username already registered", "change username",
      "update credentials", "credential update",
    ],
    answer:
      "The portal accepts either the registered email or a username, if one was set for your account. If a username isn't recognised, use the email address the account was registered with — that always exists, whereas a username is optional. Some accounts are offered a one-time credential update right after signing in, where a new username or password can be set; a code is sent to the registered email to confirm it. If credential updates are switched off for your account, or a username you want is already taken, only EMB Region III can sort that: email " +
      SUPPORT_EMAIL + ".",
    related: ["auth-login-trouble", "auth-forgot-password"],
  },
  {
    id: "auth-maintenance",
    category: "login",
    question: "The portal says it's under maintenance",
    keywords: [
      "maintenance", "under maintenance", "temporarily unavailable", "down", "offline",
      "cannot sign in right now", "try again later", "outage",
    ],
    answer:
      "During maintenance sign-in and password recovery are both paused for everyone — it is not specific to your account and nothing is wrong with your credentials, so there's no need to keep retrying or to reset anything. The notice on the sign-in page carries whatever detail EMB Region III published. Wait for it to lift and try again; if a submission deadline is at risk, email " +
      SUPPORT_EMAIL + " so it's on record that you were blocked.",
    related: ["auth-login-trouble", "auth-contact-support"],
  },
  {
    id: "auth-wrong-facility",
    category: "recovery",
    question: "I'm signed in but the wrong SLF / facility is assigned to me",
    keywords: [
      "wrong facility", "wrong slf", "wrong lgu", "no facility", "not assigned",
      "assigned slf", "different facility", "cannot see my facility", "empty portal",
      "no data", "change facility",
    ],
    answer:
      "Which SLF facility your account can submit for is set by EMB Region III, not by you, so it can't be changed from the portal. If the assigned facility is wrong, missing, or you've moved to a different LGU, email " +
      SUPPORT_EMAIL + " with your registered email, the facility currently showing, and the facility it should be. Include your role at the facility — they verify a reassignment before making it, since it changes which records the account can see and submit.",
    related: ["auth-contact-support", "auth-pending-approval"],
  },
  {
    id: "auth-signup",
    category: "signup",
    question: "How do I register / sign up for a portal account?",
    keywords: [
      "sign up", "signup", "register", "registration", "create account", "new account",
      "how to apply", "enroll", "request access", "get an account",
    ],
    answer:
      "Use “Create an account” on the portal sign-in page and complete the registration form with your facility details and a working email you control. Registration does not grant immediate access: EMB Region III reviews the request, may ask for a verification document, and assigns your SLF facility before submissions are enabled. You'll be notified at the email you registered. For questions about a pending registration, email " + SUPPORT_EMAIL + ".",
    related: ["auth-locked-or-disabled", "auth-contact-support"],
  },
  {
    id: "auth-login-trouble",
    category: "login",
    question: "I can't sign in even though I'm sure my details are right",
    keywords: [
      "cannot login", "can't log in", "cannot sign in", "invalid credentials",
      "wrong password", "incorrect password", "login failed", "sign in failed",
      "username", "email not recognised", "not recognized", "maintenance",
    ],
    answer:
      "Check these: (1) the portal and the admin side are separate sign-ins — a portal account cannot sign in on the admin page, or vice versa; (2) email is not case-sensitive but passwords are, so check Caps Lock and any trailing space from copy-paste; (3) if a maintenance notice is showing, sign-in is paused for everyone and password recovery is unavailable until it lifts; (4) if you still can't get in, reset the password with “Forgot password?” rather than retrying — repeated failures throttle further attempts. I can't verify credentials or confirm whether an email is registered from this page.",
    related: ["auth-forgot-password", "auth-locked-or-disabled"],
  },
  {
    id: "auth-security",
    category: "security",
    question: "Can you tell me my password, or reset it for me?",
    keywords: [
      "tell me my password", "what is my password", "give me my password",
      "send my password", "reset it for me", "do it for me", "recover my password",
      "share password", "otp", "code for me",
    ],
    answer:
      "No — and no one at EMB Region III can either. Passwords are stored hashed, so they cannot be read back by anyone, and I have no access to any account's data from this page. The only route is the “Forgot password?” flow, which sends a code to the address already registered on the account. Never share a reset code or password with anyone, including someone claiming to be EMB Region III staff: a genuine request will never ask you for either.",
    related: ["auth-forgot-password", "auth-contact-support"],
  },
  {
    id: "auth-contact-support",
    category: "support",
    question: "How do I contact EMB Region III?",
    keywords: [
      "contact", "support", "help", "email address", "who do i contact", "phone",
      "assistance", "human", "administrator", "admin", "reach",
    ],
    answer:
      "Email " + SUPPORT_EMAIL + ". Include your facility / LGU name, the registered email, and what you are trying to do — that lets an administrator verify you and act without a round trip. From inside the portal you can also raise a support ticket through me, but that needs you to be signed in, which is why email is the route from this page.",
    related: ["auth-no-email-access"],
  },
  {
    id: "auth-what-is-vera",
    category: "meta",
    question: "What can you help me with here?",
    keywords: [
      "what can you do", "who are you", "vera", "help me", "capabilities", "what is vera",
    ],
    answer:
      `I'm ${ASSISTANT_NAME} (${ASSISTANT_FULL_NAME}). On the sign-in and recovery pages I help with exactly one thing: getting you back into your account — resetting a password, a reset code that hasn't arrived, losing access to a registered email, a pending or deactivated account, and how to register. I deliberately have no access to accounts or data here, so I can't look anyone up, confirm whether an email is registered, or change anything. Once you're signed in I can help with submissions, baseline data, haulers, cells and support tickets.`,
    related: ["auth-forgot-password", "auth-contact-support"],
  },
];

// Vocabulary that keeps a recovery question in scope. Anything genuinely unrelated
// still gets the out-of-scope reply.
const AUTH_SCOPE_TERMS = [
  "password", "passwords", "reset", "forgot", "forgotten", "code", "otp", "email",
  "login", "log in", "logon", "sign in", "signin", "sign up", "signup", "register",
  "registration", "account", "access", "locked", "lock", "disabled", "deactivated",
  "suspended", "approve", "approved", "approval", "pending", "verify", "verification",
  "credential", "credentials", "username", "user name", "recover", "recovery",
  "portal", "admin", "vera", "support", "contact", "help", "spam", "junk", "resend",
  "expired", "invalid", "maintenance", "slf", "facility", "lgu",
  // Added with the account-problem articles so those questions retrieve as in-scope.
  "rejected", "declined", "denied", "document", "documents", "attachment", "upload",
  "review", "hold", "held", "assigned", "assignment", "reassign", "wrong", "missing",
  "offline", "down", "outage", "unavailable", "attempt", "attempts", "throttle",
  "duplicate", "second account", "new account", "cenro", "menro", "officer", "staff",
];

const AUTH_GREETING_REPLY =
  `Hi, I'm ${ASSISTANT_NAME}. I can help you get back into your account — password resets, a reset code that hasn't arrived, or losing access to your registered email. What's happening?`;

const AUTH_OUT_OF_SCOPE_REPLY =
  "On this page I can only help with signing in and account recovery — password resets, reset codes, registration, and pending or locked accounts. Once you're signed in I can help with submissions, baseline data, haulers, cells and support tickets. For anything else, email " +
  SUPPORT_EMAIL + ".";

const AUTH_CANNOT_VERIFY_REPLY =
  "I can't confirm that from this page — I have no access to accounts or their data before you sign in, which is deliberate. Try the “Forgot password?” flow if you need a reset, or email " +
  SUPPORT_EMAIL + " and an administrator will verify you directly.";

const AUTH_STARTER_QUESTIONS = [
  "I forgot my password",
  "The reset code never arrived",
  "I no longer have access to my registered email",
  "Why is my account not approved yet?",
  "How do I register for a portal account?",
];

const AUTH_PAGE_LABELS = {
  "portal-login": "SLF Portal sign-in",
  "admin-login": "Admin sign-in",
  "portal-signup": "SLF Portal registration",
  "admin-signup": "Admin registration",
  "portal-forgot-password": "SLF Portal password recovery",
  "admin-forgot-password": "Admin password recovery",
};

module.exports = {
  AUTH_KNOWLEDGE_BASE,
  AUTH_SCOPE_TERMS,
  AUTH_GREETING_REPLY,
  AUTH_OUT_OF_SCOPE_REPLY,
  AUTH_CANNOT_VERIFY_REPLY,
  AUTH_STARTER_QUESTIONS,
  AUTH_PAGE_LABELS,
  SUPPORT_EMAIL,
};
