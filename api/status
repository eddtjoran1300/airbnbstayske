// GET /api/status?ref=... : the website polls this while the guest approves the prompt.
const L = require("./_lib");

module.exports = async (req, res) => {
  try {
    const ref = String(req.query.ref || "");
    if (!/^[a-f0-9-]{36}$/.test(ref)) return L.send(res, 400, { error: "Bad reference" });
    const raw = await L.kv(["GET", "bk:" + ref]);
    if (!raw) return L.send(res, 404, { status: "unknown" });
    const b = JSON.parse(raw);
    const status = b.status === "paid" ? "paid" : b.status === "pending" ? "pending" : "failed";
    return L.send(res, 200, { status, receipt: b.status === "paid" ? b.receipt : null, reason: b.reason || null });
  } catch (e) {
    console.error(e);
    return L.send(res, 500, { error: "Error" });
  }
};
