// Shared helpers for the Mpesa backend. Files starting with an underscore are not public endpoints.
const PID = process.env.SANITY_PROJECT_ID;
const DS = process.env.SANITY_DATASET || "production";
const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const MP = process.env.MPESA_ENV === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

// Redis over REST. One command: kv(["GET","key"]). Many commands: kv([[...],[...]], true)
async function kv(cmd, pipeline) {
  const r = await fetch(pipeline ? KV_URL + "/pipeline" : KV_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + KV_TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error("kv " + r.status);
  const j = await r.json();
  return pipeline ? j.map((x) => x.result) : j.result;
}

// Read published content (prices) from Sanity so the browser can never set its own price.
async function sanity(query, params) {
  const qs = Object.entries(params || {}).map(([k, v]) => "&$" + k + "=" + encodeURIComponent(JSON.stringify(v))).join("");
  const r = await fetch(`https://${PID}.apicdn.sanity.io/v2025-01-01/data/query/${DS}?query=${encodeURIComponent(query)}${qs}`);
  if (!r.ok) throw new Error("sanity " + r.status);
  return (await r.json()).result;
}

async function mpesaToken() {
  const auth = Buffer.from(process.env.MPESA_CONSUMER_KEY + ":" + process.env.MPESA_CONSUMER_SECRET).toString("base64");
  const r = await fetch(MP + "/oauth/v1/generate?grant_type=client_credentials", { headers: { Authorization: "Basic " + auth } });
  if (!r.ok) throw new Error("mpesa token " + r.status);
  return (await r.json()).access_token;
}

function normPhone(v) {
  v = String(v || "").replace(/[\s+]/g, "");
  if (/^0[17]\d{8}$/.test(v)) return "254" + v.slice(1);
  if (/^254[17]\d{8}$/.test(v)) return v;
  if (/^[17]\d{8}$/.test(v)) return "254" + v;
  return null;
}
const eat = () => new Date(Date.now() + 3 * 3600e3); // Nairobi time
const today = () => eat().toISOString().slice(0, 10);
const addDays = (d, n) => { const x = new Date(d + "T00:00:00Z"); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const nightsBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);
const send = (res, code, obj) => { res.setHeader("Cache-Control", "no-store"); res.status(code).json(obj); };

// Mark a booking as failed and free its held nights.
async function fail(b, reason) {
  b.status = "failed"; b.reason = reason;
  await kv([...b.keys.map((k) => ["DEL", k]), ["SET", "bk:" + b.ref, JSON.stringify(b), "EX", 2592000]], true);
}

module.exports = { kv, sanity, mpesaToken, normPhone, eat, today, addDays, nightsBetween, send, fail, MP };
