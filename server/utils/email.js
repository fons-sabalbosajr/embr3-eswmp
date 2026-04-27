const nodemailer = require("nodemailer");
const os = require("os");

// Resolve CLIENT_URL dynamically — uses env var, but auto-detects network IP as fallback
function getClientUrl() {
  if (process.env.CLIENT_URL) return process.env.CLIENT_URL;
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const iface of nets[name]) {
      if (iface.family === "IPv4" && !iface.internal) {
        return `http://${iface.address}:5173/eswm-pipeline`;
      }
    }
  }
  return "http://localhost:5173/eswm-pipeline";
}

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_APP_PASS,
  },
});

// Verify SMTP connection on startup
transporter.verify()
  .then(() => console.log("✅ Email transporter connected (Gmail SMTP ready)"))
  .catch((err) => console.error("❌ Email transporter error — emails will NOT send:", err.message));

function getVerificationEmailHTML(firstName, verifyLink) {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0; padding:0; background-color:#f0f2f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5; padding:40px 0;">
    <tr>
      <td align="center">
        <table width="560" cellpadding="0" cellspacing="0" style="background-color:#ffffff; border-radius:12px; overflow:hidden; box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #1a3353 0%, #2d5f8a 100%); padding:36px 40px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:28px; font-weight:800; letter-spacing:2px;">EMBR3 ESWMP</h1>
              <p style="margin:8px 0 0; color:rgba(255,255,255,0.8); font-size:14px;">Enhanced Solid Waste Management Pipeline</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <h2 style="margin:0 0 8px; color:#1a3353; font-size:22px;">Verify Your Email</h2>
              <p style="margin:0 0 24px; color:#666; font-size:15px; line-height:1.6;">
                Hi <strong>${firstName}</strong>,
              </p>
              <p style="margin:0 0 24px; color:#666; font-size:15px; line-height:1.6;">
                Thank you for creating an account. Please verify your email address by clicking the button below to complete your registration.
              </p>
              
              <!-- Button -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding:8px 0 24px;">
                    <a href="${verifyLink}" target="_blank" style="display:inline-block; background:#1a3353; color:#ffffff; text-decoration:none; padding:14px 40px; border-radius:8px; font-size:16px; font-weight:600; letter-spacing:0.5px;">
                      Verify Email Address
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 16px; color:#666; font-size:14px; line-height:1.6;">
                Or copy and paste this link into your browser:
              </p>
              <p style="margin:0 0 24px; padding:12px 16px; background:#f5f7fa; border-radius:6px; word-break:break-all; font-size:13px; color:#2d5f8a;">
                ${verifyLink}
              </p>

              <div style="border-top:1px solid #eee; padding-top:20px; margin-top:8px;">
                <p style="margin:0; color:#999; font-size:13px; line-height:1.5;">
                  This link will expire in <strong>24 hours</strong>. If you did not create an account, you can safely ignore this email.
                </p>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb; padding:20px 40px; text-align:center; border-top:1px solid #eee;">
              <p style="margin:0; color:#999; font-size:12px;">
                &copy; 2026 EMBR3 ESWMP. All rights reserved.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendVerificationEmail(email, firstName, token) {
  const verifyLink = `${getClientUrl()}/admin/verify-email?token=${token}`;

  const mailOptions = {
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Verify Your Email - EMBR3 ESWMP",
    html: getVerificationEmailHTML(firstName, verifyLink),
  };

  await transporter.sendMail(mailOptions);
}

function getAcknowledgementEmailHTML(data) {
  const { submissionId, totalEntries, entries } = data;

  const truckRows = (trucks) =>
    (trucks || [])
      .map(
        (t) =>
          `<tr><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.disposalTicketNo || "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.hauler || "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.plateNumber || "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.truckCapacity ? t.truckCapacity + " " + (t.truckCapacityUnit || "m³").replace("m3", "m³") : "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.actualVolume != null ? t.actualVolume + " " + (t.actualVolumeUnit || "tons").replace("m3", "m³") : "—"}</td><td style="padding:6px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${t.wasteType || "—"}</td></tr>`
      )
      .join("");

  const entryBlocks = entries
    .map(
      (e) => `
      <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;overflow:hidden;border:1px solid #eee;margin-bottom:16px;">
        <tr><td colspan="2" style="background:#1a3353;padding:10px 16px;color:#fff;font-size:13px;font-weight:700;">Entry — ${e.idNo}</td></tr>
        <tr><td style="padding:8px 16px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0;width:40%;font-weight:600;">Date</td><td style="padding:8px 16px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.dateOfDisposal || "—"}</td></tr>
        <tr><td style="padding:8px 16px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0;font-weight:600;">LGU/Company</td><td style="padding:8px 16px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.lguCompanyName || "—"}</td></tr>
        <tr><td style="padding:8px 16px;color:#666;font-size:13px;border-bottom:1px solid #f0f0f0;font-weight:600;">Company Type</td><td style="padding:8px 16px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.companyType || "—"}</td></tr>
        ${
          e.trucks && e.trucks.length > 0
            ? `<tr><td colspan="2" style="padding:8px 16px;color:#1a3353;font-size:13px;font-weight:700;background:#eef3f7;">Trucks (${e.trucks.length})</td></tr>
               <tr><td colspan="2" style="padding:0;">
                 <table width="100%" cellpadding="0" cellspacing="0">
                   <tr><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Ticket No.</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Hauler</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Plate No.</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Capacity</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Volume</th><th style="padding:6px 12px;text-align:left;font-size:12px;color:#666;border-bottom:1px solid #eee;">Waste Type</th></tr>
                   ${truckRows(e.trucks)}
                 </table>
               </td></tr>`
            : ""
        }
      </table>`
    )
    .join("");

  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background-color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a3353 0%,#2d5f8a 100%);padding:32px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;letter-spacing:2px;">EMBR3 ESWMP</h1>
            <p style="margin:6px 0 0;color:rgba(255,255,255,0.8);font-size:13px;">Ecological Solid Waste Management Pipeline</p>
          </td>
        </tr>
        <tr>
          <td style="padding:36px 40px;">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
                <span style="font-size:32px;">&#10003;</span>
              </div>
            </div>
            <h2 style="margin:0 0 8px;color:#1a3353;font-size:20px;text-align:center;">Submission Acknowledged</h2>
            <p style="margin:0 0 8px;color:#666;font-size:14px;line-height:1.6;text-align:center;">
              Your SLF disposal data has been received. <strong>${totalEntries}</strong> entr${totalEntries === 1 ? "y" : "ies"} recorded.
            </p>
            <p style="margin:0 0 24px;color:#999;font-size:12px;text-align:center;">Submission ID: ${submissionId}</p>

            ${entryBlocks}

            <div style="margin-top:24px;padding:16px;background:#fffbe6;border-radius:8px;border:1px solid #ffe58f;">
              <p style="margin:0;color:#ad6800;font-size:13px;line-height:1.5;">
                <strong>Note:</strong> This is an automated acknowledgement. If any information above is incorrect, please contact the ESWMP administration.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">&copy; 2026 EMBR3 ESWMP. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function sendAcknowledgementEmail(email, data) {
  const mailOptions = {
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `Submission Acknowledged — ${data.submissionId} | EMBR3 ESWMP`,
    html: getAcknowledgementEmailHTML(data),
  };

  await transporter.sendMail(mailOptions);
}

// ─── Portal Email Templates ───────────────────────────────────────────────────

function portalEmailWrapper(bodyContent) {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background-color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a3353 0%,#2d5f8a 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:2px;">EMBR3 ESWMP</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">SLF Generators Portal</p>
          </td>
        </tr>
        <tr><td style="padding:40px;">${bodyContent}</td></tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">&copy; 2026 EMBR3 ESWMP. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// 1. Signup confirmation – account pending approval
async function sendPortalSignupEmail(email, firstName) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Registration Received</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Thank you for registering on the SLF Generators Portal. Your account is currently
      <strong style="color:#fa8c16;">pending approval</strong> by the administrator.
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      You will receive another email once your account has been reviewed. This usually takes 1–2 business days.
    </p>
    <div style="padding:16px;background:#e6f7ff;border-radius:8px;border:1px solid #91d5ff;">
      <p style="margin:0;color:#0050b3;font-size:13px;line-height:1.5;">
        <strong>What happens next?</strong><br/>
        An administrator will review your registration and assign a Sanitary Landfill Facility (SLF) to your account.
        Once approved, you can log in and start submitting disposal data.
      </p>
    </div>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Registration Received — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 2. Approval notification – account approved with assigned SLF
async function sendPortalApprovalEmail(email, firstName, slfName) {
  const loginLink = `${getClientUrl()}/slfportal/login`;

  const body = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
        <span style="font-size:32px;">&#10003;</span>
      </div>
    </div>
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;text-align:center;">Account Approved!</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#666;font-size:15px;line-height:1.6;">
      Great news! Your SLF Generators Portal account has been approved. You have been assigned to:
    </p>
    <div style="padding:16px;background:#f6ffed;border-radius:8px;border:1px solid #b7eb8f;text-align:center;margin-bottom:24px;">
      <p style="margin:0;color:#389e0d;font-size:18px;font-weight:700;">${slfName}</p>
    </div>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      You can now log in and start submitting disposal data for your assigned SLF facility.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 24px;">
        <a href="${loginLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
          Log In to Portal
        </a>
      </td></tr>
    </table>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Account Approved — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 3. Rejection notification
async function sendPortalRejectionEmail(email, firstName, reason) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Registration Update</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      We regret to inform you that your registration on the SLF Generators Portal has been
      <strong style="color:#ff4d4f;">declined</strong>.
    </p>
    ${
      reason
        ? `<div style="padding:16px;background:#fff2f0;border-radius:8px;border:1px solid #ffccc7;margin-bottom:24px;">
            <p style="margin:0;color:#a8071a;font-size:14px;line-height:1.5;">
              <strong>Reason:</strong> ${reason}
            </p>
          </div>`
        : ""
    }
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      If you believe this was a mistake or have questions, please contact the ESWMP administration for further assistance.
    </p>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Registration Update — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 4. Password reset code
async function sendPortalResetPasswordEmail(email, firstName, resetCode) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Reset Your Password</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      We received a request to reset your SLF Generators Portal password. Use the code below to proceed:
    </p>
    <div style="text-align:center;margin:0 0 24px;">
      <div style="display:inline-block;background:#f5f7fa;border:2px dashed #2d5f8a;border-radius:12px;padding:20px 40px;">
        <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:#1a3353;">${resetCode}</span>
      </div>
    </div>
    <div style="border-top:1px solid #eee;padding-top:20px;margin-top:8px;">
      <p style="margin:0;color:#999;font-size:13px;line-height:1.5;">
        This code will expire in <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
      </p>
    </div>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Password Reset Code — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

// 5. Bulk acknowledge – admin acknowledged multiple entries at once
function getBulkAcknowledgeEmailHTML(data) {
  const { totalEntries, entries } = data;

  const entryRows = entries
    .map(
      (e) => `
      <tr>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;font-weight:600;">${e.idNo}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.lguCompanyName || "—"}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.companyType || "—"}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.dateOfDisposal ? new Date(e.dateOfDisposal).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—"}</td>
        <td style="padding:8px 12px;color:#333;font-size:13px;border-bottom:1px solid #f0f0f0;">${e.trucks?.length || 0}</td>
      </tr>`
    )
    .join("");

  return portalEmailWrapper(`
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
        <span style="font-size:32px;">&#10003;</span>
      </div>
    </div>
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;text-align:center;">Submissions Acknowledged</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;text-align:center;">
      The administrator has reviewed and <strong style="color:#52c41a;">acknowledged</strong>
      <strong>${totalEntries}</strong> of your submission entr${totalEntries === 1 ? "y" : "ies"}.
    </p>

    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:8px;overflow:hidden;margin-bottom:24px;">
      <tr style="background:#1a3353;">
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">ID No.</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">LGU/Company</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">Type</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">Date</th>
        <th style="padding:10px 12px;text-align:left;font-size:12px;color:#fff;">Trucks</th>
      </tr>
      ${entryRows}
    </table>

    <div style="padding:16px;background:#fffbe6;border-radius:8px;border:1px solid #ffe58f;">
      <p style="margin:0;color:#ad6800;font-size:13px;line-height:1.5;">
        <strong>Note:</strong> If any information above is incorrect, please contact the ESWMP administration.
      </p>
    </div>
  `);
}

async function sendBulkAcknowledgeEmail(email, data) {
  const mailOptions = {
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${data.totalEntries} Submission${data.totalEntries === 1 ? "" : "s"} Acknowledged | EMBR3 ESWMP`,
    html: getBulkAcknowledgeEmailHTML(data),
  };

  await transporter.sendMail(mailOptions);
}

// 6. Admin password reset code
async function sendAdminResetPasswordEmail(email, firstName, resetCode) {
  const body = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /></head>
<body style="margin:0;padding:0;background-color:#f0f2f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f0f2f5;padding:40px 0;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background-color:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
        <tr>
          <td style="background:linear-gradient(135deg,#1a3353 0%,#2d5f8a 100%);padding:36px 40px;text-align:center;">
            <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;letter-spacing:2px;">EMBR3 ESWMP</h1>
            <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">Admin Panel</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Reset Your Password</h2>
            <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
              Hi <strong>${firstName}</strong>,
            </p>
            <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
              We received a request to reset your admin account password. Use the code below to proceed:
            </p>
            <div style="text-align:center;margin:0 0 24px;">
              <div style="display:inline-block;background:#f5f7fa;border:2px dashed #2d5f8a;border-radius:12px;padding:20px 40px;">
                <span style="font-size:36px;font-weight:800;letter-spacing:12px;color:#1a3353;">${resetCode}</span>
              </div>
            </div>
            <div style="border-top:1px solid #eee;padding-top:20px;margin-top:8px;">
              <p style="margin:0;color:#999;font-size:13px;line-height:1.5;">
                This code will expire in <strong>10 minutes</strong>. If you did not request a password reset, you can safely ignore this email.
              </p>
            </div>
          </td>
        </tr>
        <tr>
          <td style="background:#f9fafb;padding:20px 40px;text-align:center;border-top:1px solid #eee;">
            <p style="margin:0;color:#999;font-size:12px;">&copy; 2026 EMBR3 ESWMP. All rights reserved.</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Password Reset Code — EMBR3 ESWMP Admin",
    html: body,
  });
}

// Send a custom email from admin to portal user regarding a submission
async function sendSubmissionEmail(email, { subject, message, submissionId, companyName }) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">${subject}</h2>
    <p style="margin:0 0 16px;color:#666;font-size:15px;line-height:1.6;">
      Regarding submission <strong>${submissionId || ""}</strong>${companyName ? ` from <strong>${companyName}</strong>` : ""}:
    </p>
    <div style="padding:16px;background:#f6f8fa;border-radius:8px;border:1px solid #e1e4e8;margin-bottom:24px;">
      <p style="margin:0;color:#333;font-size:14px;line-height:1.8;white-space:pre-wrap;">${message}</p>
    </div>
    <p style="margin:0;color:#999;font-size:13px;">
      If you have questions, please reply to this email or contact the administrator.
    </p>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: `${subject} — EMBR3 ESWMP`,
    html: portalEmailWrapper(body),
  });
}

// ─── Admin Account Approval Emails ────────────────────────────────────────────

// Notify developer that a new admin account needs approval
async function sendAdminApprovalRequestEmail(developerEmail, firstName, lastName, userEmail) {
  const adminLink = `${getClientUrl()}/admin`;
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">New Account Pending Approval</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      A new user has verified their email and is requesting access to the EMBR3 ESWMP Admin Panel.
    </p>
    <div style="padding:16px;background:#f5f7fa;border-radius:8px;border:1px solid #e2e5f0;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr><td style="padding:4px 0;color:#666;font-size:14px;font-weight:600;width:80px;">Name:</td><td style="padding:4px 0;color:#333;font-size:14px;">${firstName} ${lastName}</td></tr>
        <tr><td style="padding:4px 0;color:#666;font-size:14px;font-weight:600;">Email:</td><td style="padding:4px 0;color:#333;font-size:14px;">${userEmail}</td></tr>
      </table>
    </div>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Please log in to the admin panel to review and approve or reject this account.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 24px;">
        <a href="${adminLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
          Go to Admin Panel
        </a>
      </td></tr>
    </table>
    <div style="border-top:1px solid #eee;padding-top:20px;margin-top:8px;">
      <p style="margin:0;color:#999;font-size:13px;line-height:1.5;">
        The user will not be able to log in until their account is approved.
      </p>
    </div>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: developerEmail,
    subject: "New Account Pending Approval — EMBR3 ESWMP",
    html: portalEmailWrapper(body),
  });
}

// Notify user that their admin account has been approved
async function sendAdminApprovedEmail(email, firstName) {
  const loginLink = `${getClientUrl()}/admin/login`;
  const body = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#e6f7ee;border-radius:50%;padding:16px;">
        <span style="font-size:32px;">&#10003;</span>
      </div>
    </div>
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;text-align:center;">Account Approved!</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Your EMBR3 ESWMP admin account has been reviewed and <strong style="color:#52c41a;">approved</strong> by the developer.
      You can now log in and access the admin panel.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 24px;">
        <a href="${loginLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
          Log In Now
        </a>
      </td></tr>
    </table>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Account Approved — EMBR3 ESWMP",
    html: portalEmailWrapper(body),
  });
}

// Notify user that their admin account has been rejected
async function sendAdminRejectedEmail(email, firstName, reason) {
  const body = `
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;">Account Update</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      We regret to inform you that your EMBR3 ESWMP admin account registration has been
      <strong style="color:#ff4d4f;">declined</strong>.
    </p>
    ${
      reason
        ? `<div style="padding:16px;background:#fff2f0;border-radius:8px;border:1px solid #ffccc7;margin-bottom:24px;">
            <p style="margin:0;color:#a8071a;font-size:14px;line-height:1.5;">
              <strong>Reason:</strong> ${reason}
            </p>
          </div>`
        : ""
    }
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      If you believe this was a mistake or have questions, please contact the ESWMP administration for further assistance.
    </p>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Account Registration Update — EMBR3 ESWMP",
    html: portalEmailWrapper(body),
  });
}

// 5. Verification reminder — sent by admin to held approved accounts
async function sendPortalVerificationReminderEmail(email, firstName) {
  const loginLink = `${getClientUrl()}/slfportal/login`;

  const body = `
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#fff7e6;border-radius:50%;padding:16px;">
        <span style="font-size:32px;">&#9888;</span>
      </div>
    </div>
    <h2 style="margin:0 0 8px;color:#1a3353;font-size:22px;text-align:center;">Action Required: Update Your Verification</h2>
    <p style="margin:0 0 24px;color:#666;font-size:15px;line-height:1.6;">
      Hi <strong>${firstName}</strong>,
    </p>
    <p style="margin:0 0 16px;color:#666;font-size:15px;line-height:1.6;">
      The Environmental Management Bureau Region III (EMB R3) requires you to update your account
      verification information. This is necessary to continue using the SLF Generators Portal.
    </p>
    <div style="padding:16px;background:#fff7e6;border-radius:8px;border:1px solid #ffd591;margin-bottom:24px;">
      <p style="margin:0 0 8px;color:#ad4e00;font-size:14px;font-weight:700;">What you need to do:</p>
      <ul style="margin:0;padding-left:18px;color:#ad4e00;font-size:13px;line-height:1.8;">
        <li>Log in to the SLF Generators Portal</li>
        <li>Complete the verification form with your updated office email and PCO email address</li>
        <li>Upload a valid proof document — a copy of the letter you received from the office confirming your authorization to register on this portal</li>
      </ul>
    </div>
    <p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.6;">
      Access to the portal will be restricted until you complete this verification step.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:8px 0 24px;">
        <a href="${loginLink}" target="_blank" style="display:inline-block;background:#1a3353;color:#fff;text-decoration:none;padding:14px 40px;border-radius:8px;font-size:16px;font-weight:600;letter-spacing:0.5px;">
          Log In &amp; Complete Verification
        </a>
      </td></tr>
    </table>
    <div style="padding:16px;background:#f0f5ff;border-radius:8px;border:1px solid #adc6ff;">
      <p style="margin:0;color:#1d39c4;font-size:13px;line-height:1.5;">
        If you have questions or need assistance, please contact the EMB R3 ESWMP office directly.
      </p>
    </div>`;

  await transporter.sendMail({
    from: `"EMBR3 ESWMP" <${process.env.EMAIL_USER}>`,
    to: email,
    subject: "Action Required: Update Your Verification — SLF Generators Portal",
    html: portalEmailWrapper(body),
  });
}

module.exports = {
  sendVerificationEmail,
  sendAcknowledgementEmail,
  sendBulkAcknowledgeEmail,
  sendPortalSignupEmail,
  sendPortalApprovalEmail,
  sendPortalRejectionEmail,
  sendPortalResetPasswordEmail,
  sendPortalVerificationReminderEmail,
  sendAdminResetPasswordEmail,
  sendSubmissionEmail,
  sendAdminApprovalRequestEmail,
  sendAdminApprovedEmail,
  sendAdminRejectedEmail,
};
