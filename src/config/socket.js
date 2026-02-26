import { Server } from "socket.io";

let io;

export const initSocket = (server) => {
	io = new Server(server, {
		cors: { origin: "*" },
	});

	io.on("connection", (socket) => {
		socket.on("join_user", (userId) => {
			socket.join(`user_${userId}`);
		});

		socket.on("join_cook", (cookId) => {
			socket.join(`cook_${cookId}`);
		});

		socket.on("join_order", (orderId) => {
			socket.join(`order_${orderId}`);
		});
	});
};

export const getIO = () => io;
