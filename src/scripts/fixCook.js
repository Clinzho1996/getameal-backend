// scripts/migrateCookDisplayName.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

dotenv.config();

const migrateCookDisplayName = async () => {
	try {
		await mongoose.connect(
			"mongodb+srv://confidinho:Ochuko.1996@cluster0.g7vyqdc.mongodb.net/getameal?retryWrites=true&w=majority&appName=Cluster0",
		);
		console.log("Connected to MongoDB");

		// Find all cook profiles
		const cookProfiles = await CookProfile.find({});
		console.log(`Found ${cookProfiles.length} cook profiles`);

		let updatedCount = 0;
		let skippedCount = 0;
		let errorCount = 0;

		for (const cookProfile of cookProfiles) {
			try {
				// Check if cookDisplayName is missing or null or empty
				if (
					!cookProfile.cookDisplayName ||
					cookProfile.cookDisplayName.trim() === ""
				) {
					// Get the user to fetch fullName
					const user = await User.findById(cookProfile.userId);

					let displayName = null;

					if (user && user.fullName) {
						displayName = user.fullName;
						console.log(
							`📝 Found user: ${user.fullName} for cook ${cookProfile.userId}`,
						);
					} else if (cookProfile.firstName && cookProfile.lastName) {
						displayName = `${cookProfile.firstName} ${cookProfile.lastName}`;
						console.log(`📝 Using name from profile: ${displayName}`);
					} else {
						displayName =
							cookProfile.email ||
							`Cook_${cookProfile.userId.toString().slice(-6)}`;
						console.log(`⚠️ Using fallback name: ${displayName}`);
					}

					// Update only the cookDisplayName field using updateOne to bypass validation
					if (displayName) {
						await CookProfile.updateOne(
							{ _id: cookProfile._id },
							{ $set: { cookDisplayName: displayName } },
						);
						updatedCount++;
						console.log(
							`✅ Updated cook ${cookProfile.userId}: "${displayName}"`,
						);
					}
				} else {
					skippedCount++;
					console.log(
						`⏭️ Skipped cook ${cookProfile.userId} - already has displayName: "${cookProfile.cookDisplayName}"`,
					);
				}
			} catch (err) {
				errorCount++;
				console.error(
					`❌ Error processing cook ${cookProfile.userId}:`,
					err.message,
				);
			}
		}

		console.log(`
		✅ Migration completed!
		📊 Total cook profiles: ${cookProfiles.length}
		🔄 Updated: ${updatedCount}
		⏭️ Skipped: ${skippedCount}
		❌ Errors: ${errorCount}
		`);

		await mongoose.disconnect();
		console.log("Disconnected from MongoDB");
	} catch (error) {
		console.error("Migration error:", error);
		await mongoose.disconnect();
		process.exit(1);
	}
};

// Run the migration
migrateCookDisplayName();
