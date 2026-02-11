import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ locals }) => {
  if (locals.user) {
    return json({ user: locals.user });
  }
  return json({ user: null });
};
