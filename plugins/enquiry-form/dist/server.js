"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: !0 });
}, __copyProps = (to, from, except, desc) => {
  if (from && typeof from == "object" || typeof from == "function")
    for (let key of __getOwnPropNames(from))
      !__hasOwnProp.call(to, key) && key !== except && __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: !0 }), mod);

// src/server.ts
var server_exports = {};
__export(server_exports, {
  default: () => server_default
});
module.exports = __toCommonJS(server_exports);

// ../../packages/plugin/dist/server.js
function adminOnly(handler) {
  return (ctx) => ctx.admin ? handler(ctx) : json({ error: "Sign in to the dashboard to do this." }, 401);
}
function json(body, status = 200, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
  });
}
async function readJson(request, maxBytes = 1e5) {
  try {
    let text2 = await request.text();
    return text2.length > maxBytes ? null : JSON.parse(text2);
  } catch {
    return null;
  }
}

// src/server.ts
var PREFIX = "enquiry/", EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, recent = /* @__PURE__ */ new Map();
function tooMany(request) {
  let who = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown", now = Date.now(), times = (recent.get(who) ?? []).filter((t) => now - t < 6e4);
  return times.push(now), recent.set(who, times), recent.size > 5e3 && recent.clear(), times.length > 5;
}
var text = (value, max) => typeof value == "string" ? value.trim().slice(0, max) : "", server_default = {
  pages: {
    form: ({ config }) => ({
      metadata: { title: config.heading, description: config.intro?.slice(0, 160) }
    })
  },
  api: {
    // Public: a visitor submits the form.
    "POST /enquiries": async ({ request, config, storage, log }) => {
      if (tooMany(request)) return json({ error: "Too many enquiries from this connection. Please try again in a minute." }, 429);
      let body = await readJson(request, 2e4);
      if (!body) return json({ error: "We could not read your enquiry. Please try again." }, 400);
      if (text(body.company, 200)) return json({ ok: !0 });
      let name = text(body.name, 120), email = text(body.email, 200), phone = config.askPhone ? text(body.phone, 40) : "", message = text(body.message, 4e3), fields = {};
      if (name || (fields.name = "Please tell us your name."), EMAIL.test(email) || (fields.email = "Please enter a valid email address."), phone && !/^[0-9+()\-\s.]{6,}$/.test(phone) && (fields.phone = "Please enter a valid phone number."), config.requireMessage && !message && (fields.message = "Please tell us how we can help."), Object.keys(fields).length) return json({ error: "Please check the highlighted fields.", fields }, 422);
      let receivedAt = (/* @__PURE__ */ new Date()).toISOString(), id = `${receivedAt.replace(/[:.]/g, "-")}-${Math.random().toString(36).slice(2, 8)}`, enquiry = { id, name, email, phone: phone || void 0, message: message || void 0, page: text(body.page, 300) || void 0, receivedAt, handled: !1 };
      if (await storage.set(PREFIX + id, enquiry), config.webhookUrl)
        try {
          await fetch(config.webhookUrl, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: `New enquiry from ${name} <${email}>${phone ? `, ${phone}` : ""}${message ? `
${message}` : ""}`, enquiry }),
            signal: AbortSignal.timeout(4e3)
          });
        } catch (e) {
          log("Could not deliver the notification webhook:", e.message);
        }
      return json({ ok: !0 });
    },
    // Dashboard only: the inbox.
    "GET /enquiries": adminOnly(async ({ storage }) => {
      let keys = (await storage.list(PREFIX)).reverse().slice(0, 200), items = (await Promise.all(keys.map((k) => storage.get(k)))).filter((e) => e !== null);
      return json({ enquiries: items, total: keys.length });
    }),
    "PATCH /enquiries/:id": adminOnly(async ({ request, params, storage }) => {
      let key = PREFIX + params.id, enquiry = await storage.get(key);
      if (!enquiry) return json({ error: "That enquiry no longer exists." }, 404);
      let body = await readJson(request);
      return enquiry.handled = body?.handled === !0, await storage.set(key, enquiry), json({ enquiry });
    }),
    "DELETE /enquiries/:id": adminOnly(async ({ params, storage }) => (await storage.delete(PREFIX + params.id), json({ ok: !0 })))
  }
};
