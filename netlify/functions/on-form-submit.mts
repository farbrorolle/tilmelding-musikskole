// Køres automatisk af Netlify, hver gang nogen indsender tilmeldingsformularen.
// Sender en kort dansk bekræftelse via Resend (https://resend.com) til den,
// der lige har tilmeldt sig. RESEND_API_KEY sættes som miljøvariabel i
// Netlify (Site settings → Environment variables) — den står IKKE i koden.
export default {
  async formSubmitted(event: any) {
    const data = event.data || {};
    const navn = data.navn || "";
    const email = data.email;
    if (!email) return;

    const apiKey = Netlify.env.get("RESEND_API_KEY");
    if (!apiKey) {
      console.error("RESEND_API_KEY mangler — kan ikke sende bekræftelsesmail.");
      return;
    }

    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Olles musikskole <onboarding@resend.dev>",
          to: email,
          subject: "Tak for din tilmelding",
          html: `<div style="font-family: system-ui, sans-serif, Arial; font-size: 16px"><p>Hej ${navn}!</p><p>Tak for din tilmelding, jeg vender tilbage med et skema.</p><p>Mange hilsner,<br />Olle</p></div>`,
        }),
      });
      if (!res.ok) {
        console.error("Resend fejl:", res.status, await res.text());
      }
    } catch (err) {
      console.error("Kunne ikke sende bekræftelsesmail:", err);
    }
  },
};
