const projectRef = 'egbiiizxsqlarqpnzxxs';
const authCookieName = `sb-${projectRef}-auth-token`;
const authBypassHeader = 'x-dallmayr-e2e-auth';

export async function installSupabaseAuthFixture(page, baseURL, session) {
  const bypassToken = process.env.E2E_AUTH_BYPASS_TOKEN;
  if (!bypassToken || bypassToken.length < 32) {
    throw new Error('E2E_AUTH_BYPASS_TOKEN must contain at least 32 characters.');
  }

  await page.setExtraHTTPHeaders({ [authBypassHeader]: bypassToken });
  await page.context().addCookies([{
    name: authCookieName,
    value: `base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`,
    url: baseURL,
    sameSite: 'Lax',
  }]);
}
