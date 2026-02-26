router.post("/paystack", verifyPaystackSignature, async (req, res) => {
	const event = req.body;

	if (event.event === "charge.success") {
		await handleSuccessfulPayment(event.data);
	}

	if (event.event === "refund.processed") {
		await handleRefund(event.data);
	}

	res.sendStatus(200);
});
