// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			user?: {
				id: string;
				username: string;
				avatar: string | null;
			};
			/**
			 * Set only for dev virtual sessions (/api/auth/dev-login) that asked
			 * for admin rights. Ignored outside dev — see $lib/server/admin.
			 */
			devSuperAdmin?: boolean;
		}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				GAME_ROOM: DurableObjectNamespace;
				GAME_LOBBY: DurableObjectNamespace;
				GAME_DATA: KVNamespace;
			};
			context: ExecutionContext;
			caches: CacheStorage & { default: Cache; };
		}
	}
}

export { };
