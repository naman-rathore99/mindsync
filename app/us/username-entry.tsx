'use client';
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { accountHeaders, browserDb } from '../../lib/browser';

const valid = /^[a-z0-9_]{3,24}$/;
const validKey = /^[a-f0-9]{64}$/;
const makeKey = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), n=>n.toString(16).padStart(2,'0')).join('');
const pendingName = (name:string) => `mindsync:pending-recovery:${name}`;
function pending(name:string) { try { return sessionStorage.getItem(pendingName(name)) || ''; } catch { return ''; } }
function remember(name:string,key:string) { try { sessionStorage.setItem(pendingName(name),key); } catch {} }
function forget(name:string) { try { sessionStorage.removeItem(pendingName(name)); } catch {} }
async function call(body?:object) {
  const r = await fetch('/api/username',{method:body?'POST':'GET',cache:'no-store',headers:{'Content-Type':'application/json',...await accountHeaders()},...(body?{body:JSON.stringify(body)}:{})});
  const data=await r.json();
  return {r,data};
}
function explain(e:unknown) { return e instanceof Error ? e.message : typeof e==='object' && e && 'message' in e ? String(e.message) : 'Unable to enter. Try again.'; }
export default function UsernameEntry({session}:{session:Session|null}) {
  const [name,setName]=useState(''),[profile,setProfile]=useState<string|null>(null),[loaded,setLoaded]=useState(false),[recover,setRecover]=useState(false),[key,setKey]=useState(''),[proof,setProof]=useState<{name:string;key:string;uid?:string}|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const uid=session?.user.id;
  useEffect(()=>{
    let active=true;setProfile(null);setLoaded(false);
    if(!uid){setProof(null);setKey('');setRecover(false);setError('');return;}
    call().then(({r,data})=>{if(!r.ok)throw Error(data.error);if(active){setProfile(data.username);setLoaded(true);if(data.username){const k=pending(data.username);if(k)setProof({name:data.username,key:k,uid});}}}).catch(e=>{if(active)setError(explain(e))});
    return()=>{active=false};
  },[uid]);
  async function submit(action:'enter'|'recover'|'bind'|'rotate') {
    setBusy(true);setError('');
    const username=(action==='rotate'?profile||'':name).trim().toLowerCase();
    try {
      if(!valid.test(username))throw Error('Use 3–24 letters, numbers or underscores.');
      const secret=action==='recover'?key.trim().toLowerCase():(action==='enter'?pending(username)||makeKey():makeKey());
      if(!validKey.test(secret))throw Error('Enter your full 64-character recovery code.');
      if(action==='enter')remember(username,secret);
      const {r,data}=await call({action,username,key:secret});
      if (!r.ok) {
  if (data.recoveryRequired) {
    setRecover(true);
    forget(username);
  }

  throw new Error(
    `${data.error || 'Unable to enter.'}${
      data.code ? ` (${data.code})` : ''
    }`
  );
}
      if(action==='bind'||action==='rotate'){remember(username,secret);setProfile(username);setProof({name:username,key:secret,uid});setName(username);return;}
      const db=browserDb();if(!db)throw Error('Supabase is not configured.');
      const result=await db.auth.verifyOtp({token_hash:data.tokenHash,type:'email'});
      if(result.error||!result.data.session)throw result.error||Error('Could not start the session. Retry using the same username.');
      if(action==='enter')setProof({name:username,key:secret,uid:result.data.session.user.id});
      setKey('');setRecover(false);setName(username);
    }catch(e){setError(explain(e));}finally{setBusy(false)}
  }
  const proofVisible=!!session && !!proof && proof.uid===uid;
  if(session)return <>
    {profile?<div className="card"><small>YOUR ACCOUNT</small><h2>@{profile}</h2><p>Your account is remembered on this device.</p>{!proofVisible&&<button className="ghost" disabled={busy} onClick={()=>{if(confirm('Replace your recovery code? The previous code will stop working. Save the new code somewhere safe.'))void submit('rotate')}}>Create a new recovery code</button>}</div>:loaded?<form className="card" onSubmit={e=>{e.preventDefault();void submit('bind')}}><h2>Choose your username</h2><p>This links your existing account without changing your saved memories, streaks or partner.</p><label htmlFor="ms-bind">Username</label><input id="ms-bind" value={name} onChange={e=>setName(e.target.value)} autoCapitalize="none" autoCorrect="off" maxLength={24} required placeholder="Your username"/><button className="primary" disabled={busy}>Link username</button></form>:<p>Checking your username…</p>}
    {proofVisible&&proof&&<div className="card"><h2>Save your private recovery code</h2><p>Keep this in a safe place outside your browser. It is required only if you sign out, clear browser data or use a new phone. Never share it with your partner.</p><textarea readOnly value={proof.key} aria-label="Private recovery code"/><button className="ghost" onClick={async()=>{try{await navigator.clipboard.writeText(proof.key)}catch{setError('Select and copy the code manually.')}}}>Copy recovery code</button><button className="primary" onClick={()=>{forget(proof.name);setProof(null)}}>I saved it safely</button></div>}
    {error&&<p className="card" role="alert">{error}</p>}
  </>;
  return <form className="card" onSubmit={e=>{e.preventDefault();void submit(recover?'recover':'enter')}}>
    <h2>{recover?'Recover your space':'Enter our universe'}</h2><p>{recover?'Use the recovery code you saved when creating your account.':'No email. No password. Just us.'}</p>
    <label htmlFor="ms-name">Your username</label><input id="ms-name" required value={name} onChange={e=>setName(e.target.value)} autoComplete="username" autoCapitalize="none" autoCorrect="off" maxLength={24} placeholder="Enter your username"/>
    {recover&&<><label htmlFor="ms-key">Private recovery code</label><input id="ms-key" required value={key} onChange={e=>setKey(e.target.value)} autoComplete="off" autoCapitalize="none" autoCorrect="off" placeholder="Your saved recovery code" type="password"/></>}
    <button className="primary" disabled={busy}>{busy?'Opening…':recover?'Restore my space':'Enter our universe ♡'}</button>
    <button type="button" className="ghost" onClick={()=>{setRecover(!recover);setError('');setKey('')}}>{recover?'Back to username entry':'New phone or cleared browser data?'}</button>
    <a className="ghost block text-center" href="/us/legacy">Transfer an older email account</a>
    {error&&<p role="alert">{error}</p>}
  </form>;
}
