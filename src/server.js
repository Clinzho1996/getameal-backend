import dotenv from "dotenv";
dotenv.config(); // MUST be first line

import cors from "cors";
import express from "express";
import http from "http";
import morgan from "morgan";
import { Server } from "socket.io";
import connectDB from "./config/db.js";
import authRoutes from "./routes/authRoutes.js";
import cookRoutes from "./routes/cookRoutes.js";
import foodCategoryRoutes from "./routes/foodCategoryRoutes.js";
import mealRoutes from "./routes/mealRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import userRoutes from "./routes/userRoutes.js";

connectDB();

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });



app.use(cors());
app.use(express.json());
app.use(morgan("dev"));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/meals", mealRoutes);
app.use("/api/user", userRoutes);
app.use("/api/cook", cookRoutes);
app.use("/api/category", foodCategoryRoutes);
app.use("/api/reviews", reviewRoutes);

// Socket.io
io.on("connection", (socket) => {
	socket.on("join", (room) => socket.join(room));
	socket.on("message", (data) => io.to(data.room).emit("message", data));
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => console.log(`Server running on ${PORT}`));
