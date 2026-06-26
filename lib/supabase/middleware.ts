import { NextResponse, type NextRequest } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Routes reachable without a session. Everything else requires authentication.
const PUBLIC_PATHS = ["/login", "/signup", "/api/admin"]

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))
}

/**
 * Refreshes the Supabase auth session on every request, keeps the auth cookies
 * in sync, and enforces the route gate:
 *   - Unauthenticated users hitting any non-public route are sent to /login.
 *   - Authenticated users hitting /login or /signup are sent to the terminal.
 * Call this from the root middleware so Server Components always see a fresh
 * session and protected routes are never rendered for anonymous users.
 */
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request })

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  // If Supabase isn't configured yet, skip auth entirely — the app still runs
  // locally without a backend (the gate would otherwise lock everyone out).
  if (!url || !anonKey) return response

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (toSet: any[]) => {
        for (const { name, value } of toSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of toSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // Touch the session so an expired access token is refreshed via the cookie.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const onPublicPath = isPublicPath(pathname)

  // Strict gate: no session + protected route → redirect to /login, preserving
  // the intended destination so we can return there after sign-in.
  if (!user && !onPublicPath) {
    const loginUrl = request.nextUrl.clone()
    loginUrl.pathname = "/login"
    loginUrl.search = ""
    if (pathname !== "/") loginUrl.searchParams.set("redirectTo", pathname)
    return NextResponse.redirect(loginUrl)
  }

  // Already signed in but sitting on an auth page → send to the terminal.
  if (user && onPublicPath) {
    const homeUrl = request.nextUrl.clone()
    homeUrl.pathname = "/"
    homeUrl.search = ""
    return NextResponse.redirect(homeUrl)
  }

  return response
}
