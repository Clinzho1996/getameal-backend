import dotenv from "dotenv";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

dotenv.config();

const MIGRATION_STATUS = {
	PENDING: "pending",
	COMPLETED: "completed",
	FAILED: "failed",
	SKIPPED: "skipped",
};

async function migrateCookProfiles() {
	try {
		// Connect to MongoDB
		await mongoose.connect("process.env.MONGODB_URI");
		console.log("Connected to MongoDB");

		// Get all cook profiles that need migration
		const oldCookProfiles = await CookProfile.find({
			$or: [
				{ firstName: { $exists: false } }, // Missing new fields
				{ kycInfo: { $exists: false } },
				{ kitchenPhotos: { $exists: false } },
			],
		});

		console.log(`Found ${oldCookProfiles.length} cook profiles to migrate`);

		const migrationResults = {
			total: oldCookProfiles.length,
			completed: 0,
			failed: 0,
			skipped: 0,
			details: [],
		};

		for (const profile of oldCookProfiles) {
			try {
				console.log(`\n--- Migrating profile: ${profile._id} ---`);

				// Get the associated user
				const user = await User.findById(profile.userId);

				// Prepare updates for the cook profile
				const updates = {};

				// 1. Map personal information
				if (!profile.firstName) {
					// Extract first name and last name from cookName or user data
					let firstName = profile.firstName;
					let lastName = profile.lastName;

					if (profile.cookName) {
						const nameParts = profile.cookName.split(" ");
						firstName = nameParts[0];
						lastName = nameParts.slice(1).join(" ") || "Cook";
					} else if (user) {
						firstName =
							user.firstName || user.fullName?.split(" ")[0] || "Cook";
						lastName =
							user.lastName ||
							user.fullName?.split(" ").slice(1).join(" ") ||
							"User";
					} else {
						firstName = "Unknown";
						lastName = "Cook";
					}

					updates.firstName = firstName;
					updates.lastName = lastName;
				}

				// 2. Set email from user if not present
				if (!profile.email && user) {
					updates.email =
						user.email ||
						`${profile.cookName?.toLowerCase().replace(/\s/g, "")}@example.com`;
				}

				// 3. Set cookDisplayName from cookName
				if (!profile.cookDisplayName && profile.cookName) {
					updates.cookDisplayName = profile.cookName;
				}

				// 4. Set default bio if not present
				if (!profile.bio) {
					updates.bio = `${profile.cookName} has ${profile.cookingExperience} of cooking experience. Specializing in delicious home-cooked meals.`;
				}

				// 5. Set default profile photo if not present
				if (!profile.profilePhoto) {
					updates.profilePhoto =
						user?.profileImage ||
						"https://res.cloudinary.com/default-profile.jpg";
				}

				// 6. Set default cover photo
				if (!profile.coverPhoto) {
					updates.coverPhoto = "https://res.cloudinary.com/default-cover.jpg";
				}

				// 7. Set KYC info (default to unregistered individual)
				if (!profile.kycInfo) {
					updates.kycInfo = {
						isRegistered: false,
						businessType: "individual",
						cacImage: null,
					};
				}

				// 8. Set business details
				if (!profile.businessDetails) {
					updates.businessDetails = {
						cac: {
							isRegistered: false,
							registrationNumber: null,
							certificateImage: null,
						},
						cookType: "individual",
					};
				}

				// 9. Set kitchen photos (use existing images or placeholder)
				if (!profile.kitchenPhotos || profile.kitchenPhotos.length === 0) {
					// If there are existing images in cook profile, use those
					// Otherwise use placeholders
					const existingImages = [];

					// Check if there are any existing images in the profile
					if (profile.images && profile.images.length > 0) {
						updates.kitchenPhotos = profile.images.slice(0, 3);
					} else {
						updates.kitchenPhotos = [
							"https://res.cloudinary.com/default-kitchen-1.jpg",
							"https://res.cloudinary.com/default-kitchen-2.jpg",
							"https://res.cloudinary.com/default-kitchen-3.jpg",
						];
					}
				}

				// 10. Preserve existing bank details if any
				if (profile.bankDetails && !updates.bankDetails) {
					updates.bankDetails = profile.bankDetails;
				}

				// 11. Ensure location is properly formatted
				if (profile.location && !profile.location.type) {
					updates.location = {
						type: "Point",
						coordinates: profile.location.coordinates || [0, 0],
						address: profile.location.address || profile.cookAddress,
					};
				}

				// Apply all updates
				if (Object.keys(updates).length > 0) {
					await CookProfile.updateOne({ _id: profile._id }, { $set: updates });
					console.log(
						`✓ Updated profile ${profile._id} with:`,
						Object.keys(updates),
					);
				}

				// Update user record if needed
				if (user && !user.isCook) {
					await User.updateOne({ _id: user._id }, { $set: { isCook: true } });
					console.log(`✓ Updated user ${user._id} with isCook=true`);
				}

				migrationResults.completed++;
				migrationResults.details.push({
					id: profile._id,
					cookName: profile.cookName,
					status: MIGRATION_STATUS.COMPLETED,
					updatesApplied: Object.keys(updates),
				});
			} catch (error) {
				console.error(
					`✗ Failed to migrate profile ${profile._id}:`,
					error.message,
				);
				migrationResults.failed++;
				migrationResults.details.push({
					id: profile._id,
					cookName: profile.cookName,
					status: MIGRATION_STATUS.FAILED,
					error: error.message,
				});
			}
		}

		// Print migration summary
		console.log("\n=== MIGRATION SUMMARY ===");
		console.log(`Total profiles: ${migrationResults.total}`);
		console.log(`Completed: ${migrationResults.completed}`);
		console.log(`Failed: ${migrationResults.failed}`);
		console.log(`Skipped: ${migrationResults.skipped}`);

		// Save migration report
		const fs = await import("fs");
		const report = {
			timestamp: new Date().toISOString(),
			...migrationResults,
		};

		fs.writeFileSync("migration-report.json", JSON.stringify(report, null, 2));
		console.log("\nMigration report saved to migration-report.json");

		await mongoose.disconnect();
		console.log("\nDisconnected from MongoDB");
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}
}

// Run the migration
migrateCookProfiles();
