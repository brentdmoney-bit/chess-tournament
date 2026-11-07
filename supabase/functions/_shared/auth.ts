import { createClient } from 'npm:@supabase/supabase-js@2.45.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/** Returns a service-role client if the caller's JWT belongs to one of `roles`, else a 403 Response. */
export async function requireRole(req: Request, roles: string[]) {
  const url = Deno.env.get('SUPABASE_URL')!;
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: role, error } = await asCaller.rpc('my_role');
  if (error || !roles.includes(role)) return json({ error: 'Not allowed.' }, 403);
  return createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
}
