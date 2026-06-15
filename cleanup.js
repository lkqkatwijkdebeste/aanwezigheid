const admin = require('firebase-admin');

// Lees losse environment variabelen in plaats van JSON
const serviceAccount = {
  type: "service_account",
  project_id: process.env.FIREBASE_PROJECT_ID,
  private_key_id: process.env.FIREBASE_PRIVATE_KEY_ID,
  private_key: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  client_email: process.env.FIREBASE_CLIENT_EMAIL,
  client_id: process.env.FIREBASE_CLIENT_ID,
  auth_uri: "https://accounts.google.com/o/oauth2/auth",
  token_uri: "https://oauth2.googleapis.com/token"
};

console.log('Project ID:', serviceAccount.project_id);
console.log('Client email:', serviceAccount.client_email);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function run() {
  const snap = await db.collection('aanwezigheid').get();
  const entries = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  entries.sort((a, b) => {
    const ta = a.tijdstip ? a.tijdstip.seconds : 0;
    const tb = b.tijdstip ? b.tijdstip.seconds : 0;
    return ta - tb;
  });

  const last = {};
  for (const e of entries) last[e.naam.toLowerCase()] = e;
  const nogAanwezig = Object.values(last).filter(e => e.type === 'in');

  const nu = new Date();
  const vandaag = nu.toLocaleDateString('nl-NL', { timeZone: 'Europe/Amsterdam' });
  const uurUTC = nu.getUTCHours();
  const uitcheckenActief = uurUTC >= 21 || uurUTC < 2;

  const alUitgecheckt = new Set(
    entries
      .filter(e => e.automatisch === true && e.datum === vandaag && e.type === 'out')
      .map(e => e.naam.toLowerCase())
  );

  let aantalUit = 0;
  if (uitcheckenActief) {
    for (const persoon of nogAanwezig) {
      if (alUitgecheckt.has(persoon.naam.toLowerCase())) continue;
      await db.collection('aanwezigheid').add({
        naam: persoon.naam,
        bedrijf: persoon.bedrijf || 'LKQ',
        type: 'out',
        tijdstip: admin.firestore.Timestamp.now(),
        datum: vandaag,
        tijd: '23:59',
        verloopt: new Date(nu.getTime() + 30 * 24 * 60 * 60 * 1000),
        automatisch: true
      });
      aantalUit++;
    }
  }
  console.log('Uitchecken actief: ' + uitcheckenActief + ' | Uitgecheckt: ' + aantalUit);

  const grens = new Date(nu.getTime() - 30 * 24 * 60 * 60 * 1000);
  const oudSnap = await db.collection('aanwezigheid')
    .where('tijdstip', '<', grens).get();

  const batch = db.batch();
  oudSnap.docs.forEach(doc => batch.delete(doc.ref));
  await batch.commit();
  console.log('Oude data verwijderd: ' + oudSnap.size + ' registraties.');

  process.exit(0);
}

run().catch(err => { console.error('Fout:', err); process.exit(1); });
