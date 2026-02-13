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
