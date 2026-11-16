import { createClient } from '@supabase/supabase-js';

export function serverDb() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) throw Object.assign(new Error('Missing SUPABASE_URL'), {code:'MISSING_SUPABASE_URL'});
  if (!key) throw Object.assign(new Error('Missing SUPABASE_SERVICE_ROLE_KEY'), {code:'MISSING_SERVICE_ROLE_KEY'});
  if (key.startsWith('sb_publishable_')) throw Object.assign(new Error('Incorrect server key'), {code:'INVALID_SERVER_KEY'});
  try { if (!['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Invalid URL'); }
  catch { throw Object.assign(new Error('Invalid SUPABASE_URL'), {code:'INVALID_SUPABASE_URL'}); }

  return createClient(url, key, {auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}

export async function requestUser(req: Request) {
  const token = req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
  if (!token) return null;
  const {data,error} = await serverDb().auth.getUser(token);
  if (error || !data.user) throw new Error('UNAUTHORIZED');
  return data.user;
}
