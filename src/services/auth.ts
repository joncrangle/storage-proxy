import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { openAPI } from "better-auth/plugins";
import { ENTRA } from "../config";
import { db } from "./db";
import * as schemas from "./db.schemas";

/**
 * Better-Auth configuration
 */
export const auth = betterAuth({
	database: drizzleAdapter(db, {
		provider: "sqlite",
		schema: {
			...schemas,
		},
	}),
	socialProviders: {
		microsoft: {
			provider: "microsoft",
			clientId: ENTRA.CLIENT_ID,
			clientSecret: ENTRA.CLIENT_SECRET,
			tenantId: ENTRA.TENANT_ID,
		},
	},
	session: {
		cookieCache: {
			enabled: true,
			maxAge: 5 * 60,
		},
	},
	plugins: [openAPI()],
});
