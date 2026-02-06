import { redirect } from '@sveltejs/kit';
import { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_REDIRECT_URI } from '$env/static/private';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url }) => {
  const code = url.searchParams.get('code');

  if (!code) {
    throw redirect(302, '/?error=no_code');
  }

  try {
    // Exchange code for access token
    const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code,
        redirect_uri: DISCORD_REDIRECT_URI
      })
    });

    if (!tokenResponse.ok) {
      throw redirect(302, '/?error=token_failed');
    }

    const tokenData = await tokenResponse.json();

    // Get user info
    const userResponse = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`
      }
    });

    if (!userResponse.ok) {
      throw redirect(302, '/?error=user_failed');
    }

    const userData = await userResponse.json();

    // Redirect back with user data encoded in URL (client will store it)
    const authData = encodeURIComponent(
      JSON.stringify({
        id: userData.id,
        username: userData.username,
        avatar: userData.avatar,
        accessToken: tokenData.access_token
      })
    );

    throw redirect(302, `/?auth=${authData}`);
  } catch (e) {
    if ((e as { status?: number; }).status === 302) throw e;
    throw redirect(302, '/?error=auth_failed');
  }
};
