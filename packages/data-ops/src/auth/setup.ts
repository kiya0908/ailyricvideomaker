import { betterAuth, type BetterAuthOptions } from "better-auth";
import { emailOTP } from "better-auth/plugins";

export const createBetterAuth = (config: {
  database: BetterAuthOptions["database"];
  secret?: BetterAuthOptions["secret"];
  socialProviders?: BetterAuthOptions["socialProviders"];
}): ReturnType<typeof betterAuth> => {
  return betterAuth({
    database: config.database,
    secret: config.secret,
    emailAndPassword: {
      enabled: false,
    },
    plugins: [
      emailOTP({
        overrideDefaultEmailVerification: true,
        sendVerificationOTP: async ({ email, otp, type }) => {
          // Minimal dev implementation: log OTP to worker logs.
          // Replace with a real email provider (Resend/Postmark/etc.) before production.
          console.log(`[better-auth][email-otp] type=${type} email=${email} otp=${otp}`);
        },
      }),
    ],
    socialProviders: config.socialProviders,
    user: {
      modelName: "auth_user",
    },
    session: {
      modelName: "auth_session",
    },
    verification: {
      modelName: "auth_verification",
    },
    account: {
      modelName: "auth_account",
    },
  });
};
