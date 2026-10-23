// Cloudflare Pages Function — drop this file at functions/api/fill-card.js in the
// setter-cih Pages project. It becomes POST https://setter-cih.pages.dev/api/fill-card
//
// Env vars to set in Pages → Settings → Environment variables (Production + Preview):
//   ANTHROPIC_API_KEY      sk-ant-...
//   GOOGLE_PLACES_API_KEY  key with "Places API (New)" enabled
//
// Request:  { "transcript": "...full Wav Dialer transcript text..." }
// Response: { card: "...filled card text...", fields: {...}, gbp: [ {name, address, maps_url, website, rating, reviews} ] }

const CARD_TOOL = {
  name: "fill_prospect_card",
  description:
    "Extract the Clutch Clicks prospect card from a setter call transcript with an auto shop owner. Use only what was actually said. If something was not mentioned, write 'Not mentioned'. Never guess.",
  input_schema: {
    type: "object",
    properties: {
      shop_name: { type: "string", description: "Business name as the owner says it" },
      city: { type: "string" },
      state: { type: "string", description: "Two-letter state code if known" },
      address_hint: {
        type: "string",
        description: "Any street, road, intersection or landmark mentioned. Empty string if none.",
      },
      services: {
        type: "string",
        description: "Comma list, e.g. 'Collision, paint, window tint'. Use the owner's own words.",
      },
      avg_ticket: {
        type: "string",
        description: "Dollar figure or range the owner gave, e.g. '$800-$1k'. 'Not mentioned' if none.",
      },
      systems: {
        type: "string",
        description: "Shop management software: ShopMonkey / Tekmetric / Mitchell / CCC / None / Not mentioned",
      },
      website: {
        type: "string",
        description: "Vendor name / None / Locked in contract (with who and how long) / Not mentioned",
      },
      missed_calls: {
        type: "string",
        enum: ["Yes", "No", "Not mentioned"],
        description: "Did the owner admit to missing calls or not being able to answer the phone?",
      },
      review_system: {
        type: "string",
        description: "None / Asking customers / Automated (name it) / Not mentioned",
      },
      lead_flow: {
        type: "string",
        description: "Very busy / Steady / Little flow / None — plus a few words of why, in the owner's words",
      },
      marketing: {
        type: "string",
        description: "What they do now (ads, DRP, word of mouth, nothing) + the pain point they voiced. One line.",
      },
      key_note: {
        type: "string",
        description:
          "1-2 sentences: the main pain or hook. Quote the owner where possible. This is what the closer reads first.",
      },
      appointment: {
        type: "string",
        description: "Day/time the demo was set for, and who is attending. 'Not mentioned' if unclear.",
      },
      owner_name: { type: "string", description: "Decision maker's first name" },
    },
    required: [
      "shop_name", "city", "state", "address_hint", "services", "avg_ticket", "systems",
      "website", "missed_calls", "review_system", "lead_flow", "marketing", "key_note",
      "appointment", "owner_name",
    ],
  },
};

const SYSTEM = `You fill out prospect cards for Clutch Clicks setters. Clutch Clicks sells a $297/mo Smart Website System and $500 GBP optimization to auto shops (collision, mechanical, tire, tint, transmission, etc.).
The transcript is a cold/warm call between a setter and a shop owner. Extract only what the OWNER actually said. Do not infer missed calls, ticket size, or systems from the setter's pitch — only from the owner's answers. If the owner dodged a question, write 'Not mentioned'. Keep every field short. The closer reads this in 20 seconds before the demo.`;

async function extractCard(transcript, apiKey) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5-5",
      max_tokens: 1500,
      system: SYSTEM,
      tools: [CARD_TOOL],
      tool_choice: { type: "tool", name: "fill_prospect_card" },
      messages: [{ role: "user", content: `TRANSCRIPT:\n\n${transcript}` }],
    }),
  });
  if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const toolUse = data.content.find((b) => b.type === "tool_use");
  if (!toolUse) throw new Error("No tool_use block returned");
  return toolUse.input;
}

async function findGbp(fields, apiKey) {
  if (!apiKey) return [];
  const q = [fields.shop_name, fields.address_hint, fields.city, fields.state]
    .filter((s) => s && s !== "Not mentioned")
    .join(" ");
  if (!q.trim()) return [];
  const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask":
        "places.id,places.displayName,places.formattedAddress,places.websiteUri,places.googleMapsUri,places.rating,places.userRatingCount,places.nationalPhoneNumber",
    },
    body: JSON.stringify({ textQuery: q, maxResultCount: 3 }),
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.places || []).map((p) => ({
    name: p.displayName?.text || "",
    address: p.formattedAddress || "",
    maps_url: p.googleMapsUri || "",
    website: p.websiteUri || "",
    phone: p.nationalPhoneNumber || "",
    rating: p.rating ?? null,
    reviews: p.userRatingCount ?? 0,
  }));
}

function buildCard(f, gbp) {
  const top = gbp[0];
  const gbpLine = top
    ? `${top.maps_url}${top.rating ? `  (${top.rating}★ / ${top.reviews} reviews)` : ""}`
    : "Not found — search manually";
  const websiteLine =
    top?.website && f.website === "Not mentioned"
      ? `${top.website} (from GBP — vendor not discussed)`
      : f.website + (top?.website ? `  |  live site: ${top.website}` : "");
  return [
    `Shop: ${f.shop_name}${f.owner_name && f.owner_name !== "Not mentioned" ? ` (owner: ${f.owner_name})` : ""}`,
    `Location: ${f.city}, ${f.state}${top?.address ? `  —  ${top.address}` : ""}`,
    `GMB: ${gbpLine}`,
    `Services: ${f.services}`,
    `Avg. Ticket: ${f.avg_ticket}`,
    `Systems They Use: ${f.systems}`,
    `Website: ${websiteLine}`,
    `Missed Calls: ${f.missed_calls}`,
    `Google Review System: ${f.review_system}`,
    `Lead Flow: ${f.lead_flow}`,
    `Marketing: ${f.marketing}`,
    `Key note: ${f.key_note}`,
    `Appt: ${f.appointment}`,
  ].join("\n");
}

export async function onRequestPost({ request, env }) {
  try {
    const { transcript } = await request.json();
    if (!transcript || transcript.trim().length < 50) {
      return json({ error: "Paste the full transcript first." }, 400);
    }
    const fields = await extractCard(transcript.slice(0, 120_000), env.ANTHROPIC_API_KEY);
    const gbp = await findGbp(fields, env.GOOGLE_PLACES_API_KEY);
    return json({ card: buildCard(fields, gbp), fields, gbp });
  } catch (e) {
    return json({ error: String(e.message || e) }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { headers: corsHeaders() });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
  };
}
