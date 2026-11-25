// Netlify Function til "Glemt adgangskode?" på både /elev og /laerer.
//
// Genererer et nulstillingslink via Supabase Admin Auth og sender det med
// Resend fra samme verificerede afsender som invitationerne — i stedet for
// Supabases egen indbyggede mail, som på gratisplanen kun leverer til
// projektets egne teammedlemmer og derfor ikke ville nå eleverne.
//
// Svarer ALTID {ok:true} når anmodningen er gyldig, uanset om mailadressen
// findes — så siden ikke kan bruges til at finde ud af hvem der har en konto.
//
// Linket lander på /elev/ (den adresse der er godkendt i Supabase →
// Authentication → URL Configuration). Er det læreren, sender /elev/ videre
// til /laerer/, når den nye adgangskode er valgt.
//
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY og RESEND_API_KEY sættes som
// miljøvariabler i Netlify — de står IKKE i koden.

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceKey || !resendKey) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY eller RESEND_API_KEY mangler.");
    return Response.json({ ok: false, error: "Serverkonfiguration mangler." }, { status: 500 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Ugyldig JSON." }, { status: 400 });
  }

  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ ok: false, error: "Ugyldig mailadresse." }, { status: 400 });
  }

  try {
    const linkRes = await fetch(`${supabaseUrl}/auth/v1/admin/generate_link`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "recovery",
        email,
        options: { redirectTo: "https://olleslillemusikskole.dk/elev/" },
      }),
    });
    const linkData = await linkRes.json().catch(() => ({}));
    if (!linkRes.ok || !linkData?.action_link) {
      // Typisk: der findes ingen bruger med den mail. Ikke en fejl udadtil.
      console.log("Intet nulstillingslink genereret:", linkRes.status);
      return Response.json({ ok: true });
    }

    const mailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Olles musikskole <noreply@olleslillemusikskole.dk>",
        to: email,
        subject: "Vælg en ny adgangskode",
        html:
          `<div style="font-family: system-ui, sans-serif, Arial; font-size: 16px">` +
          `<p>Hej!</p>` +
          `<p>Nogen (forhåbentlig dig) har bedt om at nulstille adgangskoden til din side hos Olles lille musikskole.</p>` +
          `<p><a href="${linkData.action_link}">Tryk her for at vælge en ny adgangskode</a></p>` +
          `<p>Har du ikke bedt om det, kan du bare se bort fra denne mail — din nuværende adgangskode virker stadig.</p>` +
          `<p>Mange hilsner,<br />Olle</p>` +
          `</div>`,
      }),
    });
    if (!mailRes.ok) {
      console.error("Resend fejl:", mailRes.status, await mailRes.text());
      return Response.json({ ok: false, error: "Kunne ikke sende mail." }, { status: 502 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error("Fejl ved nulstilling af adgangskode:", err);
    return Response.json({ ok: false, error: "Uventet fejl." }, { status: 500 });
  }
};

export const config = {
  path: "/api/request-password-reset",
};
