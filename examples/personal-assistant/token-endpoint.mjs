// The one server-side piece of the personal-assistant example: it turns "the user signed in to my app" into a
// short-lived Junis app-user token. The organization key lives here and nowhere else.
//   JUNIS_ORG_KEY=jns_live_… JUNIS_ORG_ID=<uuid> JUNIS_AGENT_ID=<orchestrator id> APP_ORIGIN=https://app.example.com node token-endpoint.mjs
import http from 'node:http';

const BASE = process.env.JUNIS_API_BASE || 'https://api.junis.ai/api/external';
const { JUNIS_ORG_KEY, JUNIS_ORG_ID, JUNIS_AGENT_ID, APP_ORIGIN } = process.env;
if (!JUNIS_ORG_KEY || !JUNIS_ORG_ID || !APP_ORIGIN) throw new Error('Set JUNIS_ORG_KEY, JUNIS_ORG_ID and APP_ORIGIN');

async function junis(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'X-API-Key': JUNIS_ORG_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Junis ${path} → ${res.status}`);
  return res.json();
}

// REPLACE THIS with your own sign-in check (session cookie, your identity provider's token …). It must return the
// id your app uses for this person, or null. Never take the id from the request body: that would let anyone ask
// for anyone's token.
function signedInUserId(req) {
  return null;
}

http.createServer(async (req, res) => {
  if (req.method !== 'POST' || req.url !== '/api/junis-token') { res.writeHead(404).end(); return; }
  try {
    const externalId = signedInUserId(req);
    if (!externalId) { res.writeHead(401).end(); return; }
    const account = await junis('/management/users', { organization_id: JUNIS_ORG_ID, external_id: String(externalId) });
    const issued = await junis(`/management/users/${account.user_id}/app-token`,
      { origin: APP_ORIGIN, ...(JUNIS_AGENT_ID ? { agent_ids: [JUNIS_AGENT_ID] } : {}) });
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ token: issued.token, expires_in: issued.expires_in }));
  } catch (e) {
    console.error(e.message);                                            // never log the token or the key
    res.writeHead(502).end();
  }
}).listen(Number(process.env.PORT) || 8787);
