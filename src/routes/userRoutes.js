import express from "express";
import multer from "multer";
import {
	deleteAccount,
	getMyProfile,
	getUserProfile,
	updateBio,
	updateCoverImage,
	updateLocation,
	updateProfile,
	updateProfileImage,
} from "../controllers/userController.js";
import protect from "../middleware/auth.js";

const router = express.Router();
const upload = multer({ dest: "uploads/" }); // temp storage before cloudinary

router.put("/profile", protect, updateProfile);
router.delete("/delete", protect, deleteAccount);

router.put(
	"/profile/image",
	protect,
	upload.single("image"),
	updateProfileImage,
);
router.put("/cover/image", protect, upload.single("image"), updateCoverImage);
router.get("/me", protect, getMyProfile);

router.get("/:id", getUserProfile);
router.put("/bio", protect, updateBio);
router.put("/location", protect, updateLocation);

export default router;
