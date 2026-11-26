declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env?: { ASSETS?: { fetch: typeof fetch } };
		}
	}
}

export {};
