import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import {
  applyAuthCookiePersistence,
  AUTH_PERSISTENCE_COOKIE,
  shouldRememberAuth,
} from '@/lib/supabase/authPersistence';

const PUBLIC_AUTH_ROUTES = ['/login', '/reset-password'];
const SESSION_RESPONSE_HEADERS = ['cache-control', 'expires', 'pragma'] as const;
const E2E_AUTH_HEADER = 'x-dallmayr-e2e-auth';

function isPublicAuthRoute(pathname: string) {
  return PUBLIC_AUTH_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function safeReturnPath(value: string | null, requestUrl: string) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  try {
    const origin = new URL(requestUrl).origin;
    const destination = new URL(value, origin);
    if (destination.origin !== origin) return '/';
    if (destination.pathname.startsWith('/login') || destination.pathname.startsWith('/reset-password')) return '/';
    return `${destination.pathname}${destination.search}${destination.hash}`;
  } catch {
    return '/';
  }
}

function redirectWithSession(url: URL, sessionResponse: NextResponse) {
  const redirect = NextResponse.redirect(url);
  sessionResponse.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
  SESSION_RESPONSE_HEADERS.forEach((header) => {
    const value = sessionResponse.headers.get(header);
    if (value) redirect.headers.set(header, value);
  });
  return redirect;
}

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicRoute = isPublicAuthRoute(pathname);
  const e2eAuthToken = process.env.E2E_AUTH_BYPASS_TOKEN;
  const e2eAuthenticated = !publicRoute
    && Boolean(e2eAuthToken && e2eAuthToken.length >= 32)
    && request.headers.get(E2E_AUTH_HEADER) === e2eAuthToken;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let response = NextResponse.next({ request });

  // Browser tests use signed-in Supabase fixtures that only exist inside
  // Playwright. This bypass requires an explicit server-only token and a
  // matching request header, so it cannot activate in a normal deployment.
  if (e2eAuthenticated) return response;

  if (!supabaseUrl || !supabaseKey) {
    if (publicRoute) return response;
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(loginUrl);
  }

  const remember = shouldRememberAuth(request.cookies.get(AUTH_PERSISTENCE_COOKIE)?.value);
  const supabase = createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, applyAuthCookiePersistence(options, remember));
        });
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // getClaims validates the JWT. Server-side getSession alone must not be used
  // as the authentication boundary because its cookie payload can be spoofed.
  const { data, error } = await supabase.auth.getClaims();
  const authenticated = !error && Boolean(data?.claims?.sub);

  if (!authenticated && !publicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = '/login';
    loginUrl.search = '';
    loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
    return redirectWithSession(loginUrl, response);
  }

  if (authenticated && pathname === '/login') {
    const destination = safeReturnPath(request.nextUrl.searchParams.get('next'), request.url);
    return redirectWithSession(new URL(destination, request.url), response);
  }

  return response;
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map|woff|woff2)$).*)',
  ],
};
