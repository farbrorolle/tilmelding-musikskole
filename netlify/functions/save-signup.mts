// Netlify Function der gemmer tilmeldinger i Supabase (tabellen waitlist_signups).
// Kaldes fra index.html efter en tilmelding, som et ekstra skridt ved siden af
// den eksisterende Netlify Forms-indsendelse (som fortsat er den, der udløser
// bekræftelsesmailen via netlify/functions/on-form-submit.mts).
//
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY sættes som miljøvariabler i
// Netlify (Site settings → Environment variables) — de står IKKE i koden.
// service_role-nøglen bruges kun her, server-side, og omgår med vilje Row
// Level Security: tabellen har ingen policies, så det er kun denne funktion,
// der kan skrive til den. Den offentlige side kender kun denne funktions-URL,
// aldrig selve nøglen.

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response("Ugyldig JSON", { status: 400 });
  }

  // Honeypot-felt fra formularen — hvis det er udfyldt, er det med stor
  // sandsynlighed en bot. Vi svarer ok, men gemmer ikke noget.
  if (body["bot-field"]) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  const navn = typeof body.navn === "string" ? body.navn.trim() : "";
  const email = typeof body.email === "string" ? body.email.trim() : "";
  if (!navn || !email) {
    return new Response("Navn og email er påkrævet", { status: 400 });
  }

  const alderNum = Number(body.alder);
  const alder = Number.isFinite(alderNum) ? alderNum : null;
  const telefon = typeof body.telefon === "string" ? body.telefon.trim() || null : null;
  const instrument = typeof body.instrument === "string" ? body.instrument.trim() || null : null;
  const tidspunkter = Array.isArray(body.tidspunkter)
    ? body.tidspunkter.filter((t: unknown) => typeof t === "string")
    : [];
  const andetTidspunkt =
    typeof body.andet_tidspunkt === "string" ? body.andet_tidspunkt.trim() || null : null;
  const kommentar = typeof body.kommentar === "string" ? body.kommentar.trim() || null : null;

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler — kan ikke gemme i Supabase.");
    // Svarer stadig ok — den vigtige Netlify Forms-indsendelse er allerede sket,
    // så en manglende Supabase-nøgle skal ikke fremstå som en fejl for brugeren.
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/waitlist_signups`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        navn,
        alder,
        email,
        telefon,
        instrument,
        tidspunkter,
        andet_tidspunkt: andetTidspunkt,
        kommentar,
      }),
    });

    if (!res.ok) {
      console.error("Supabase-fejl:", res.status, await res.text());
      return new Response(JSON.stringify({ ok: false }), { status: 200 });
    }
  } catch (err) {
    console.error("Kunne ikke gemme tilmelding i Supabase:", err);
    return new Response(JSON.stringify({ ok: false }), { status: 200 });
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};

export const config = {
  path: "/api/save-signup",
};
