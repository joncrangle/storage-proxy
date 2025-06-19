import type { NextFunction, Response } from "express";
import { z } from "zod";
import type { CustomRequest } from "@/types";

type RequestSchemas = Partial<{
	body: z.ZodTypeAny;
	query: z.ZodTypeAny;
	params: z.ZodTypeAny;
}>;

export function validateRequest(schemas: RequestSchemas) {
	return async (req: CustomRequest, res: Response, next: NextFunction) => {
		try {
			if (schemas.params) {
				req.params = await schemas.params.parseAsync(req.params);
			}
			if (schemas.query) {
				req.query = await schemas.query.parseAsync(req.query);
			}
			if (schemas.body) {
				req.body = await schemas.body.parseAsync(req.body);
			}
			return next();
		} catch (error) {
			if (error instanceof z.ZodError) {
				res.status(400).json({
					error: "Validation Error",
					message: "Invalid request data provided.",
					details: error.flatten().fieldErrors,
					requestId: req.id,
				});
				return;
			}
			return next(error); // Forward non-Zod errors
		}
	};
}
