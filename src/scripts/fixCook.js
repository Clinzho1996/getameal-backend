import dotenv from "dotenv";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

dotenv.config();

const fixOldCooks = async () => {
	try {
		await mongoose.connect(process.env.MONGODB_URI);

		console.log("Connected to MongoDB");

		const cooks = await CookProfile.find({});
		console.log(`Found ${cooks.length} cook profiles`);

		let updatedCount = 0;

		for (const cook of cooks) {
			let changed = false;

			// Ensure userId exists and references a real user
			const user = await User.findById(cook.userId);
			if (!user) {
				console.log(
					`Cook ${cook._id} has invalid userId ${cook.userId}, skipping`,
				);
				continue;
			}

			// Fix isApproved (default false if undefined)
			if (typeof cook.isApproved !== "boolean") {
				cook.isApproved = false;
				changed = true;
			}

			// Fix isAvailable (default true if undefined)
			if (typeof cook.isAvailable !== "boolean") {
				cook.isAvailable = true;
				changed = true;
			}

			// Fix availablePickup (default true if undefined)
			if (typeof cook.availablePickup !== "boolean") {
				cook.availablePickup = true;
				changed = true;
			}

			// Fix schedule (must be array)
			if (!Array.isArray(cook.schedule)) {
				cook.schedule = [];
				changed = true;
			}

			// Fix location (if missing, use user's location if available)
			if (!cook.location && user.location) {
				cook.location = {
					type: "Point",
					coordinates: user.location.coordinates || [0, 0],
					address: user.location.address || "",
				};
				changed = true;
			}

			// Set availableForCooking if missing
			if (!cook.availableForCooking) {
				cook.availableForCooking = new Date();
				changed = true;
			}

			if (changed) {
				await cook.save();
				updatedCount++;
				console.log(`Updated cook profile ${cook._id}`);
			}
		}

		console.log(`Finished. Updated ${updatedCount} cook profiles.`);
		await mongoose.disconnect();
	} catch (err) {
		console.error("Error fixing cook profiles:", err);
		process.exit(1);
	}
};

fixOldCooks();
