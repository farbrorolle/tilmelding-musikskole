// Planlagt Netlify Function, der holder Supabase-projektet vågent.
//
// Supabases gratisplan sætter et projekt på pause efter 7 dage uden aktivitet
// (det skete 31. august 2026). Mens projektet er sat på pause, kan hverken
// lærer eller elever logge ind, og nye tilmeldinger når ikke frem til
// ventelisten. Denne funktion laver en lille læsning i databasen hver 3. dag
// (Olles ønske — ikke hver dag), så der aldrig går mere end 3 dage mellem to
// aktiviteter.
//
// Kører kun på den udgivne produktionsversion af sitet (sådan virker
// Netlifys planlagte funktioner).

export default async () => {
  const supabaseUrl = Netlify.env.get("SUPABASE_URL");
  const serviceKey = Netlify.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    console.error("SUPABASE_URL eller SUPABASE_SERVICE_ROLE_KEY mangler.");
    return;
  }
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/lesson_prices?select=instrument&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    console.log("Supabase keep-alive:", res.status);
  } catch (err) {
    console.error("Supabase keep-alive fejlede:", err);
  }
};

// Kl. 06:00 UTC den 1., 4., 7., … i hver måned. Ved månedsskift kan der gå
// 1–3 dage mellem to kørsler, aldrig mere — langt under Supabases 7 dage.
export const config = {
  schedule: "0 6 */3 * *",
};
