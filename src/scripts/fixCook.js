// scripts/fixCookProfiles.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import CookProfile from "../models/CookProfile.js";
import User from "../models/User.js";

dotenv.config();

async function fixCookProfiles() {
	try {
		await mongoose.connect("process.env.MONGODB_URI");
		console.log("Connected to MongoDB");

		// Get all cook profiles
		const allCooks = await CookProfile.find({});
		console.log(`Found ${allCooks.length} total cook profiles`);

		let fixed = 0;
		let skipped = 0;
		let errors = 0;

		for (const cook of allCooks) {
			try {
				console.log(`\n--- Processing cook: ${cook._id} ---`);
				let needsUpdate = false;
				const updates = {};

				// 1. Fix fullName issue - preserve existing cookName
				if (
					cook.cookName &&
					(!cook.cookDisplayName || cook.cookDisplayName === "undefined")
				) {
					updates.cookDisplayName = cook.cookName;
					needsUpdate = true;
					console.log(`✓ Restored cookDisplayName: ${cook.cookName}`);
				}

				// 2. Fix firstName/lastName from cookName or user data
				if (
					(!cook.firstName ||
						cook.firstName === "Unknown" ||
						cook.firstName === "undefined") &&
					cook.cookName
				) {
					const nameParts = cook.cookName.split(" ");
					updates.firstName = nameParts[0];
					updates.lastName = nameParts.slice(1).join(" ") || "Cook";
					needsUpdate = true;
					console.log(
						`✓ Set firstName: ${updates.firstName}, lastName: ${updates.lastName} from cookName`,
					);
				}

				// 3. Fix bio - remove "undefined" text
				if (
					cook.bio &&
					(cook.bio.includes("undefined") ||
						cook.bio ===
							"undefined has undefined of cooking experience. Specializing in delicious home-cooked meals.")
				) {
					const experience = cook.cookingExperience || "professional";
					const displayName = cook.cookDisplayName || cook.cookName || "Chef";
					updates.bio = `${displayName} - ${experience} of cooking experience. Specializing in delicious home-cooked meals.`;
					needsUpdate = true;
					console.log(`✓ Fixed bio for ${displayName}`);
				} else if (!cook.bio && cook.cookName) {
					const experience = cook.cookingExperience || "professional";
					updates.bio = `${cook.cookName} - ${experience} of cooking experience. Specializing in delicious home-cooked meals.`;
					needsUpdate = true;
					console.log(`✓ Added bio for ${cook.cookName}`);
				}

				// 4. Fix email from user data if available
				if ((!cook.email || cook.email === "undefined") && cook.userId) {
					const user = await User.findById(cook.userId);
					if (user && user.email) {
						updates.email = user.email;
						needsUpdate = true;
						console.log(`✓ Restored email from user: ${user.email}`);
					}
				}

				// 5. Fix phone from user data if available
				if ((!cook.phone || cook.phone === "undefined") && cook.userId) {
					const user = await User.findById(cook.userId);
					if (user && user.phone) {
						updates.phone = user.phone;
						needsUpdate = true;
						console.log(`✓ Restored phone from user: ${user.phone}`);
					}
				}

				// 6. Ensure kitchenPhotos array exists
				if (!cook.kitchenPhotos || cook.kitchenPhotos.length === 0) {
					updates.kitchenPhotos = [
						"https://res.cloudinary.com/default-kitchen-1.jpg",
						"https://res.cloudinary.com/default-kitchen-2.jpg",
						"https://res.cloudinary.com/default-kitchen-3.jpg",
					];
					needsUpdate = true;
					console.log(`✓ Added default kitchen photos`);
				}

				// 7. Fix profilePhoto if missing
				if (!cook.profilePhoto && cook.userId) {
					const user = await User.findById(cook.userId);
					if (user && user.profileImage) {
						const profileImageUrl =
							typeof user.profileImage === "object"
								? user.profileImage.url
								: user.profileImage;
						if (profileImageUrl) {
							updates.profilePhoto = profileImageUrl;
							needsUpdate = true;
							console.log(`✓ Restored profile photo from user`);
						}
					}
				}

				if (!cook.profilePhoto && !updates.profilePhoto) {
					updates.profilePhoto =
						"https://res.cloudinary.com/default-profile.jpg";
					needsUpdate = true;
					console.log(`✓ Added default profile photo`);
				}

				// 8. Fix coverPhoto if missing
				if (!cook.coverPhoto) {
					updates.coverPhoto = "https://res.cloudinary.com/default-cover.jpg";
					needsUpdate = true;
					console.log(`✓ Added default cover photo`);
				}

				// 9. Fix kycInfo structure
				if (!cook.kycInfo || Object.keys(cook.kycInfo).length === 0) {
					updates.kycInfo = {
						isRegistered: false,
						businessType: "individual",
						cacImage: null,
					};
					needsUpdate = true;
					console.log(`✓ Added default kycInfo`);
				}

				// 10. Fix businessDetails structure
				if (!cook.businessDetails || !cook.businessDetails.cac) {
					updates.businessDetails = {
						cac: {
							isRegistered: false,
							registrationNumber: null,
							certificateImage: null,
						},
						cookType: "individual",
					};
					needsUpdate = true;
					console.log(`✓ Added default businessDetails`);
				}

				// 11. Fix location if coordinates are [0,0]
				if (
					cook.location &&
					cook.location.coordinates &&
					cook.location.coordinates[0] === 0 &&
					cook.location.coordinates[1] === 0
				) {
					// Try to get location from user or keep as is
					console.log(`⚠️ Location has zero coordinates for cook ${cook._id}`);
				}

				// 12. Fix fullName display issue in response
				if (
					cook.firstName &&
					cook.lastName &&
					!cook.firstName.includes("Unknown") &&
					!cook.lastName.includes("Cook")
				) {
					// Already has proper names
					console.log(
						`✓ Already has proper names: ${cook.firstName} ${cook.lastName}`,
					);
				} else if (cook.firstName === "Unknown" && cook.cookName) {
					const nameParts = cook.cookName.split(" ");
					updates.firstName = nameParts[0];
					updates.lastName = nameParts.slice(1).join(" ") || "Cook";
					needsUpdate = true;
					console.log(
						`✓ Fixed Unknown names to: ${updates.firstName} ${updates.lastName}`,
					);
				}

				// Apply updates if any
				if (needsUpdate) {
					await CookProfile.updateOne({ _id: cook._id }, { $set: updates });
					fixed++;
					console.log(`✅ Successfully updated cook ${cook._id}`);
				} else {
					skipped++;
					console.log(`⏭️ No updates needed for cook ${cook._id}`);
				}
			} catch (error) {
				errors++;
				console.error(`❌ Error processing cook ${cook._id}:`, error.message);
			}
		}

		// Final summary
		console.log("\n=== MIGRATION SUMMARY ===");
		console.log(`Total cooks processed: ${allCooks.length}`);
		console.log(`✅ Fixed: ${fixed}`);
		console.log(`⏭️ Skipped: ${skipped}`);
		console.log(`❌ Errors: ${errors}`);

		// Verify fixes
		console.log("\n=== VERIFICATION ===");
		const stillIssues = await CookProfile.find({
			$or: [
				{ firstName: "Unknown" },
				{ cookDisplayName: { $exists: false } },
				{ email: { $exists: false } },
				{ profilePhoto: { $exists: false } },
			],
		});

		if (stillIssues.length > 0) {
			console.log(`⚠️ Still have ${stillIssues.length} profiles with issues`);
		} else {
			console.log("✅ All profiles fixed successfully!");
		}

		await mongoose.disconnect();
		console.log("\nDisconnected from MongoDB");
	} catch (error) {
		console.error("Migration failed:", error);
		process.exit(1);
	}
}

// Run the fix
fixCookProfiles();
