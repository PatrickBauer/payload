/**
 * Example: Integrating Payload JWT Cookies with Telegram Authentication in Tanstack Start
 *
 * This demonstrates how to:
 * 1. Authenticate users via Telegram widget
 * 2. Upsert users into Payload database
 * 3. Manually generate JWT tokens for authenticated users
 * 4. Set Payload-compatible cookies
 */

import { getPayload } from 'payload'
import { jwtSign, getFieldsToSign, generatePayloadCookie } from 'payload'
import { addSessionToUser } from 'payload'
import config from '@/payload.config'

// ============================================================================
// STEP 1: Telegram Authentication Types
// ============================================================================

interface TelegramUser {
  id: number
  first_name: string
  last_name?: string
  username?: string
  photo_url?: string
  auth_date: number
  hash: string
}

// ============================================================================
// STEP 2: Verify Telegram Authentication
// ============================================================================

import crypto from 'crypto'

function verifyTelegramAuth(data: TelegramUser, botToken: string): boolean {
  const { hash, ...dataToCheck } = data

  // Create data check string
  const dataCheckString = Object.keys(dataToCheck)
    .sort()
    .map((key) => `${key}=${dataToCheck[key]}`)
    .join('\n')

  // Create secret key
  const secretKey = crypto.createHash('sha256').update(botToken).digest()

  // Create hash
  const computedHash = crypto
    .createHmac('sha256', secretKey)
    .update(dataCheckString)
    .digest('hex')

  return computedHash === hash
}

// ============================================================================
// STEP 3: Upsert User in Payload and Generate Token
// ============================================================================

/**
 * Main function to handle Telegram authentication and generate Payload token
 */
export async function authenticateWithTelegram(telegramUser: TelegramUser) {
  const payload = await getPayload({ config })

  // Verify Telegram data (important for security!)
  const isValid = verifyTelegramAuth(telegramUser, process.env.TELEGRAM_BOT_TOKEN!)
  if (!isValid) {
    throw new Error('Invalid Telegram authentication')
  }

  // Find or create user in Payload
  const existingUsers = await payload.find({
    collection: 'users',
    where: {
      telegramId: {
        equals: telegramUser.id,
      },
    },
    limit: 1,
  })

  let user
  if (existingUsers.docs.length > 0) {
    // Update existing user
    user = await payload.update({
      collection: 'users',
      id: existingUsers.docs[0].id,
      data: {
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        photoUrl: telegramUser.photo_url,
        lastLogin: new Date(),
      },
    })
  } else {
    // Create new user
    user = await payload.create({
      collection: 'users',
      data: {
        email: `telegram_${telegramUser.id}@telegram.user`, // Dummy email since Telegram doesn't provide it
        telegramId: telegramUser.id,
        firstName: telegramUser.first_name,
        lastName: telegramUser.last_name,
        username: telegramUser.username,
        photoUrl: telegramUser.photo_url,
        // Set a random password (user will never use it)
        password: crypto.randomBytes(32).toString('hex'),
      },
    })
  }

  // ============================================================================
  // STEP 4: Manually Generate JWT Token
  // ============================================================================

  const collectionConfig = payload.collections['users'].config

  // Add session if sessions are enabled
  const sessionData = await addSessionToUser({
    collectionConfig,
    payload,
    req: {}, // You can pass an empty req object
    user,
  })

  // Get fields to sign (includes id, collection, email, and any saveToJWT fields)
  const fieldsToSign = getFieldsToSign({
    collectionConfig,
    email: user.email,
    user,
    sid: sessionData.sid, // Include session ID if sessions enabled
  })

  // Sign the JWT
  const { token, exp } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: collectionConfig.auth.tokenExpiration,
  })

  return {
    user,
    token,
    exp,
    sessionId: sessionData.sid,
  }
}

// ============================================================================
// STEP 5: Tanstack Start API Route for Telegram Login
// ============================================================================

/**
 * Tanstack Start API Route
 * File: app/routes/api/auth/telegram.ts
 */
import { json } from '@tanstack/start'
import { createAPIFileRoute } from '@tanstack/start/api'

export const Route = createAPIFileRoute('/api/auth/telegram')({
  POST: async ({ request }) => {
    try {
      // Parse Telegram user data from request
      const telegramUser = await request.json() as TelegramUser

      // Authenticate and generate token
      const { user, token, exp } = await authenticateWithTelegram(telegramUser)

      // Generate Payload-compatible cookie
      const payload = await getPayload({ config })
      const cookieString = generatePayloadCookie({
        collectionAuthConfig: payload.collections['users'].config.auth,
        cookiePrefix: payload.config.cookiePrefix,
        token,
        returnCookieAsObject: false, // Returns Set-Cookie header string
      })

      // Return response with Set-Cookie header
      return new Response(
        JSON.stringify({
          success: true,
          user: {
            id: user.id,
            firstName: user.firstName,
            lastName: user.lastName,
            username: user.username,
          },
        }),
        {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': cookieString,
          },
        }
      )
    } catch (error) {
      return new Response(
        JSON.stringify({
          success: false,
          error: error.message,
        }),
        {
          status: 401,
          headers: {
            'Content-Type': 'application/json',
          },
        }
      )
    }
  },
})

// ============================================================================
// STEP 6: Logout Route
// ============================================================================

import { generateExpiredPayloadCookie } from 'payload'

/**
 * File: app/routes/api/auth/logout.ts
 */
export const LogoutRoute = createAPIFileRoute('/api/auth/logout')({
  POST: async ({ request }) => {
    const payload = await getPayload({ config })

    // Generate expired cookie to clear it
    const expiredCookie = generateExpiredPayloadCookie({
      collectionAuthConfig: payload.collections['users'].config.auth,
      cookiePrefix: payload.config.cookiePrefix,
      returnCookieAsObject: false,
    })

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: {
          'Set-Cookie': expiredCookie,
        },
      }
    )
  },
})

// ============================================================================
// STEP 7: Client-Side Telegram Login Component
// ============================================================================

/**
 * Client component with Telegram login widget
 * File: app/components/TelegramLogin.tsx
 */
import { useEffect } from 'react'
import { useRouter } from '@tanstack/react-router'

declare global {
  interface Window {
    TelegramLoginWidget: {
      onAuth: (user: TelegramUser) => void
    }
  }
}

export function TelegramLogin() {
  const router = useRouter()

  useEffect(() => {
    // Define callback for Telegram widget
    window.TelegramLoginWidget = {
      onAuth: async (telegramUser: TelegramUser) => {
        try {
          // Send to your API route
          const response = await fetch('/api/auth/telegram', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(telegramUser),
            credentials: 'include', // Important: include cookies
          })

          const result = await response.json()

          if (result.success) {
            // Cookie is now set! Redirect to dashboard
            router.navigate({ to: '/dashboard' })
          } else {
            console.error('Authentication failed:', result.error)
          }
        } catch (error) {
          console.error('Authentication error:', error)
        }
      },
    }

    // Load Telegram widget script
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', 'YOUR_BOT_USERNAME')
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-onauth', 'TelegramLoginWidget.onAuth(user)')
    script.setAttribute('data-request-access', 'write')
    document.body.appendChild(script)

    return () => {
      document.body.removeChild(script)
    }
  }, [])

  return (
    <div>
      <h2>Login with Telegram</h2>
      {/* Telegram widget will be injected here */}
    </div>
  )
}

// ============================================================================
// STEP 8: Server-Side Authentication Middleware
// ============================================================================

/**
 * Middleware to check authentication on protected routes
 * File: app/middleware/auth.ts
 */
import { parseCookies } from 'payload'

export async function requireAuth(request: Request) {
  const payload = await getPayload({ config })

  // Parse cookies from request
  const cookies = parseCookies(request.headers)
  const cookieName = `${payload.config.cookiePrefix}-token`
  const token = cookies.get(cookieName)

  if (!token) {
    throw new Response('Unauthorized', { status: 401 })
  }

  // Verify JWT using Payload's strategy
  const { user } = await payload.auth({
    headers: request.headers,
  })

  if (!user) {
    throw new Response('Unauthorized', { status: 401 })
  }

  return user
}

/**
 * Protected route example
 * File: app/routes/dashboard.tsx
 */
export const DashboardRoute = createFileRoute('/dashboard')({
  loader: async ({ context }) => {
    const user = await requireAuth(context.request)
    return { user }
  },
  component: () => {
    const { user } = Route.useLoaderData()
    return (
      <div>
        <h1>Welcome, {user.firstName}!</h1>
      </div>
    )
  },
})

// ============================================================================
// STEP 9: Payload Configuration for Telegram Auth
// ============================================================================

/**
 * File: payload.config.ts
 */
import { buildConfig } from 'payload'

export default buildConfig({
  // Cookie prefix
  cookiePrefix: 'payload',

  // CSRF whitelist - add your frontend URL
  csrf: [
    'http://localhost:3000',
    'https://yourdomain.com',
  ],

  collections: [
    {
      slug: 'users',
      auth: {
        // Disable email/password login since we're using Telegram
        disableLocalStrategy: true,

        // Token expiration (2 hours)
        tokenExpiration: 7200,

        // Cookie settings
        cookies: {
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'Lax',
          domain: undefined, // Set to '.yourdomain.com' for subdomains
        },

        // Remove token from response body (we're using cookies)
        removeTokenFromResponses: true,

        // Track sessions
        useSessions: true,
      },
      fields: [
        {
          name: 'email',
          type: 'email',
          required: true,
          unique: true,
        },
        {
          name: 'telegramId',
          type: 'number',
          required: true,
          unique: true,
          index: true,
        },
        {
          name: 'firstName',
          type: 'text',
        },
        {
          name: 'lastName',
          type: 'text',
        },
        {
          name: 'username',
          type: 'text',
        },
        {
          name: 'photoUrl',
          type: 'text',
        },
        {
          name: 'lastLogin',
          type: 'date',
        },
        {
          name: 'sessions',
          type: 'array',
          fields: [
            {
              name: 'id',
              type: 'text',
            },
            {
              name: 'createdAt',
              type: 'date',
            },
            {
              name: 'expiresAt',
              type: 'date',
            },
          ],
        },
      ],
    },
  ],
})

// ============================================================================
// STEP 10: Alternative - Manual Token Generation Without Sessions
// ============================================================================

/**
 * Simplified version without session management
 * (if you set useSessions: false in config)
 */
export async function generateTokenForUser(userId: string) {
  const payload = await getPayload({ config })

  // Find user
  const user = await payload.findByID({
    collection: 'users',
    id: userId,
  })

  if (!user) {
    throw new Error('User not found')
  }

  const collectionConfig = payload.collections['users'].config

  // Get fields to sign
  const fieldsToSign = getFieldsToSign({
    collectionConfig,
    email: user.email,
    user,
    // No session ID needed if useSessions: false
  })

  // Sign JWT
  const { token, exp } = await jwtSign({
    fieldsToSign,
    secret: payload.secret,
    tokenExpiration: collectionConfig.auth.tokenExpiration,
  })

  return { token, exp }
}

// ============================================================================
// KEY POINTS SUMMARY
// ============================================================================

/**
 * 1. JWT Token Generation:
 *    - Import: jwtSign, getFieldsToSign from 'payload'
 *    - Sign with payload.secret
 *    - Include: id, collection, email, sid (optional)
 *
 * 2. Cookie Generation:
 *    - Import: generatePayloadCookie from 'payload'
 *    - Returns Set-Cookie header string
 *    - Same format as REST endpoints use
 *
 * 3. Session Management:
 *    - Import: addSessionToUser from 'payload'
 *    - Creates session ID and stores in user.sessions array
 *    - Include sid in JWT for session tracking
 *
 * 4. Telegram Authentication Flow:
 *    - User clicks Telegram widget
 *    - Widget returns TelegramUser data
 *    - Verify hash using bot token
 *    - Upsert user in Payload
 *    - Generate JWT token manually
 *    - Set cookie with token
 *    - User is authenticated!
 *
 * 5. Security Considerations:
 *    - Always verify Telegram hash
 *    - Use secure cookies in production
 *    - Add CSRF protection
 *    - Set httpOnly: true (automatic with generatePayloadCookie)
 *    - Use HTTPS in production
 *
 * 6. Key Imports from Payload:
 *    import {
 *      jwtSign,                    // Sign JWT tokens
 *      getFieldsToSign,            // Get JWT payload data
 *      generatePayloadCookie,      // Generate Set-Cookie header
 *      generateExpiredPayloadCookie, // Clear cookies
 *      addSessionToUser,           // Add session to user
 *      parseCookies,               // Parse Cookie header
 *    } from 'payload'
 */
