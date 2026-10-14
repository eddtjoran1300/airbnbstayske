// GET /api/bookings?key=YOUR_ADMIN_KEY : lists your latest paid bookings. Keep the key private.
const L = require("./_lib");

module.exports = async (req, res) => {
  try {
    if (!process.env.ADMIN_KEY || req.query.key !== process.env.ADMIN_KEY) return L.send(res, 403, { error: "Forbidden" });
    const refs = await L.kv(["LRANGE", "bookings", 0, 99]);
    if (!refs.length) return L.send(res, 200, []);
    const rows = await L.kv(["MGET", ...refs.map((r) => "bk:" + r)]);
    return L.send(res, 200, rows.filter(Boolean).map((r) => { const b = JSON.parse(r); delete b.keys; return b; }));
  } catch (e) {
    console.error(e);
    return L.send(res, 500, { error: "Error" });
  }
};
