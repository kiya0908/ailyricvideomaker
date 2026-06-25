import { getAuth } from "@repo/data-ops/auth/server";
import { ZodError } from "zod";

export async function requireUserId(request: Request) {
  const session = await getAuth().api.getSession({
    headers: request.headers,
  });

  if (!session) {
    return null;
  }
  return session.user.id;
}

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return Response.json(data, init);
}

export function errorResponse(error: unknown) {
  if (error instanceof ZodError) {
    return jsonResponse(
      { error: "Invalid request body", issues: error.issues },
      { status: 400 },
    );
  }
  if (error instanceof Error) {
    return jsonResponse({ error: error.message }, { status: 400 });
  }
  return jsonResponse({ error: "Unexpected error" }, { status: 500 });
}
