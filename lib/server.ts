import {createClient} from '@supabase/supabase-js';
export function serverDb(){return createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});}
export async function requestUser(req:Request){
 const token=req.headers.get('authorization')?.match(/^Bearer (.+)$/i)?.[1];
 if(!token)return null;
 const {data,error}=await serverDb().auth.getUser(token);
 if(error||!data.user)throw new Error('UNAUTHORIZED');
 return data.user;
}
