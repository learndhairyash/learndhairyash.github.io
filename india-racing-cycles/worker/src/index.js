const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", ...headers } });

function cors(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.SITE_URL || "https://learndhairyash.github.io";
  const allowOrigin = origin === allowed ? origin : allowed;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}
const nowIso = () => new Date().toISOString();
const hex = (bytes) => [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, "0")).join("");
const randomToken = () => {
  const data = new Uint8Array(32);
  crypto.getRandomValues(data);
  return hex(data);
};
async function sha256(value) {
  return hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}
function validEmail(email) {
  return typeof email === "string" && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
function htmlPage(title, message) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px/1.6 Roboto,Arial,sans-serif;background:#f5f4fa;color:#1b1b24;padding:40px 18px"><main style="max-width:560px;margin:8vh auto;background:white;border-radius:24px;padding:32px;box-shadow:0 10px 35px #0001"><h1>${title}</h1><p>${message}</p><a href="${"https://learndhairyash.github.io/india-racing-cycles/"}">Return to India Racing Cycles</a></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
}
async function sendEmail(env, to, subject, html, textBody) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) throw new Error("Email service is not configured.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.FROM_EMAIL, to: [to], subject, html, text: textBody })
  });
  if (!response.ok) throw new Error(`Email provider returned ${response.status}.`);
  return response.json();
}
async function limitSignup(request, env, purpose = "signup") {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const key = await sha256(purpose + ":" + ip);
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const row = await env.DB.prepare("SELECT attempts, window_started_at FROM signup_attempts WHERE key_hash = ?").bind(key).first();
  if (!row || row.window_started_at < cutoff) {
    await env.DB.prepare("INSERT INTO signup_attempts (key_hash, attempts, window_started_at) VALUES (?, 1, ?) ON CONFLICT(key_hash) DO UPDATE SET attempts=1, window_started_at=excluded.window_started_at").bind(key, nowIso()).run();
    return true;
  }
  if (row.attempts >= 5) return false;
  await env.DB.prepare("UPDATE signup_attempts SET attempts = attempts + 1 WHERE key_hash = ?").bind(key).run();
  return true;
}
async function handleSubscribe(request, env) {
  const body = await request.json().catch(() => ({}));
  if (body.website) return json({ ok: true });
  const email = String(body.email || "").trim().toLowerCase();
  if (!validEmail(email)) return json({ error: "Please enter a valid email address." }, 400);
  if (!await limitSignup(request, env)) return json({ error: "Too many attempts. Please try again later." }, 429);

  const confirmToken = randomToken();
  const unsubscribeToken = randomToken();
  const confirmHash = await sha256(confirmToken);
  const unsubscribeHash = await sha256(unsubscribeToken);
  const created = nowIso();
  await env.DB.prepare(`INSERT INTO subscribers (email,status,confirm_token_hash,unsubscribe_token_hash,created_at)
    VALUES (?, 'pending', ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      status=CASE WHEN subscribers.status='active' THEN 'active' ELSE 'pending' END,
      confirm_token_hash=CASE WHEN subscribers.status='active' THEN subscribers.confirm_token_hash ELSE excluded.confirm_token_hash END,
      unsubscribe_token_hash=excluded.unsubscribe_token_hash,
      created_at=CASE WHEN subscribers.status='active' THEN subscribers.created_at ELSE excluded.created_at END,
      unsubscribed_at=NULL`).bind(email, confirmHash, unsubscribeHash, created).run();

  const row = await env.DB.prepare("SELECT status FROM subscribers WHERE email = ?").bind(email).first();
  if (row?.status === "active") return json({ ok: true, message: "This address is already subscribed." });
  const confirmUrl = `${env.WORKER_URL || new URL(request.url).origin}/api/confirm?token=${confirmToken}`;
  const html = `<div style="font:16px/1.6 Arial,sans-serif;color:#202124"><h2>Confirm your India Racing Cycles subscription</h2><p>Click the link below to confirm that you want to receive cycling event announcements and important updates.</p><p><a href="${confirmUrl}">Confirm my subscription</a></p><p>If you did not request this, ignore this email. No subscription will be activated.</p></div>`;
  await sendEmail(env, email, "Confirm your India Racing Cycles subscription", html, `Confirm your subscription: ${confirmUrl}\nIf you did not request this, ignore this email.`);
  return json({ ok: true, message: "Confirmation email sent. Your subscription is pending until confirmed." }, 202);
}
async function handleConfirm(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!token || token.length > 128) return htmlPage("Invalid link", "This confirmation link is not valid. Please sign up again.");
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT email FROM subscribers WHERE confirm_token_hash = ? AND status = 'pending'").bind(hash).first();
  if (!row) return htmlPage("Link expired", "This confirmation link was already used or has expired. Please sign up again.");
  await env.DB.prepare("UPDATE subscribers SET status='active', confirmed_at=?, confirm_token_hash=NULL WHERE email=?").bind(nowIso(), row.email).run();
  return htmlPage("You're subscribed", "Your email address is confirmed. You will receive India Racing Cycles updates. You can unsubscribe from any newsletter email.");
}
async function handleUnsubscribe(url, env) {
  const token = url.searchParams.get("token") || "";
  if (!token || token.length > 128) return htmlPage("Invalid link", "This unsubscribe link is not valid.");
  const hash = await sha256(token);
  const row = await env.DB.prepare("SELECT email FROM subscribers WHERE unsubscribe_token_hash = ?").bind(hash).first();
  if (!row) return htmlPage("Link not found", "This unsubscribe link is invalid or has already been used.");
  await env.DB.prepare("UPDATE subscribers SET status='unsubscribed', unsubscribed_at=?, confirm_token_hash=NULL WHERE email=?").bind(nowIso(), row.email).run();
  return htmlPage("Unsubscribed", "You have been removed from India Racing Cycles email updates.");
}

function cleanText(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}
function publicUrl(value) {
  const raw = cleanText(value, 1000);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["https:", "http:"].includes(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[character]));
}
async function handleEventSuggestion(request, env) {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return json({ error: "Please send the event information again." }, 400);
  // Honeypot: bots receive a generic success response; no data is stored.
  if (body.website) return json({ ok: true }, 202);
  if (!await limitSignup(request, env, "event-suggestion")) {
    return json({ error: "Too many submissions from this connection. Please try again later." }, 429);
  }

  const sourceUrl = publicUrl(body.source_url);
  const posterUrl = publicUrl(body.poster_url);
  if (sourceUrl === null || posterUrl === null) {
    return json({ error: "Please use a valid public web link beginning with http:// or https://." }, 400);
  }
  const email = cleanText(body.contributor_email, 254).toLowerCase();
  const organiserEmail = cleanText(body.organiser_email, 254).toLowerCase();
  if (email && !validEmail(email)) return json({ error: "Please check the optional email address." }, 400);
  if (organiserEmail && !validEmail(organiserEmail)) return json({ error: "Please check the organiser email address." }, 400);

  const payload = {
    event_name: cleanText(body.event_name, 180),
    source_url: sourceUrl,
    source_platform: cleanText(body.source_platform, 60),
    event_date: cleanText(body.event_date, 10),
    event_date_end: cleanText(body.event_date_end, 10),
    location: cleanText(body.location, 180),
    category: cleanText(body.category, 80),
    organiser: cleanText(body.organiser, 180),
    organiser_phone: cleanText(body.organiser_phone, 40),
    organiser_email: organiserEmail,
    poster_url: posterUrl,
    details: cleanText(body.details, 5000),
    contributor_name: cleanText(body.contributor_name, 100),
    contributor_email: email
  };
  for (const key of ["event_date", "event_date_end"]) {
    if (payload[key] && !/^\d{4}-\d{2}-\d{2}$/.test(payload[key])) {
      return json({ error: "Please enter valid event dates, or leave the date fields blank." }, 400);
    }
  }
  if (payload.event_date && payload.event_date_end && payload.event_date_end < payload.event_date) {
    return json({ error: "The event end date cannot be before its start date." }, 400);
  }
  const useful = ["event_name", "source_url", "event_date", "event_date_end", "location", "category", "organiser", "organiser_phone", "organiser_email", "poster_url", "details"];
  if (!useful.some(key => payload[key])) {
    return json({ error: "Please share at least one event detail or source link." }, 400);
  }

  const id = crypto.randomUUID();
  const timestamp = nowIso();
  await env.DB.prepare(
    "INSERT INTO event_suggestions (id,status,payload_json,created_at,updated_at) VALUES (?,'pending',?,?,?)"
  ).bind(id, JSON.stringify(payload), timestamp, timestamp).run();

  // Optional email alert. Failure does not undo the stored suggestion.
  let notificationSent = false;
  if (env.ADMIN_EMAIL && env.RESEND_API_KEY && env.FROM_EMAIL) {
    const lines = Object.entries(payload)
      .filter(([, value]) => value)
      .map(([key, value]) => "<p><strong>" + escapeHtml(key.replaceAll("_", " ")) + ":</strong> " + escapeHtml(value) + "</p>")
      .join("");
    const html = "<div style=\"font:15px/1.6 Arial,sans-serif\"><h2>New India Racing Cycles event suggestion</h2><p>Suggestion ID: " + escapeHtml(id) + "</p><p>Status: Pending manual review</p>" + lines + "</div>";
    const textBody = "New suggestion " + id + "\n\n" + Object.entries(payload).filter(([,value])=>value).map(([key,value])=>key + ": " + value).join("\n");
    try {
      await sendEmail(env, env.ADMIN_EMAIL, "New cycling event suggestion — manual review needed", html, textBody);
      notificationSent = true;
    } catch (error) {
      console.error("Suggestion stored, but admin notification failed:", error);
    }
  }
  return json({ ok: true, id, status: "pending", notificationSent }, 202);
}

function isAdmin(request, env) {
  return Boolean(env.ADMIN_API_TOKEN) &&
    request.headers.get("Authorization") === "Bearer " + env.ADMIN_API_TOKEN;
}
async function handleAdminSuggestions(request, url, env) {
  if (!isAdmin(request, env)) return json({ error: "Unauthorized." }, 401);
  if (request.method === "GET" && url.pathname === "/api/admin/event-suggestions") {
    const status = cleanText(url.searchParams.get("status") || "pending", 20);
    if (!["pending", "reviewed", "added", "rejected", "all"].includes(status)) {
      return json({ error: "Unknown status filter." }, 400);
    }
    const result = status === "all"
      ? await env.DB.prepare("SELECT * FROM event_suggestions ORDER BY created_at DESC LIMIT 200").all()
      : await env.DB.prepare("SELECT * FROM event_suggestions WHERE status=? ORDER BY created_at DESC LIMIT 200").bind(status).all();
    return json({
      suggestions: (result.results || []).map(row => ({
        id: row.id, status: row.status, created_at: row.created_at,
        updated_at: row.updated_at, review_note: row.review_note,
        ...JSON.parse(row.payload_json)
      }))
    });
  }
  if (request.method === "PATCH") {
    const match = url.pathname.match(/^\/api\/admin\/event-suggestions\/([a-f0-9-]{36})$/i);
    if (!match) return json({ error: "Invalid suggestion ID." }, 400);
    const body = await request.json().catch(() => ({}));
    const status = cleanText(body.status, 20);
    if (!["reviewed", "added", "rejected"].includes(status)) {
      return json({ error: "Status must be reviewed, added or rejected." }, 400);
    }
    const note = cleanText(body.review_note, 1000);
    const result = await env.DB.prepare(
      "UPDATE event_suggestions SET status=?, updated_at=?, review_note=? WHERE id=?"
    ).bind(status, nowIso(), note, match[1]).run();
    if (!result.meta?.changes) return json({ error: "Suggestion not found." }, 404);
    return json({ ok: true, id: match[1], status });
  }
  return json({ error: "Method not allowed." }, 405);
}

async function handleNewsletter(request, env) {
  if (!env.ADMIN_API_TOKEN || request.headers.get("Authorization") !== `Bearer ${env.ADMIN_API_TOKEN}`) return json({ error: "Unauthorized." }, 401);
  const body = await request.json().catch(() => ({}));
  const subject = String(body.subject || "").trim().slice(0, 180);
  const html = String(body.html || "");
  const textBody = String(body.text || "");
  if (!subject || (!html && !textBody) || html.length > 50000 || textBody.length > 20000) return json({ error: "Provide a subject and email content within the size limits." }, 400);
  const subscribers = await env.DB.prepare("SELECT email, unsubscribe_token_hash FROM subscribers WHERE status='active' ORDER BY created_at").all();
  let sent = 0, failed = 0;
  for (const subscriber of subscribers.results || []) {
    try {
      const token = randomToken();
      const tokenHash = await sha256(token);
      await env.DB.prepare("UPDATE subscribers SET unsubscribe_token_hash=? WHERE email=?").bind(tokenHash, subscriber.email).run();
      const unsubscribeUrl = `${env.WORKER_URL || new URL(request.url).origin}/api/unsubscribe?token=${token}`;
      const finalHtml = `${html}<hr><p style="font:12px Arial;color:#666">You received this because you confirmed your subscription to India Racing Cycles. <a href="${unsubscribeUrl}">Unsubscribe</a>.</p>`;
      const finalText = `${textBody}\n\nUnsubscribe: ${unsubscribeUrl}`;
      await sendEmail(env, subscriber.email, subject, finalHtml, finalText);
      sent++;
    } catch (e) { failed++; }
  }
  await env.DB.prepare("INSERT INTO newsletter_log (subject,sent_count,failed_count,sent_at) VALUES (?,?,?,?)").bind(subject,sent,failed,nowIso()).run();
  return json({ ok: true, sent, failed, recipients: (subscribers.results || []).length });
}
async function handle(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request, env) });
  if (url.pathname === "/health" && request.method === "GET") return json({ ok: true, service: "india-racing-cycles-api", time: nowIso() }, 200, cors(request, env));
  if (url.pathname === "/api/events" && request.method === "GET") {
    const status = url.searchParams.get("status");
    const rows = status ? await env.DB.prepare("SELECT payload_json FROM events WHERE status=? ORDER BY start_date").bind(status).all() : await env.DB.prepare("SELECT payload_json FROM events ORDER BY start_date").all();
    return json({ events: (rows.results || []).map(r => JSON.parse(r.payload_json)) }, 200, cors(request, env));
  }
  if (url.pathname === "/api/news" && request.method === "GET") {
    const rows = await env.DB.prepare("SELECT payload_json FROM news ORDER BY published_at DESC LIMIT 100").all();
    return json({ news: (rows.results || []).map(r => JSON.parse(r.payload_json)) }, 200, cors(request, env));
  }
  if (url.pathname === "/api/event-suggestions" && request.method === "POST") {
    try { return await handleEventSuggestion(request, env); }
    catch (e) { console.error("Event suggestion failed:", e); return json({ error: "The suggestion could not be stored. Please try again later." }, 502); }
  }
  if (url.pathname === "/api/admin/event-suggestions" || url.pathname.startsWith("/api/admin/event-suggestions/")) {
    try { return await handleAdminSuggestions(request, url, env); }
    catch (e) { console.error("Admin suggestion operation failed:", e); return json({ error: "Could not process the review request." }, 502); }
  }
  if (url.pathname === "/api/subscribe" && request.method === "POST") {
    try { return await handleSubscribe(request, env); }
    catch (e) { return json({ error: "Subscription could not be processed. Please try again later." }, 502); }
  }
  if (url.pathname === "/api/confirm" && request.method === "GET") {
    try { return await handleConfirm(url, env); }
    catch (e) { return htmlPage("Confirmation unavailable", "Please contact the site administrator or try again later."); }
  }
  if (url.pathname === "/api/unsubscribe" && request.method === "GET") {
    try { return await handleUnsubscribe(url, env); }
    catch (e) { return htmlPage("Unsubscribe unavailable", "Please try again later."); }
  }
  if (url.pathname === "/api/admin/newsletter" && request.method === "POST") {
    try { return await handleNewsletter(request, env); }
    catch (e) { return json({ error: "Newsletter could not be sent." }, 502); }
  }
  return json({ error: "Not found." }, 404, cors(request, env));
}
export default {
  fetch(request, env) {
    return handle(request, env).then(response => {
      const headers = new Headers(response.headers);
      const cross = cors(request, env);
      Object.entries(cross).forEach(([k,v]) => headers.set(k,v));
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    });
  }
};