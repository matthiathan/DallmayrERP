import { createClient } from 'npm:@supabase/supabase-js@2.112.0';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const APP_ORIGIN = (Deno.env.get('DALLMAYR_APP_ORIGIN') ?? 'https://dallmayrerp.onrender.com').replace(/\/$/, '');

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  throw new Error('Missing Supabase Edge Function environment variables.');
}

const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function bearerToken(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() ?? '';
}

Deno.serve(async (request: Request) => {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse({ invited: false, message: 'POST is required.' }, 405);

  const token = bearerToken(request);
  if (!token) return jsonResponse({ invited: false, message: 'Authentication is required.' }, 401);

  const { data: authResult, error: authError } = await adminClient.auth.getUser(token);
  const authUser = authResult.user;
  if (authError || !authUser) return jsonResponse({ invited: false, message: 'Your session could not be verified.' }, 401);

  const { data: caller, error: callerError } = await adminClient
    .from('users')
    .select('id,is_active,account_scope,user_details!inner(role)')
    .eq('auth_user_id', authUser.id)
    .maybeSingle();

  const callerRole = Array.isArray(caller?.user_details)
    ? caller?.user_details[0]?.role
    : (caller?.user_details as { role?: string } | null | undefined)?.role;

  if (callerError || !caller || !caller.is_active || caller.account_scope !== 'dallmayr' || callerRole !== 'admin') {
    return jsonResponse({ invited: false, message: 'Only a Dallmayr Administrator may send client invitations.' }, 403);
  }

  let payload: { email?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ invited: false, message: 'A JSON request body is required.' }, 400);
  }

  const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
  if (!email || email.length > 320 || !email.includes('@')) {
    return jsonResponse({ invited: false, message: 'Enter a valid client email address.' }, 400);
  }

  const { data: accessRecord, error: accessError } = await adminClient
    .from('users')
    .select('id,email,is_active,account_scope,customer_id,auth_user_id')
    .eq('email', email)
    .maybeSingle();

  if (accessError) return jsonResponse({ invited: false, message: 'Client access could not be verified.' }, 503);
  if (!accessRecord || !accessRecord.is_active || accessRecord.account_scope !== 'client' || !accessRecord.customer_id) {
    return jsonResponse({ invited: false, message: 'Create an active company-scoped client access record before sending an invitation.' }, 409);
  }
  if (accessRecord.auth_user_id) {
    return jsonResponse({ invited: false, message: 'This client account has already been activated.' }, 409);
  }

  const { data: invite, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${APP_ORIGIN}/reset-password`,
    data: { account_scope: 'client' },
  });

  if (inviteError) {
    return jsonResponse({ invited: false, message: inviteError.message || 'The invitation email could not be sent.' }, 400);
  }

  return jsonResponse({
    invited: true,
    email,
    auth_user_id: invite.user?.id ?? null,
    message: 'Client invitation sent. The invitation opens the secure password setup screen.',
  });
});
