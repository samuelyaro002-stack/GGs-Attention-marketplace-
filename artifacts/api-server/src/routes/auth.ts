import { Router, type IRouter } from "express";
import { GetCurrentUserResponse } from "@workspace/api-zod";
import { isAdminUser, requireAuth } from "../middlewares/security";

const router: IRouter = Router();

router.get("/auth/me", requireAuth, (req, res): void => {
  const userId = (req as typeof req & { userId: string }).userId;
  res.setHeader("Cache-Control", "private, no-store");
  res.json(GetCurrentUserResponse.parse({
    id: userId,
    displayName: userId,
    isAdmin: isAdminUser(userId),
  }));
});

export default router;