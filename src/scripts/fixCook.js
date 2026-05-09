// backend/scripts/migratePushTokens.js
import dotenv from "dotenv";
import mongoose from "mongoose";
import User from "../models/User.js";

dotenv.config();

async function migratePushTokens() {
	try {
		// Connect to MongoDB
		await mongoose.connect(
			"mongodb+srv://confidinho:Ochuko.1996@cluster0.g7vyqdc.mongodb.net/getameal?retryWrites=true&w=majority&appName=Cluster0",
		);
		console.log("✅ Connected to MongoDB");

		// Find all users without pushTokens field
		const usersWithoutTokens = await User.find({
			$or: [{ pushTokens: { $exists: false } }, { pushTokens: null }],
		});

		console.log(
			`📊 Found ${usersWithoutTokens.length} users missing pushTokens array`,
		);

		let updated = 0;
		let skipped = 0;

		for (const user of usersWithoutTokens) {
			try {
				// Add empty pushTokens array
				user.pushTokens = [];
				await user.save();
				updated++;

				if (updated % 100 === 0) {
					console.log(`✅ Migrated ${updated} users...`);
				}
			} catch (err) {
				console.error(`❌ Failed to migrate user ${user._id}:`, err.message);
				skipped++;
			}
		}

		console.log("\n🎉 Migration Complete!");
		console.log(`✅ Updated: ${updated} users`);
		console.log(`⏭️ Skipped: ${skipped} users`);

		// ✅ FIX: Use countDocuments() instead of deprecated count()
		const remaining = await User.countDocuments({
			pushTokens: { $exists: false },
		});
		console.log(`📊 Remaining users without pushTokens: ${remaining}`);

		// Also show users with empty arrays (have field but no tokens)
		const usersWithEmptyTokens = await User.countDocuments({
			pushTokens: { $exists: true, $size: 0 },
		});
		console.log(
			`📊 Users with empty pushTokens array: ${usersWithEmptyTokens}`,
		);

		// Show users with actual tokens
		const usersWithTokens = await User.countDocuments({
			pushTokens: { $exists: true, $not: { $size: 0 } },
		});
		console.log(`📊 Users with registered push tokens: ${usersWithTokens}`);
	} catch (error) {
		console.error("❌ Migration failed:", error);
	} finally {
		await mongoose.disconnect();
		console.log("🔌 Disconnected from MongoDB");
	}
}

// Run the migration
migratePushTokens();
