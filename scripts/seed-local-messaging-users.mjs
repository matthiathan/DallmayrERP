import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = [
  'LOCAL_SUPABASE_URL',
  'LOCAL_SUPABASE_SERVICE_ROLE_KEY',
  'LOCAL_AUTH_LINK_SQL',
  'STAGED_USER_A_EMAIL',
  'STAGED_USER_A_PASSWORD',
  'STAGED_USER_B_EMAIL',
  'STAGED_USER_B_PASSWORD',
  'STAGED_USER_C_EMAIL',
  'STAGED_USER_C_PASSWORD',
];

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) throw new Error(`Missing local messaging seed variable: ${name}`);
}

const users = [
  { label: 'A', email: process.env.STAGED_USER_A_EMAIL, password: process.env.STAGED_USER_A_PASSWORD },
  { label: 'B', email: process.env.STAGED_USER_B_EMAIL, password: process.env.STAGED_USER_B_PASSWORD },
  { label: 'C', email: process.env.STAGED_USER_C_EMAIL, password: process.env.STAGED_USER_C_PASSWORD },
];

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const admin = createClient(
  process.env.LOCAL_SUPABASE_URL,
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

const linkStatements = ['\\set ON_ERROR_STOP on', ''];

for (const user of users) {
  if (!emailPattern.test(user.email)) throw new Error(`Synthetic user ${user.label} has an invalid email address`);
  if (user.password.length < 12) throw new Error(`Synthetic user ${user.label} password is unexpectedly weak`);

  const { data, error } = await admin.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  });

  if (error) throw new Error(`Could not create local Auth user ${user.label}: ${error.message}`);
  if (!data.user?.id || !uuidPattern.test(data.user.id)) throw new Error(`Local Auth user ${user.label} returned an invalid id`);

  linkStatements.push(
    `update public.users set auth_user_id = ${sqlLiteral(data.user.id)}::uuid, updated_at = now() where email = ${sqlLiteral(user.email)};`,
    `select 1 / case when (select count(*) from public.users where email = ${sqlLiteral(user.email)} and auth_user_id = ${sqlLiteral(data.user.id)}::uuid) = 1 then 1 else 0 end;`,
    '',
  );
}

const outputPath = process.env.LOCAL_AUTH_LINK_SQL;
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${linkStatements.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
console.log('Created three synthetic local Supabase Auth users and a private auth-link SQL file.');
