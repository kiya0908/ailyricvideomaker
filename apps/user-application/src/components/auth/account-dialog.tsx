import { Button } from "@workspace/ui/components/button";
import { Avatar, AvatarFallback, AvatarImage } from "@workspace/ui/components/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@workspace/ui/components/dialog";
import { Input } from "@workspace/ui/components/input";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@workspace/ui/components/input-otp";
import { authClient } from "@/lib/auth-client";
import { IconLogout, IconPalette } from "@tabler/icons-react";
import { ThemeToggle } from "@workspace/ui/components/theme-toggle";
import { useState } from "react";

interface AccountDialogProps {
  children: React.ReactNode;
}

export function AccountDialog({ children }: AccountDialogProps) {
  const { data: session } = authClient.useSession();
  const [verificationOtp, setVerificationOtp] = useState("");
  const [verificationOtpSent, setVerificationOtpSent] = useState(false);
  const [isSendingVerificationOtp, setIsSendingVerificationOtp] =
    useState(false);
  const [isVerifyingEmail, setIsVerifyingEmail] = useState(false);
  const [verificationError, setVerificationError] = useState<string | null>(
    null,
  );

  const signOut = async () => {
    await authClient.signOut();
  };

  const sendVerificationOtp = async (email: string) => {
    setVerificationError(null);
    setIsSendingVerificationOtp(true);
    try {
      await authClient.emailOtp.sendVerificationOtp({
        email,
        type: "email-verification",
      });
      setVerificationOtpSent(true);
    } catch (e) {
      setVerificationError(
        e instanceof Error ? e.message : "Failed to send verification code",
      );
    } finally {
      setIsSendingVerificationOtp(false);
    }
  };

  const verifyEmail = async (email: string) => {
    setVerificationError(null);
    setIsVerifyingEmail(true);
    try {
      await authClient.emailOtp.verifyEmail({
        email,
        otp: verificationOtp,
      });
      setVerificationOtp("");
      setVerificationOtpSent(false);
    } catch (e) {
      setVerificationError(
        e instanceof Error ? e.message : "Failed to verify email",
      );
    } finally {
      setIsVerifyingEmail(false);
    }
  };

  if (!session) {
    return null;
  }

  const user = session.user;
  const fallbackText = user.name
    ? user.name.charAt(0).toUpperCase()
    : user.email?.charAt(0).toUpperCase() || "U";

  return (
    <Dialog>
      <DialogTrigger render={children as React.ReactElement} />
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center pb-4">
          <DialogTitle>Account</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col items-center space-y-6 py-6">
          <Avatar className="h-20 w-20">
            <AvatarImage
              src={user.image || undefined}
              alt={user.name || "User"}
            />
            <AvatarFallback className="text-2xl font-semibold">
              {fallbackText}
            </AvatarFallback>
          </Avatar>
          <div className="text-center space-y-1">
            {user.name && (
              <div className="text-lg font-semibold">{user.name}</div>
            )}
            {user.email && (
              <div className="text-sm text-muted-foreground">{user.email}</div>
            )}
          </div>
          <div className="flex flex-col gap-4 w-full mt-6">
            {user.email && !user.emailVerified ? (
              <div className="w-full py-3 px-4 rounded-lg border bg-card space-y-3">
                <div className="text-sm font-medium">Verify your email</div>
                {!verificationOtpSent ? (
                  <Button
                    onClick={() => sendVerificationOtp(user.email!)}
                    variant="outline"
                    size="sm"
                    className="w-full"
                    disabled={isSendingVerificationOtp}
                  >
                    {isSendingVerificationOtp
                      ? "Sending code…"
                      : "Send verification code"}
                  </Button>
                ) : (
                  <>
                    <div className="space-y-2">
                      <div className="text-sm text-muted-foreground">
                        Enter the 6-digit code from your email.
                      </div>
                      <div className="flex justify-center">
                        <InputOTP
                          maxLength={6}
                          value={verificationOtp}
                          onChange={setVerificationOtp}
                          disabled={isVerifyingEmail}
                          aria-label="Email verification code"
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
                      onClick={() => verifyEmail(user.email!)}
                      size="sm"
                      className="w-full"
                      disabled={verificationOtp.length !== 6 || isVerifyingEmail}
                    >
                      {isVerifyingEmail ? "Verifying…" : "Verify email"}
                    </Button>
                    <Button
                      onClick={() => {
                        setVerificationOtpSent(false);
                        setVerificationOtp("");
                        setVerificationError(null);
                      }}
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={isVerifyingEmail}
                    >
                      Cancel
                    </Button>
                  </>
                )}
                {verificationError ? (
                  <div className="text-sm text-destructive">
                    {verificationError}
                  </div>
                ) : null}
              </div>
            ) : null}
            <div className="flex items-center justify-between w-full py-3 px-4 rounded-lg border bg-card">
              <span className="text-sm font-medium flex items-center gap-2">
                <IconPalette className="h-4 w-4" />
                Theme
              </span>
              <ThemeToggle />
            </div>
            <Button
              onClick={signOut}
              variant="outline"
              size="lg"
              className="w-full gap-2"
            >
              <IconLogout className="h-5 w-5" />
              Sign Out
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}