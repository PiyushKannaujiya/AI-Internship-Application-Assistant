import { ApiError } from "../utils/ApiError.js";

export function validate(schema, source = "body") {
  return function validationMiddleware(req, _res, next) {
    const result = schema.safeParse(req[source]);

    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join(".") || source,
        message: issue.message,
      }));
      return next(
        new ApiError(400, "Validation failed", {
          code: "VALIDATION_ERROR",
          details,
        })
      );
    }

    // Express 5 exposes req.query as a getter, so query validation results
    // are attached separately and read from req.validatedQuery.
    if (source === "query") {
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }

    next();
  };
}
