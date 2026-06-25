import { Button } from "@workspace/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp";
import { authClient } from "@/lib/auth-client";
import { useState } from "react";

export function GoogleLogin() {
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [isSendingOtp, setIsSendingOtp] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleSignIn = async () => {
    await authClient.signIn.social({
      provider: "google",
      callbackURL: "/app",
    });
  };

  const handleSendOtp = async () => {
    setError(null);
    setIsSendingOtp(true);
    try {
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "sign-in",
      });
      setOtpSent(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP");
    } finally {
      setIsSendingOtp(false);
    }
  };

  const handleEmailOtpSignIn = async () => {
    setError(null);
    setIsSigningIn(true);
    try {
      await authClient.signIn.emailOtp({
        email,
        otp,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sign in");
    } finally {
      setIsSigningIn(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome back</CardTitle>
          <CardDescription>Sign in to your account to continue</CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleGoogleSignIn}
            className="w-full h-12 text-base"
            variant="outline"
          >
            <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Continue with Google
          </Button>

          <div className="my-6 h-px w-full bg-border" />

          <div className="space-y-3">
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSendingOtp || isSigningIn || otpSent}
              aria-label="Email"
            />

            {!otpSent ? (
              <Button
                onClick={handleSendOtp}
                className="w-full h-12 text-base"
                disabled={!email || isSendingOtp}
              >
                {isSendingOtp ? "Sending code…" : "Send code"}
              </Button>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Enter the 6-digit code we sent to your email.
                  </div>
                  <div className="flex justify-center">
                    <InputOTP
                      maxLength={6}
                      value={otp}
                      onChange={setOtp}
                      disabled={isSigningIn}
                      aria-label="One-time code"
                      autoFocus
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                      </InputOTPGroup>
                      <InputOTPSeparator />
                      <InputOTPGroup>
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                </div>
                <Button
                  onClick={handleEmailOtpSignIn}
                  className="w-full h-12 text-base"
                  disabled={otp.length !== 6 || isSigningIn}
                >
                  {isSigningIn ? "Signing in…" : "Sign in"}
                </Button>
                <Button
                  onClick={() => {
                    setOtpSent(false);
                    setOtp("");
                    setError(null);
                  }}
                  className="w-full"
                  variant="outline"
                  disabled={isSigningIn}
                >
                  Use a different email
                </Button>
              </>
            )}

            {error ? (
              <div className="text-sm text-destructive">{error}</div>
            ) : null}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}