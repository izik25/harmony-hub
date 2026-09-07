import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { requestPhoneCode, verifyPhoneCode, type SessionUser } from "@/functions/auth";
import { translateServerError } from "@/lib/i18n";

export function PhoneAuthForm({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const { t } = useTranslation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");

  const sendCode = useMutation({
    mutationFn: () => requestPhoneCode({ data: { phone } }),
    onSuccess: () => setStep("code"),
  });

  const verify = useMutation({
    mutationFn: () => verifyPhoneCode({ data: { phone, code } }),
    onSuccess: (user) => onSuccess(user),
  });

  if (step === "phone") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          sendCode.mutate();
        }}
      >
        <input
          className="input"
          type="tel"
          placeholder={t("auth.phonePlaceholder")}
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          autoComplete="tel"
          required
        />
        {sendCode.isError && (
          <p className="text-sm text-primary">
            {translateServerError((sendCode.error as Error).message)}
          </p>
        )}
        <motion.button
          type="submit"
          disabled={sendCode.isPending}
          whileTap={sendCode.isPending ? undefined : { scale: 0.97 }}
          whileHover={sendCode.isPending ? undefined : { scale: 1.02, y: -1 }}
          transition={{ type: "spring", stiffness: 450, damping: 28 }}
          className="w-full rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral disabled:opacity-60"
        >
          {sendCode.isPending ? "…" : t("auth.sendCode")}
        </motion.button>
      </form>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        verify.mutate();
      }}
    >
      <p className="text-center text-xs text-muted-foreground">
        {t("auth.codeSentTo", { phone })}
      </p>
      <input
        className="input text-center tracking-[0.3em]"
        inputMode="numeric"
        placeholder={t("auth.code")}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        autoComplete="one-time-code"
        maxLength={8}
        required
      />
      {verify.isError && (
        <p className="text-sm text-primary">{translateServerError((verify.error as Error).message)}</p>
      )}
      <motion.button
        type="submit"
        disabled={verify.isPending}
        whileTap={verify.isPending ? undefined : { scale: 0.97 }}
        whileHover={verify.isPending ? undefined : { scale: 1.02, y: -1 }}
        transition={{ type: "spring", stiffness: 450, damping: 28 }}
        className="w-full rounded-full bg-brand-coral py-3 text-sm font-bold text-white shadow-pop-coral disabled:opacity-60"
      >
        {verify.isPending ? "…" : t("auth.verifyCode")}
      </motion.button>
      <button
        type="button"
        onClick={() => {
          setStep("phone");
          setCode("");
        }}
        className="w-full text-center text-xs text-muted-foreground underline"
      >
        {t("auth.changeNumber")}
      </button>
    </form>
  );
}
