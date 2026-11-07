// Reads a Google Sheet shared as "anyone with the link can view" and returns it as CSV.
// Server-side because Google's export URL redirects without CORS headers.
import { cors, json, requireRole } from '../_shared/auth.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const admin = await requireRole(req, ['TD']);
  if (admin instanceof Response) return admin;

  const { url } = await req.json().catch(() => ({}));
  // Only Google Sheets links: never fetch arbitrary URLs from the server.
  const m = typeof url === 'string' && url.match(/^https:\/\/docs\.google\.com\/spreadsheets\/d\/([\w-]+)/);
  if (!m) return json({ error: 'Paste a docs.google.com/spreadsheets link.' });
  const gid = url.match(/[#&?]gid=(\d+)/)?.[1];
  const res = await fetch(`https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${gid ? `&gid=${gid}` : ''}`, { redirect: 'follow' });
  const text = await res.text();
  if (!res.ok || text.trimStart().startsWith('<')) {
    return json({ error: 'Google refused. Set the sheet to “Anyone with the link can view” and try again.' });
  }
  return json({ csv: text });
});
