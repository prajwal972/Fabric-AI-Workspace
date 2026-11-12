import { AppError } from "../server/errors.mjs";

export async function workflowsRoutes({
  ctx,
  actor,
  req,
  res,
  p,
  method,
  u,
  controller,
}) {
  if (p.startsWith("/api/workflows"))
    throw new AppError(
      "WORKFLOWS_REMOVED",
      "Unfinished workflows were removed; use bounded agents.",
      410,
    );
}
