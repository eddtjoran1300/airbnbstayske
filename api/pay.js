// POST /api/pay : validates the booking, holds the dates, and sends the Mpesa prompt to the guest's phone.
const crypto = require("crypto");
const L = require("./_lib");

module.exports = async (req, res) => {
  if (req.method !== "POST") return L.send(res, 405, { error: "Method not allowed" });
  try {
    const b = req.body || {};
    const name = String(b.name || "").trim().slice(0, 80);
    const phone = L.normPhone(b.phone);
    const stayId = String(b.stayId || "");
    const packageId = b.packageId ? String(b.packageId) : null;
    const guests = parseInt(b.guests, 10);
    const checkIn = String(b.checkIn || "");

    if (name.length < 2) return L.send(res, 400, { error: "Enter your full name." });
    if (!phone) return L.send(res, 400, { error: "Enter a valid Safaricom number." });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkIn) || checkIn < L.today()) return L.send(res, 400, { error: "Choose a valid check in date." });

    // Work out the real price from your Sanity content, never from the browser.
    const stay = await L.sanity('*[_id==$id&&_type=="stay"][0]{name,price,maxGuests}', { id: stayId });
    if (!stay) return L.send(res, 400, { error: "This stay is not available for booking." });
    let nights, amount, maxG, pkg = null;
    if (packageId) {
      pkg = await L.sanity('*[_id==$id&&_type=="package"&&stay._ref==$s][0]{name,price,nights,guests}', { id: packageId, s: stayId });
      if (!pkg) return L.send(res, 400, { error: "This package is not available." });
      nights = pkg.nights; amount = pkg.price; maxG = pkg.guests || 2;
    } else {
      nights = L.nightsBetween(checkIn, String(b.checkOut || ""));
      if (!(nights >= 1 && nights <= 30)) return L.send(res, 400, { error: "Choose valid dates." });
      amount = stay.price * nights; maxG = stay.maxGuests || 2;
    }
    amount = Math.round(amount);
    if (!(guests >= 1 && guests <= maxG)) return L.send(res, 400, { error: "Too many guests for this stay." });
    if (!(amount >= 1)) return L.send(res, 400, { error: "This stay has no price set." });
    if (Number(b.amount) !== amount) return L.send(res, 409, { error: "The price has changed. Please refresh the page and try again." });
    const checkOut = L.addDays(checkIn, nights);

    // Stop people spamming prompts to a phone number.
    const rl = await L.kv([["INCR", "rl:" + phone], ["EXPIRE", "rl:" + phone, 300]], true);
    if (rl[0] > 3) return L.send(res, 429, { error: "Too many attempts. Please wait a few minutes and try again." });

    // Hold each night so two guests cannot book the same dates. Holds last 10 minutes until paid.
    const ref = crypto.randomUUID();
    const keys = [];
    for (let i = 0; i < nights; i++) keys.push("occ:" + stayId + ":" + L.addDays(checkIn, i));
    const hold = await L.kv(keys.map((k) => ["SET", k, ref, "NX", "EX", 600]), true);
    if (hold.some((x) => x !== "OK")) {
      const mine = keys.filter((k, i) => hold[i] === "OK");
      if (mine.length) await L.kv(mine.map((k) => ["DEL", k]), true);
      return L.send(res, 409, { error: "Those dates were just taken. Please choose different dates." });
    }

    const booking = {
      ref, status: "pending", createdAt: new Date().toISOString(),
      stayId, stay: stay.name, packageId, package: pkg ? pkg.name : null,
      name, phone, amount, checkIn, checkOut, nights, guests,
      checkInTime: String(b.checkInTime || "").slice(0, 10), keys,
    };
    await L.kv(["SET", "bk:" + ref, JSON.stringify(booking), "EX", 2592000]);

    // Ask Safaricom to prompt the guest's phone (STK Push).
    const token = await L.mpesaToken();
    const ts = L.eat().toISOString().replace(/\D/g, "").slice(0, 14);
    const code = process.env.MPESA_SHORTCODE;
    const r = await fetch(L.MP + "/mpesa/stkpush/v1/processrequest", {
      method: "POST",
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: JSON.stringify({
        BusinessShortCode: code,
        Password: Buffer.from(code + process.env.MPESA_PASSKEY + ts).toString("base64"),
        Timestamp: ts,
        TransactionType: process.env.MPESA_TX_TYPE || "CustomerPayBillOnline",
        Amount: amount,
        PartyA: phone,
        PartyB: process.env.MPESA_PARTY_B || code,
        PhoneNumber: phone,
        CallBackURL: `${process.env.SITE_URL}/api/payment-hook?k=${process.env.CALLBACK_SECRET}&ref=${ref}`,
        AccountReference: "AirbnbStays",
        TransactionDesc: "Stay booking",
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (j.ResponseCode !== "0") {
      console.error("stk push failed", JSON.stringify(j));
      await L.fail(booking, "Mpesa could not send the prompt");
      return L.send(res, 502, { error: "Mpesa could not send the prompt. Check the number and try again." });
    }
    return L.send(res, 200, { ref });
  } catch (e) {
    console.error(e);
    return L.send(res, 500, { error: "Something went wrong. Please try again." });
  }
};
