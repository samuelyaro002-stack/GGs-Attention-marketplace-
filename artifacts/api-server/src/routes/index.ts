import { Router, type IRouter } from "express";
import authRouter from "./auth";
import healthRouter from "./health";
import marketplaceRouter from "./marketplace";
import celoRewardPoolRouter from "./celo-reward-pool";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(marketplaceRouter);
router.use(celoRewardPoolRouter);

export default router;
