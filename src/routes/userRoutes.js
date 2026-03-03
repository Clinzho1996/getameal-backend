import express from "express";
import multer from "multer";
import { addToCart, removeFromCart } from "../controllers/cartController.js";
import {
	addFavoriteCook,
	getFavoriteCooks,
	removeFavoriteCook,
} from "../controllers/cookController.js";
import {
	deleteAccount,
	getMyCart,
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

router.get("/cart", protect, getMyCart);
router.put("/profile", protect, updateProfile);
router.get("/favorites", protect, getFavoriteCooks);
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

// Cart
router.post("/cart", protect, addToCart);
router.delete("/cart/:mealId", protect, removeFromCart);

// Favorites
router.post("/favorites/:cookId", protect, addFavoriteCook);
router.delete("/favorites/:cookId", protect, removeFavoriteCook);

export default router;
