// Netlify Function der (kun for læreren) sender en mail til en elev med et
// link, hvor eleven selv vælger sit kodeord og dermed aktiverer sin konto.
// Kaldes KUN når læreren aktivt trykker "Send invitation"/"Send igen" i
// /laerer — aldrig automatisk når kontoen oprettes (se
// create-student-account.mts).
//
// SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY og RESEND_API_KEY sættes som
// miljøvariabler i Netlify — de står IKKE i koden. SUPABASE_ANON_KEY er ikke
// hemmelig og bruges kun til at bekræfte lærerens session-token.
//
// OBS: for at selve linket skal virke, skal olleslillemusikskole.dk stå i
// Supabase-projektets Authentication → URL Configuration (Site URL +
// Redirect URLs) — det er ikke noget der kan sættes via denne funktion eller
// via SQL, kun i Supabase-dashboardet.

const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im96dHp4cnhmd3Z2Y2NycXpoaXJ5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODczNDc0NzYsImV4cCI6MjEwMjkyMzQ3Nn0.ar7EL8jIwYAhFzKIYyXwnANbRfy8iUOlP5Vo2C0rlmM";

async function verifyTeacher(req: Request, supabaseUrl: string, serviceKey: string): Promise<boolean> {
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
  });
  if (!userRes.ok) return false;
  const user = await userRes.json();
  if (!user?.id) return false;

  const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${user.id}&select=role`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  if (!profRes.ok) return false;
  const rows = await profRes.json();
  return Array.isArray(rows) && rows[0]?.role === "laerer";
}

export default async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Netlify.env.get("RESEND_API_KEY");
  if (!supabaseUrl || !serviceKey || !resendKey) {
    console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY eller RESEND_API_KEY mangler.");
    return new Response(JSON.stringify({ ok: false, error: "Serverkonfiguration mangler." }), { status: 200 });
  }

  let isTeacher = false;
  try {
    isTeacher = await verifyTeacher(req, supabaseUrl, serviceKey);
  } catch (err) {
    console.error("Kunne ikke bekræfte lærersession:", err);
  }
  if (!isTeacher) {
    return new Response(JSON.stringify({ ok: false, error: "Ikke tilladt." }), { status: 403 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Ugyldig JSON." }), { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const studentId = typeof body.student_id === "string" ? body.student_id : "";
  if (!email || !studentId) {
    return new Response(JSON.stringify({ ok: false, error: "Mail eller elev-id mangler." }), { status: 400 });
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
      console.error("Kunne ikke generere invitationslink:", linkRes.status, linkData);
      return new Response(JSON.stringify({ ok: false, error: "Kunne ikke generere invitationslink." }), { status: 200 });
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
        subject: "Din konto er klar — vælg din adgangskode",
        html:
          `<div style="font-family: system-ui, sans-serif, Arial; font-size: 16px">` +
          `<p>Hej${name ? " " + name : ""}!</p>` +
          `<p>Du har nu fået din egen side hos Olles lille musikskole, hvor du kan se din faste tid, noter fra timerne og materiale Olle deler med dig.</p>` +
          `<p><a href="${linkData.action_link}">Tryk her for at vælge din adgangskode</a></p>` +
          `<p>Mange hilsner,<br />Olle</p>` +
          `</div>`,
      }),
    });
    if (!mailRes.ok) {
      console.error("Resend fejl:", mailRes.status, await mailRes.text());
      return new Response(JSON.stringify({ ok: false, error: "Kunne ikke sende mail." }), { status: 200 });
    }

    // Marker hvornår invitationen blev sendt, så læreren kan se det i /laerer.
    // Fejler dette, skal det ikke fremstå som at hele invitationen fejlede —
    // mailen er jo allerede sendt på dette tidspunkt.
    //
    // OBS (2026-08-23): kan ikke længere bare slå op på profiles.student_id —
    // siden søskende kan dele ét login (account_students), er den kolonne kun
    // den "primære" elev for kontoen. Slår derfor koblingen op via
    // account_students i stedet, så invited_at også opdateres korrekt for en
    // elev der deler login med en søskende.
    try {
      const linkRes = await fetch(`${supabaseUrl}/rest/v1/account_students?student_id=eq.${studentId}&select=profile_id`, {
        headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
      });
      const links = await linkRes.json().catch(() => []);
      const profileId = Array.isArray(links) && links[0]?.profile_id;
      if (profileId) {
        await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${profileId}`, {
          method: "PATCH",
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify({ invited_at: new Date().toISOString() }),
        });
      }
    } catch (err) {
      console.error("Kunne ikke opdatere invited_at:", err);
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("Fejl ved afsendelse af invitation:", err);
    return new Response(JSON.stringify({ ok: false, error: "Uventet fejl." }), { status: 200 });
  }
};

export const config = {
  path: "/api/send-account-invite",
};
