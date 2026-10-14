// POST /api/payment-hook : Safaricom calls this after the guest approves or cancels the prompt.
const L = require("./_lib");

const REASONS = { 1: "Insufficient Mpesa balance.", 1032: "You cancelled the request.", 1037: "The request timed out. Please try again.", 2001: "Wrong PIN entered." };

module.exports = async (req, res) => {
  const ok = () => res.status(200).json({ ResultCode: 0, ResultDesc: "Accepted" });
  try {
    const { k, ref } = req.query;
    if (!process.env.CALLBACK_SECRET || k !== process.env.CALLBACK_SECRET || !/^[a-f0-9-]{36}$/.test(ref || "")) return res.status(403).json({});
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb) return ok();
    const raw = await L.kv(["GET", "bk:" + ref]);
    if (!raw) return ok();
    const b = JSON.parse(raw);
    if (b.status === "paid") return ok(); // already handled

    if (Number(cb.ResultCode) === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
      const get = (n) => (items.find((i) => i.Name === n) || {}).Value;
      b.receipt = String(get("MpesaReceiptNumber") || "");
      b.paidAmount = Number(get("Amount"));
      b.paidAt = new Date().toISOString();
      if (b.paidAmount < b.amount) {
        b.status = "review"; b.reason = "Payment amount did not match. Contact us with receipt " + b.receipt + ".";
      } else {
        b.status = "paid";
        await L.kv([...b.keys.map((key) => ["SET", key, ref]), ["LPUSH", "bookings", ref]], true); // keep nights booked, add to list
      }
      await L.kv(["SET", "bk:" + ref, JSON.stringify(b)]); // no expiry
    } else {
      await L.fail(b, REASONS[cb.ResultCode] || cb.ResultDesc || "The payment was not completed.");
    }
    return ok();
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ResultCode: 1, ResultDesc: "Error" });
  }
};
