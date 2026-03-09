// routes/callRoutes.js
import express from "express";
import { generateCallToken } from "../controllers/callController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

// Generate Agora token for a call
router.post("/token", protect, generateCallToken);

export default router;
