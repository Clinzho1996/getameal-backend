import express from "express";

import {
	getCitiesByState,
	getStates,
} from "../controllers/locationController.js";
import protect from "../middleware/auth.js";

const router = express.Router();

router.get("/states", protect, getStates);

router.get("/cities/:stateCode", getCitiesByState);

export default router;
