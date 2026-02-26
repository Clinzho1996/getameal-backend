import { paystack } from "../config/paystack.js";
import Order from "../models/Order.js";

export const refundOrder = async (req, res) => {
	const order = await Order.findById(req.params.id);

	if (order.paymentStatus !== "paid")
		return res.status(400).json({ message: "Not refundable" });

	await paystack.post("/refund", {
		transaction: order.paymentReference,
	});

	order.status = "cancelled";
	await order.save();

	res.json({ message: "Refund initiated" });
};
