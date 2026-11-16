import {createClient, type SupabaseClient} from '@supabase/supabase-js';
let client:SupabaseClient|undefined;
export function browserDb(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return null;
 return client??=createClient(url,key);
}
export async function accountHeaders():Promise<Record<string,string>>{
 const db=browserDb(); if(!db)return {};
 const {data,error}=await db.auth.getSession();
 if(error)throw error;
 return data.session?{Authorization:`Bearer ${data.session.access_token}`}:{ };
}
