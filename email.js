// ---------------------------------------------------------------------------
// Email module — Resend integration
//
// Required env vars (set in Railway dashboard):
//   RESEND_API_KEY   — your Resend API key (re_xxx...)
//   EMAIL_FROM       — sender address. Resend default sandbox value works
//                      until you verify a domain: "BruntWork LMS <onboarding@resend.dev>"
//                      (sandbox can ONLY send to the email you signed up with).
//                      After verifying a domain in Resend, set to e.g.
//                      "BruntWork LMS <noreply@yourdomain.com>"
//   APP_URL          — public base URL of the LMS (used in links inside emails).
//                      e.g. https://team-lms-production.up.railway.app
// ---------------------------------------------------------------------------

let resendClient = null;

function getResend() {
  if (resendClient) return resendClient;
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  try {
    const { Resend } = require('resend');
    resendClient = new Resend(key);
    return resendClient;
  } catch (err) {
    console.error('[email] Failed to initialise Resend:', err.message);
    return null;
  }
}

function getFrom() {
  return process.env.EMAIL_FROM || 'BruntWork LMS <onboarding@resend.dev>';
}

function getAppUrl() {
  return process.env.APP_URL || 'http://localhost:3000';
}

function isConfigured() {
  return !!process.env.RESEND_API_KEY;
}

/**
 * Low-level send. Returns { ok, id?, error? }.
 * Never throws — callers can decide whether to surface the error.
 */
async function sendEmail({ to, subject, html, text }) {
  const resend = getResend();
  if (!resend) {
    console.warn(`[email] RESEND_API_KEY not set; would have sent "${subject}" to ${to}`);
    return { ok: false, error: 'Email is not configured (missing RESEND_API_KEY).' };
  }
  try {
    const { data, error } = await resend.emails.send({
      from: getFrom(),
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      text: text || stripHtml(html),
    });
    if (error) {
      console.error('[email] Resend error:', error);
      return { ok: false, error: error.message || 'Resend API error' };
    }
    return { ok: true, id: data?.id };
  } catch (err) {
    console.error('[email] send threw:', err);
    return { ok: false, error: err.message };
  }
}

function stripHtml(html) {
  return (html || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Branded template wrapper
// ---------------------------------------------------------------------------
function wrap({ heading, bodyHtml, buttonLabel, buttonUrl, footer }) {
  const button = (buttonLabel && buttonUrl)
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0">
         <tr><td bgcolor="#0170B9" style="border-radius:6px">
           <a href="${buttonUrl}" target="_blank"
              style="display:inline-block;padding:12px 24px;color:#fff;text-decoration:none;font-weight:600;font-family:Inter,Arial,sans-serif">
             ${buttonLabel}
           </a>
         </td></tr>
       </table>`
    : '';
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>BruntWork LMS</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1f5f9;padding:32px 16px">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" border="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.06)">
        <tr><td style="background:#0170B9;padding:20px 28px;color:#fff;font-weight:700;font-size:18px">
          BruntWork LMS
        </td></tr>
        <tr><td style="padding:28px;line-height:1.55;font-size:15px;color:#0f172a">
          <h2 style="margin:0 0 12px;font-size:20px;color:#0f172a">${heading}</h2>
          ${bodyHtml}
          ${button}
          ${footer ? `<p style="margin:24px 0 0;color:#64748b;font-size:13px">${footer}</p>` : ''}
        </td></tr>
        <tr><td style="background:#f8fafc;padding:16px 28px;color:#94a3b8;font-size:12px;text-align:center">
          Sent by BruntWork LMS · <a href="${getAppUrl()}" style="color:#94a3b8">${getAppUrl().replace(/^https?:\/\//, '')}</a>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Specific email templates
// ---------------------------------------------------------------------------
async function sendPasswordReset({ to, name, token }) {
  const url = `${getAppUrl()}/#/reset-password/${token}`;
  const html = wrap({
    heading: 'Reset your password',
    bodyHtml: `
      <p>Hi ${escapeHtml(name || 'there')},</p>
      <p>We received a request to reset the password for your BruntWork LMS account.
         Click the button below to choose a new one. This link expires in 1 hour.</p>
    `,
    buttonLabel: 'Reset password',
    buttonUrl: url,
    footer: `If you didn't request this, you can safely ignore this email — your password won't change.<br><br>If the button doesn't work, copy this link: ${url}`,
  });
  return sendEmail({ to, subject: 'Reset your BruntWork LMS password', html });
}

async function sendWelcome({ to, name }) {
  const url = `${getAppUrl()}/#/dashboard`;
  const html = wrap({
    heading: `Welcome to BruntWork LMS, ${escapeHtml(name || 'there')}!`,
    bodyHtml: `
      <p>Your account is ready. Sign in to start learning, track your progress, and earn certificates.</p>
    `,
    buttonLabel: 'Open dashboard',
    buttonUrl: url,
  });
  return sendEmail({ to, subject: 'Welcome to BruntWork LMS', html });
}

async function sendAnnouncement({ to, subject, message, actionLabel, actionUrl }) {
  const html = wrap({
    heading: subject,
    bodyHtml: message, // expected to be safe HTML provided by admin
    buttonLabel: actionLabel,
    buttonUrl: actionUrl,
  });
  return sendEmail({ to, subject, html });
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = {
  isConfigured,
  sendEmail,
  sendPasswordReset,
  sendWelcome,
  sendAnnouncement,
};
