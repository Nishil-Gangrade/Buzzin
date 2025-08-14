import express from "express";
import { protectRoute } from "../middleware/auth.middleware.js";
import { getSmartReplies } from "../controllers/smartReply.controller.js";

const router = express.Router();

// POST /api/smart-replies
router.post("/", getSmartReplies);

export default router;
