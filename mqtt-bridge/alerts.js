/**
 * SmokeSense Alert Notifications
 * Email (SendGrid) + SMS (Twilio)
 * 
 * Stage 2+ (Pre-Alarm): Email notification
 * Stage 3+ (Critical): Email + SMS
 * Stage 4  (Emergency): Email + SMS (urgent)
 * 
 * 5-minute cooldown per device to prevent alert storms.
 */

const CONFIG = {
  sendgridKey: process.env.SENDGRID_API_KEY || "",
  sendgridFrom: process.env.SENDGRID_FROM_EMAIL || "alerts@arcticengineering.co.za",
  twilioSid: process.env.TWILIO_ACCOUNT_SID || "",
  twilioAuth: process.env.TWILIO_AUTH_TOKEN || "",
  twilioFrom: process.env.TWILIO_FROM_NUMBER || "",
  emailRecipients: (process.env.ALERT_EMAILS || "").split(",").filter(Boolean),
  smsRecipients: (process.env.ALERT_SMS_NUMBERS || "").split(",").filter(Boolean),
  emailMinSeverity: parseInt(process.env.EMAIL_MIN_SEVERITY || "2"),
  smsMinSeverity: parseInt(process.env.SMS_MIN_SEVERITY || "3"),
  cooldownMs: parseInt(process.env.ALERT_COOLDOWN_MS || "300000"),
};

const cooldowns = new Map();
const STAGE_LABELS = ["Normal", "Early Warning", "Pre-Alarm", "Critical", "EMERGENCY"];

function isConfigured() {
  return CONFIG.sendgridKey || (CONFIG.twilioSid && CONFIG.twilioAuth);
}

function isCoolingDown(deviceId) {
  const last = cooldowns.get(deviceId);
  return last && (Date.now() - last) < CONFIG.cooldownMs;
}

async function sendEmail(deviceId, deviceName, zone, severity, stageName, source) {
  if (!CONFIG.sendgridKey || CONFIG.emailRecipients.length === 0) return;
  if (severity < CONFIG.emailMinSeverity) return;

  const isEmergency = severity >= 4;
  const subject = isEmergency
    ? `EMERGENCY: ${deviceName} - ${stageName}`
    : `Alert: ${deviceName} - ${stageName}`;

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:${isEmergency ? '#dc2626' : severity >= 3 ? '#d97706' : '#2563eb'};color:white;padding:16px 24px;border-radius:8px 8px 0 0">
        <h2 style="margin:0;font-size:20px">${subject}</h2>
      </div>
      <div style="background:#f8f9fa;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px 0;color:#666">Device</td><td style="padding:8px 0;font-weight:bold">${deviceName} (${deviceId})</td></tr>
          <tr><td style="padding:8px 0;color:#666">Zone</td><td style="padding:8px 0">${zone}</td></tr>
          <tr><td style="padding:8px 0;color:#666">Stage</td><td style="padding:8px 0;font-weight:bold;color:${isEmergency ? '#dc2626' : '#d97706'}">${stageName}</td></tr>
          <tr><td style="padding:8px 0;color:#666">Source</td><td style="padding:8px 0">${source}</td></tr>
          <tr><td style="padding:8px 0;color:#666">Time</td><td style="padding:8px 0">${new Date().toISOString()}</td></tr>
        </table>
        <div style="margin-top:16px;padding:12px;background:${isEmergency ? '#fef2f2' : '#fffbeb'};border-radius:4px;border:1px solid ${isEmergency ? '#fecaca' : '#fde68a'}">
          ${isEmergency ? '<b>IMMEDIATE ACTION REQUIRED.</b> Evacuate area and contact emergency services.' : '<b>Investigate promptly.</b> Check the SmokeSense dashboard for live readings.'}
        </div>
        <p style="margin-top:16px;font-size:13px;color:#999">SmokeSense DataGuard - Arctic Engineering - arcticengineering.co.za</p>
      </div>
    </div>
  `;

  try {
    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${CONFIG.sendgridKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: CONFIG.emailRecipients.map(e => ({ email: e.trim() })) }],
        from: { email: CONFIG.sendgridFrom, name: "SmokeSense DataGuard" },
        subject,
        content: [{ type: "text/html", value: html }],
      }),
    });
    console.log(`[ALERT] EMAIL sent: ${subject} (${res.status})`);
  } catch (err) {
    console.error(`[ALERT] Email failed:`, err.message);
  }
}

async function sendSms(deviceId, deviceName, zone, severity, stageName) {
  if (!CONFIG.twilioSid || !CONFIG.twilioAuth || CONFIG.smsRecipients.length === 0) return;
  if (severity < CONFIG.smsMinSeverity) return;

  const body = severity >= 4
    ? `EMERGENCY: ${deviceName} (${zone}) - ${stageName}. Evacuate immediately. - SmokeSense`
    : `ALERT: ${deviceName} (${zone}) - ${stageName}. Check dashboard. - SmokeSense`;

  const auth = Buffer.from(`${CONFIG.twilioSid}:${CONFIG.twilioAuth}`).toString("base64");

  for (const to of CONFIG.smsRecipients) {
    try {
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${CONFIG.twilioSid}/Messages.json`,
        {
          method: "POST",
          headers: {
            "Authorization": `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            To: to.trim(),
            From: CONFIG.twilioFrom,
            Body: body,
          }),
        }
      );
      console.log(`[ALERT] SMS sent to ${to.trim()} (${res.status})`);
    } catch (err) {
      console.error(`[ALERT] SMS to ${to.trim()} failed:`, err.message);
    }
  }
}

/**
 * Main alert function - called by the bridge on escalation events
 * @param {object} supabase - Supabase client for device lookup
 * @param {string} orgId
 * @param {string} deviceId
 * @param {object} eventData - event payload with severity, source, etc.
 */
export async function sendAlert(supabase, orgId, deviceId, eventData) {
  const severity = eventData.severity ?? 0;
  if (severity < CONFIG.emailMinSeverity) return;

  if (isCoolingDown(deviceId)) {
    console.log(`[ALERT] Suppressed for ${deviceId} (cooldown)`);
    return;
  }
  cooldowns.set(deviceId, Date.now());

  const stageName = STAGE_LABELS[Math.min(severity, 4)];
  const source = eventData.source || "unknown";

  // Get device name from DB
  const { data: device } = await supabase
    .from("devices")
    .select("name, zone")
    .eq("device_id", deviceId)
    .maybeSingle();

  const deviceName = device?.name || deviceId;
  const zone = device?.zone || "Unassigned";

  // Send email and SMS in parallel
  await Promise.allSettled([
    sendEmail(deviceId, deviceName, zone, severity, stageName, source),
    sendSms(deviceId, deviceName, zone, severity, stageName),
  ]);
}

export function alertStatus() {
  return {
    email_configured: !!CONFIG.sendgridKey,
    sms_configured: !!(CONFIG.twilioSid && CONFIG.twilioAuth),
    email_recipients: CONFIG.emailRecipients.length,
    sms_recipients: CONFIG.smsRecipients.length,
    email_min_severity: CONFIG.emailMinSeverity,
    sms_min_severity: CONFIG.smsMinSeverity,
    cooldown_ms: CONFIG.cooldownMs,
  };
}
