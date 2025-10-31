/**
 * Example: Integrating Payload Cookies with Local API
 *
 * This demonstrates how to manually set and clear cookies when using
 * Payload's Local API instead of REST endpoints.
 */

import { getPayload } from 'payload'
import { generatePayloadCookie, generateExpiredPayloadCookie } from 'payload'
import config from '@/payload.config'

// ============================================================================
// EXAMPLE 1: Next.js App Router (Recommended)
// ============================================================================

// app/actions/auth.ts
'use server'

import { cookies } from 'next/headers'
import { setPayloadAuthCookie } from '@payloadcms/next'

export async function loginAction(email: string, password: string) {
  const payload = await getPayload({ config })

  try {
    // Local API call - returns token but doesn't set cookie
    const result = await payload.login({
      collection: 'users',
      data: { email, password },
    })

    // Manually set the cookie using Next.js helper
    await setPayloadAuthCookie({
      authConfig: payload.collections.users.config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token: result.token!,
    })

    return { success: true, user: result.user }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

export async function logoutAction() {
  const payload = await getPayload({ config })
  const cookiesStore = await cookies()

  // Call logout operation
  await payload.logout({
    collection: 'users',
  })

  // Clear the cookie
  const cookieName = `${payload.config.cookiePrefix}-token`
  cookiesStore.delete(cookieName)

  return { success: true }
}

// ============================================================================
// EXAMPLE 2: Next.js API Routes (Alternative)
// ============================================================================

// app/api/auth/login/route.ts
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })
  const { email, password } = await request.json()

  try {
    const result = await payload.login({
      collection: 'users',
      data: { email, password },
    })

    // Generate cookie string
    const cookieString = generatePayloadCookie({
      collectionAuthConfig: payload.collections.users.config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token: result.token!,
      returnCookieAsObject: false, // Returns Set-Cookie header string
    })

    const response = NextResponse.json({
      success: true,
      user: result.user,
    })

    // Set the cookie
    response.headers.set('Set-Cookie', cookieString)

    return response
  } catch (error) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 401 }
    )
  }
}

// app/api/auth/logout/route.ts
export async function POST(request: NextRequest) {
  const payload = await getPayload({ config })

  await payload.logout({
    collection: 'users',
  })

  // Generate expired cookie to clear it
  const expiredCookie = generateExpiredPayloadCookie({
    collectionAuthConfig: payload.collections.users.config.auth,
    cookiePrefix: payload.config.cookiePrefix,
    returnCookieAsObject: false,
  })

  const response = NextResponse.json({ success: true })
  response.headers.set('Set-Cookie', expiredCookie)

  return response
}

// ============================================================================
// EXAMPLE 3: Express.js (Non-Next.js)
// ============================================================================

import express from 'express'

const app = express()

app.post('/api/auth/login', async (req, res) => {
  const payload = await getPayload({ config })
  const { email, password } = req.body

  try {
    const result = await payload.login({
      collection: 'users',
      data: { email, password },
    })

    // Generate cookie string
    const cookieString = generatePayloadCookie({
      collectionAuthConfig: payload.collections.users.config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      token: result.token!,
      returnCookieAsObject: false,
    })

    // Set cookie in Express
    res.setHeader('Set-Cookie', cookieString)

    return res.json({ success: true, user: result.user })
  } catch (error) {
    return res.status(401).json({ success: false, error: error.message })
  }
})

app.post('/api/auth/logout', async (req, res) => {
  const payload = await getPayload({ config })

  await payload.logout({
    collection: 'users',
  })

  // Generate expired cookie
  const expiredCookie = generateExpiredPayloadCookie({
    collectionAuthConfig: payload.collections.users.config.auth,
    cookiePrefix: payload.config.cookiePrefix,
    returnCookieAsObject: false,
  })

  res.setHeader('Set-Cookie', expiredCookie)

  return res.json({ success: true })
})

// ============================================================================
// EXAMPLE 4: Reading Cookies (Authentication Middleware)
// ============================================================================

// Next.js Middleware
import { NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  const payload = await getPayload({ config })
  const cookieName = `${payload.config.cookiePrefix}-token`

  // Cookie is automatically available in request
  const token = request.cookies.get(cookieName)?.value

  if (!token) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  // The cookie will be automatically sent to Payload API
  // and validated by the JWT strategy
  return NextResponse.next()
}

// ============================================================================
// EXAMPLE 5: Using Local API with Existing Cookie (Server Components)
// ============================================================================

// app/dashboard/page.tsx
export default async function DashboardPage() {
  const payload = await getPayload({ config })

  // When you call Local API from a server component,
  // you can pass cookies manually for authentication
  const cookiesStore = await cookies()
  const cookieName = `${payload.config.cookiePrefix}-token`
  const token = cookiesStore.get(cookieName)?.value

  if (!token) {
    redirect('/login')
  }

  // Option A: Verify the token manually
  try {
    // Payload's JWT strategy will validate this
    const user = await payload.auth({
      // You can pass headers with the token
      headers: new Headers({
        Cookie: `${cookieName}=${token}`,
      }),
    })

    // Now make authenticated requests
    const posts = await payload.find({
      collection: 'posts',
      user, // Pass the authenticated user
    })

    return <div>Welcome {user.email}!</div>
  } catch (error) {
    redirect('/login')
  }
}

// ============================================================================
// EXAMPLE 6: Frontend (Client-Side) Usage
// ============================================================================

// components/LoginForm.tsx
'use client'

import { useState } from 'react'
import { loginAction } from '@/app/actions/auth'

export function LoginForm() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Call your server action/API route that sets the cookie
    const result = await loginAction(email, password)

    if (result.success) {
      // Cookie is now set! Redirect to dashboard
      window.location.href = '/dashboard'
    } else {
      alert('Login failed: ' + result.error)
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="Email"
      />
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Password"
      />
      <button type="submit">Login</button>
    </form>
  )
}

// ============================================================================
// CONFIGURATION: Payload Config
// ============================================================================

export default buildConfig({
  // Cookie prefix (default: 'payload')
  // Cookie will be named: {cookiePrefix}-token
  cookiePrefix: 'payload',

  // CSRF protection - whitelist your frontend origins
  csrf: [
    'http://localhost:3000',
    'https://yourdomain.com',
  ],

  collections: [
    {
      slug: 'users',
      auth: {
        // Token expiration in seconds (default: 7200 = 2 hours)
        tokenExpiration: 7200,

        // Cookie settings
        cookies: {
          secure: process.env.NODE_ENV === 'production', // HTTPS only in production
          sameSite: 'Lax', // or 'Strict' for stricter CSRF protection
          domain: undefined, // Optional: set to '.yourdomain.com' for subdomains
        },

        // Hide token from response body (since you're using cookies)
        removeTokenFromResponses: true,

        // Track sessions in user document (default: true)
        // Allows logout from specific sessions
        useSessions: true,
      },
    },
  ],
})

// ============================================================================
// KEY TAKEAWAYS
// ============================================================================

/**
 * 1. REST API: Cookies are automatically set via Set-Cookie headers
 *    - Located at: /api/users/login, /api/users/logout, etc.
 *
 * 2. Local API: You must manually set cookies after authentication
 *    - Use setPayloadAuthCookie() for Next.js
 *    - Use generatePayloadCookie() for other frameworks
 *
 * 3. Cookie Attributes:
 *    - Name: {cookiePrefix}-token (default: payload-token)
 *    - httpOnly: true (prevents XSS)
 *    - Expires: Based on tokenExpiration
 *    - Secure: true in production (HTTPS only)
 *    - SameSite: Lax/Strict (CSRF protection)
 *
 * 4. Authentication Flow:
 *    - Frontend calls your server endpoint
 *    - Server calls Local API (payload.login)
 *    - Server sets cookie using helper functions
 *    - Browser stores cookie automatically
 *    - Cookie is sent with subsequent requests
 *    - Payload validates JWT from cookie
 *
 * 5. CSRF Protection:
 *    - Add your frontend origin to config.csrf array
 *    - Payload only accepts cookies from whitelisted origins
 *    - See: packages/payload/src/auth/extractJWT.ts:31-36
 *
 * 6. Sessions:
 *    - When useSessions: true, each login creates a session ID
 *    - Sessions are stored in user.sessions array
 *    - Allows logging out specific sessions
 *    - See: packages/payload/src/auth/sessions.ts
 */
