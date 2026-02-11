// Server hooks for SvelteKit
// Note: GameRoom Durable Object is exported from worker.ts for Cloudflare Workers

import type { Handle } from '@sveltejs/kit';
import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET } from '$env/static/private';

interface SessionData {
  id: string;
  username: string;
  avatar: string | null;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

async function refreshDiscordToken(refreshToken: string): Promise<SessionData | null> {
  try {
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken
      })
    });

    if (!tokenResponse.ok) return null;

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      refresh_token: string;
      expires_in: number;
    };

    // Get updated user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    if (!userResponse.ok) return null;

    const userData = await userResponse.json() as {
      id: string;
      username: string;
      avatar: string | null;
    };

    return {
      id: userData.id,
      username: userData.username,
      avatar: userData.avatar,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: Date.now() + tokenData.expires_in * 1000
    };
  } catch {
    return null;
  }
}

export const handle: Handle = async ({ event, resolve }) => {
  const sessionCookie = event.cookies.get('session');

  if (sessionCookie) {
    try {
      let session = JSON.parse(sessionCookie) as SessionData;

      // Refresh token if expired (with 5 min buffer)
      if (session.expiresAt < Date.now() + 5 * 60 * 1000) {
        const refreshed = await refreshDiscordToken(session.refreshToken);
        if (refreshed) {
          session = refreshed;
          event.cookies.set('session', JSON.stringify(session), {
            path: '/',
            httpOnly: true,
            secure: event.url.protocol === 'https:',
            sameSite: 'lax',
            maxAge: 60 * 60 * 24 * 30
          });
        } else {
          // Refresh failed — clear invalid session
          event.cookies.delete('session', { path: '/' });
          return resolve(event);
        }
      }

      event.locals.user = {
        id: session.id,
        username: session.username,
        avatar: session.avatar
      };
    } catch {
      event.cookies.delete('session', { path: '/' });
    }
  }

  return resolve(event);
};
