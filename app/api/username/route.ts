import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requestUser, serverDb } from '../../../lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const reply = (data: object, status = 200) => NextResponse.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
});
const validName = /^[a-z0-9_]{3,24}$/;
const validKey = /^[a-f0-9]{64}$/;
function digest(key: string) { return createHash('sha256').update(key).digest('hex'); }
function matches(key: string, saved: string) {
  return validKey.test(key) && /^[a-f0-9]{64}$/.test(saved) && timingSafeEqual(Buffer.from(digest(key), 'hex'), Buffer.from(saved, 'hex'));
}
function allowed(name: string) {
  // New accounts only: configure exactly your intended usernames in Vercel.
  return (process.env.MINDSYNC_ALLOWED_USERNAMES || '').toLowerCase().split(',').map(x => x.trim()).includes(name);
}
function fail(error: unknown) {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return reply({error:'Sign in again.'},401);
  const err = error as {
    code?: string;
    status?: number;
    name?: string;
  };

  console.error('MindSync username operation failed:', {
    code: err?.code || 'UNKNOWN',
    status: err?.status || 500,
    name: err?.name || 'UnknownError',
  });

  return reply(
    {
      error: 'Username service unavailable.',
      code: err?.code || 'UNKNOWN',
    },
    500
  );
}
export async function GET(req: Request) {
  try {
    const user = await requestUser(req);
    if (!user) return reply({error:'Sign in first.'},401);
    const {data,error} = await serverDb().from('ms_usernames').select('username').eq('user_id',user.id).maybeSingle();
    if (error) throw error;
    return reply({username:data?.username ?? null});
  } catch (error) { return fail(error); }
}
export async function POST(req: Request) {
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply({error:'Invalid request.'},400);
    let body; try { body=JSON.parse(raw); } catch { return reply({error:'Invalid request.'},400); }
    if (!body || typeof body !== 'object') return reply({error:'Invalid request.'},400);
    const action = body.action;
    const username = typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    const key = typeof body.key === 'string' ? body.key.trim().toLowerCase() : '';
    if (!['enter','recover','bind','rotate'].includes(action) || !validName.test(username) || !validKey.test(key)) return reply({error:'Use 3–24 letters, numbers or underscores and a valid recovery code.'},400);
    const db = serverDb();
    if (action === 'bind' || action === 'rotate') {
      const user = await requestUser(req);
      if (!user) return reply({error:'Sign in first.'},401);
      const existing = await db.from('ms_usernames').select('username').eq('user_id',user.id).maybeSingle();
      if (existing.error) throw existing.error;
      if (action === 'rotate') {
        if (existing.data?.username !== username) return reply({error:'Username not linked to your account.'},403);
        const {error} = await db.from('ms_usernames').update({recovery_hash:digest(key)}).eq('user_id',user.id).eq('username',username);
        if (error) throw error;
        return reply({username});
      }
      if (existing.data) return reply({error:'This account already has a username.'},409);
      if (!allowed(username)) return reply({error:'This username is not enabled. Ask the site owner to configure it.'},403);
      if (!user.email) return reply({error:'This existing account cannot be migrated automatically.'},400);
      const {error} = await db.from('ms_usernames').insert({username,user_id:user.id,recovery_hash:digest(key)});
      if (error?.code === '23505') return reply({error:'Username already taken, or account already linked.'},409);
      if (error) throw error;
      return reply({username});
    }
    const found = await db.from('ms_usernames').select('user_id,recovery_hash').eq('username',username).maybeSingle();
    if (found.error) throw found.error;
    let userId: string;
    let created = false;
    if (found.data) {
      if (!matches(key,found.data.recovery_hash)) return reply({error:'This username requires its private recovery code.', recoveryRequired:true},401);
      userId = found.data.user_id;
    } else {
      if (action === 'recover') return reply({error:'Username or recovery code is incorrect.'},401);
      if (!allowed(username)) return reply({error:'This username is not enabled for new accounts. Ask the site owner to configure it.'},403);
      // Internal address only. No email is requested from the user or sent.
      const {data,error} = await db.auth.admin.createUser({email:`${randomUUID()}@mindsync.example`,email_confirm:true});
      if (error || !data.user) throw error || new Error('Account creation failed');
      userId = data.user.id;
      const inserted = await db.from('ms_usernames').insert({username,user_id:userId,recovery_hash:digest(key)});
      if (inserted.error) {
        // Only clean up the just-created account; never delete an existing account.
        await db.auth.admin.deleteUser(userId).catch(()=>{});
        if (inserted.error.code === '23505') return reply({error:'This username requires its private recovery code.',recoveryRequired:true},401);
        throw inserted.error;
      }
      created = true;
    }
    const account = await db.auth.admin.getUserById(userId);
    if (account.error || !account.data.user?.email) throw account.error || new Error('Account unavailable');
    const {data,error} = await db.auth.admin.generateLink({type:'magiclink',email:account.data.user.email});
    if (error || data.user?.id !== userId || !data.properties?.hashed_token) throw error || new Error('Session exchange failed');
    // Only a proven recovery credential (or the new account creator) receives this one-time token.
    return reply({username,created,tokenHash:data.properties.hashed_token});
  } catch (error) { return fail(error); }
}
