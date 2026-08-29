import { Router, type IRouter } from "express";
import healthRouter from "./health";
import bodyGrowthRouter from "./body-growth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(bodyGrowthRouter);

export default router;