// src/utils/emailService.js
import { Resend } from "resend";

let resendInstance = null;

const getResendInstance = () => {
	if (!resendInstance) {
		if (!process.env.RESEND_API_KEY) {
			throw new Error("Missing RESEND_API_KEY environment variable");
		}
		resendInstance = new Resend(process.env.RESEND_API_KEY);
	}
	return resendInstance;
};

export const sendOTPEmail = async (email, code) => {
	const resend = getResendInstance();
	const response = await resend.emails.send({
		from: process.env.EMAIL_FROM,
		to: email,
		subject: "Your Getameal OTP Code",
		html: `
      <h2>Getameal Verification</h2>
      <p>Your OTP code is:</p>
      <h1>${code}</h1>
      <p>This code expires in 10 minutes.</p>
    `,
	});

	return response;
};
