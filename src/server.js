import dotenv from "dotenv";
import admin from "firebase-admin";

dotenv.config(); // MUST be first line

import cors from "cors";
import express from "express";
import http from "http";
import morgan from "morgan";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import adminRoutes from "./routes/adminRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import bankRoutes from "./routes/bankRoutes.js";
import callRoutes from "./routes/callRoutes.js";
import cookRoutes from "./routes/cookRoutes.js";
import foodCategoryRoutes from "./routes/foodCategoryRoutes.js";
import locationRoutes from "./routes/locationRoutes.js";
import mealRoutes from "./routes/mealRoutes.js";
import notificationRoutes from "./routes/notification.js";
import orderRoutes from "./routes/orderRoutes.js";
import payoutRoutes from "./routes/payoutRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import webhookRoutes from "./routes/webhooks.js";

connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Add this endpoint BEFORE your routes
// In your main server file (server.js, app.js, or index.js)

// Your existing Firebase initialization
// Make sure admin is initialized before this endpoint

// ADD THIS ENDPOINT
app.post("/api/generate-custom-token", async (req, res) => {
	try {
		const { email, name } = req.body;

		console.log("Generate token request for:", email);

		if (!email) {
			return res.status(400).json({
				success: false,
				message: "Email is required",
			});
		}

		// Check if admin is available
		if (!admin || !admin.auth) {
			console.error("Admin not initialized");
			return res.status(500).json({
				success: false,
				message: "Firebase Admin not initialized",
			});
		}

		// Create or get user
		let user;
		try {
			user = await admin.auth().getUserByEmail(email);
			console.log("Existing user found:", user.uid);
		} catch (error) {
			// User doesn't exist, create one
			console.log("Creating new user...");
			user = await admin.auth().createUser({
				email: email,
				displayName: name || email.split("@")[0],
				emailVerified: true,
			});
			console.log("New user created:", user.uid);
		}

		// Generate custom token
		const customToken = await admin.auth().createCustomToken(user.uid);
		console.log("Custom token generated successfully");

		res.json({
			success: true,
			customToken: customToken,
			uid: user.uid,
			email: user.email,
		});
	} catch (error) {
		console.error("Error in generate-custom-token:", error);
		res.status(500).json({
			success: false,
			message: error.message,
		});
	}
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/user", userRoutes);
app.use("/api/cook", cookRoutes);
app.use("/api/category", foodCategoryRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/banks", bankRoutes);
app.use("/api/locations", locationRoutes);
app.use("/api/webhooks", webhookRoutes);
app.use("/api/payouts", payoutRoutes);
app.use("/api/calls", callRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/notifications", notificationRoutes);

// Socket.io
io.on("connection", (socket) => {
	socket.on("join", (room) => socket.join(room));
	socket.on("message", (data) => io.to(data.room).emit("message", data));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
