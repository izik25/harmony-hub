// Phone sign-in via Twilio Verify — Twilio owns code generation, expiry, and attempt limiting, so
// there's no OTP table to manage here. Requires a Verify Service at https://console.twilio.com/us1/develop/verify/services
// and its SID plus the account's Account SID / Auth Token in .env. Until configured, requestPhoneCode
// throws "phoneAuthNotConfigured" and the client hides the phone tab (see functions/auth.ts's
// getAuthProviders).
function configured(): boolean {
  return !!(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_VERIFY_SERVICE_SID
  );
}

function authHeader(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  return `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`;
}

async function sendPhoneCode(phone: string): Promise<void> {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid}/Verifications`,
    {
      method: "POST",
      headers: {
        authorization: authHeader(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Channel: "sms" }),
    },
  );
  if (!res.ok) throw new Error(`phoneCodeSendFailed:${await res.text()}`);
}

async function checkPhoneCode(phone: string, code: string): Promise<boolean> {
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID!;
  const res = await fetch(
    `https://verify.twilio.com/v2/Services/${serviceSid}/VerificationCheck`,
    {
      method: "POST",
      headers: {
        authorization: authHeader(),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ To: phone, Code: code }),
    },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { status?: string };
  return json.status === "approved";
}

export const phoneAuth = { configured, sendPhoneCode, checkPhoneCode };
