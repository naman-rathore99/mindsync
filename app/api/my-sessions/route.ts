import {NextResponse as R} from 'next/server';
import {requestUser,serverDb} from '../../../lib/server';
const headers={'Cache-Control':'private, no-store'};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=(e:unknown)=>R.json({error:e instanceof Error&&e.message==='UNAUTHORIZED'?'Sign in again.':'Unable to access saved links.'},{status:e instanceof Error&&e.message==='UNAUTHORIZED'?401:500,headers});
export async function GET(req:Request){try{
 const u=await requestUser(req); if(!u)return R.json({error:'Sign in first.'},{status:401,headers});
 const sessions:unknown[]=[]; const db=serverDb();
 for(let offset=0;;offset+=200){const {data,error}=await db.from('sessions').select('id,owner_key,payload,response,created_at').eq('owner_id',u.id).order('created_at',{ascending:false}).order('id').range(offset,offset+199);if(error)throw error;sessions.push(...(data||[]));if(!data||data.length<200)break;}
 return R.json({sessions},{headers});
}catch(e){return fail(e)}}
export async function POST(req:Request){try{
 const u=await requestUser(req); if(!u)return R.json({error:'Sign in first.'},{status:401,headers});
 const {id,key}=await req.json(); if(typeof id!=='string'||typeof key!=='string'||!uuid.test(id)||!uuid.test(key))return R.json({error:'Invalid creator link.'},{status:400,headers});
 const db=serverDb(); const {data,error}=await db.from('sessions').update({owner_id:u.id}).eq('id',id).eq('owner_key',key).is('owner_id',null).select('id');
 if(error)throw error;
 if(!data?.length){const {data:existing,error:lookupError}=await db.from('sessions').select('id').eq('id',id).eq('owner_key',key).eq('owner_id',u.id).maybeSingle();if(lookupError)throw lookupError;if(!existing)return R.json({error:'Link invalid or already claimed.'},{status:404,headers});}
 return R.json({ok:true},{headers});
}catch(e){return fail(e)}}
export async function DELETE(req:Request){try{
 const u=await requestUser(req); if(!u)return R.json({error:'Sign in first.'},{status:401,headers});
 const id=new URL(req.url).searchParams.get('id'); if(!id||!uuid.test(id))return R.json({error:'Invalid link.'},{status:400,headers});
 const {data,error}=await serverDb().from('sessions').delete().eq('id',id).eq('owner_id',u.id).select('id');
 if(error)throw error;
 if(!data?.length)return R.json({error:'Link not found.'},{status:404,headers});
 return R.json({ok:true},{headers});
}catch(e){return fail(e)}}
