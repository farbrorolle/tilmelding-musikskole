// Netlify Function der (kun for læreren) opretter en dvale-konto for en elev
// ud fra deres mailadresse — uden kodeord, og uden at der sendes nogen mail.
// Kontoen aktiveres først når læreren selv vælger at sende en invitation via
// /api/send-account-invite ("når jeg vælger at det skal komme online").
//
// SUPABASE_URL og SUPABASE_SERVICE_ROLE_KEY sættes som miljøvariabler i
// Netlify (Site settings → Environment variables) — de står IKKE i koden.
// SUPABASE_ANON_KEY nedenfor er IKKE hemmelig (den ligger allerede synligt i
// /laerer og /elev's kildekode) — den bruges her udelukkende til at slå
// lærerens session-token op og bekræfte hvem der rent faktisk er logget ind,
// inden vi opretter noget.

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
  if (!supabaseUrl || !serviceKey) {
    console.error("SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler.");
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
  if (!email) {
    return new Response(JSON.stringify({ ok: false, error: "Mailadresse mangler." }), { status: 400 });
  }
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : undefined;
  const phone = typeof body.phone === "string" && body.phone.trim() ? body.phone.trim() : undefined;
  const instrument = typeof body.instrument === "string" && body.instrument.trim() ? body.instrument.trim() : undefined;
  // OBS (2026-08-23): siden students.email ikke længere er unik (søskende må
  // gerne dele mailadresse — se migrationen "multi_student_accounts"), skal
  // vi eksplicit fortælle databasetriggeren handle_new_user() hvilken
  // students-række denne konto hører til. Uden dette ville et nyt login for
  // en allerede oprettet elev fejlagtigt oprette en helt ny, tom elevrække.
  const studentId = typeof body.student_id === "string" && body.student_id.trim() ? body.student_id.trim() : undefined;

  try {
    const res = await fetch(`${supabaseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        email_confirm: true,
        user_metadata: { name, phone, instrument_onske: instrument, student_id: studentId },
      }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const msg = typeof data?.msg === "string" ? data.msg : typeof data?.message === "string" ? data.message : "";
      // Mailen har allerede en konto — typisk fordi en søskende med samme
      // mailadresse allerede har fået oprettet login. I stedet for bare at
      // melde "findes allerede" og ikke gøre mere (som tidligere), kobles
      // denne elev nu direkte ind på den eksisterende konto via
      // account_students, så familien kan se begge/alle børn med samme login.
      if (res.status === 422 || res.status === 400 || /already.*registered/i.test(msg)) {
        if (studentId) {
          try {
            const profRes = await fetch(`${supabaseUrl}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id`, {
              headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
            });
            const profRows = await profRes.json().catch(() => []);
            const existingProfileId = Array.isArray(profRows) && profRows[0]?.id;
            if (existingProfileId) {
              await fetch(`${supabaseUrl}/rest/v1/account_students`, {
                method: "POST",
                headers: {
                  apikey: serviceKey,
                  Authorization: `Bearer ${serviceKey}`,
                  "Content-Type": "application/json",
                  Prefer: "resolution=merge-duplicates,return=minimal",
                },
                body: JSON.stringify({ profile_id: existingProfileId, student_id: studentId }),
              });
              return new Response(JSON.stringify({ ok: true, already_existed: true, linked_to_existing_account: true }), { status: 200 });
            }
          } catch (linkErr) {
            console.error("Kunne ikke koble elev til eksisterende konto:", linkErr);
          }
        }
        return new Response(JSON.stringify({ ok: true, already_existed: true }), { status: 200 });
      }
      console.error("Supabase admin createUser fejl:", res.status, data);
      return new Response(JSON.stringify({ ok: false, error: "Kunne ikke oprette konto." }), { status: 200 });
    }

    return new Response(JSON.stringify({ ok: true, user_id: data?.id }), { status: 200 });
  } catch (err) {
    console.error("Fejl ved oprettelse af elevkonto:", err);
    return new Response(JSON.stringify({ ok: false, error: "Uventet fejl." }), { status: 200 });
  }
};

export const config = {
  path: "/api/create-student-account",
};
