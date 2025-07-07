import type { auth } from "./services/auth";

declare module "hono" {
	interface ContextVariableMap {
		user: typeof auth.$Infer.Session.user | null;
		session: typeof auth.$Infer.Session.session | null;
		requestId: string;
	}
}
