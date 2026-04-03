"use client";

import { trpc } from "@/lib/trpc";
import { PortfolioManagerExistingAccountPanel } from "@/components/portfolio-manager/existing-account-panel";

interface StepConnectProps {
  onNext: () => void;
  onSkip: () => void;
}

export function StepConnect({ onNext, onSkip }: StepConnectProps) {
  const onboarding = trpc.building.onboardingStatus.useQuery();
  const canManage = onboarding.data?.operatorAccess.canManage ?? false;

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-semibold tracking-tight text-zinc-900">
        Portfolio Manager
      </h2>
      <PortfolioManagerExistingAccountPanel
        title="Portfolio Manager"
        showOnboardingActions
        canManage={canManage}
        onNext={onNext}
        onSkip={onSkip}
        showHeader={false}
        presentationMode="onboarding"
        usernameLabel="Customer ESPM username"
        saveLabel="Save username"
        refreshLabel="Check connection and shares"
        continueLabel="Continue"
        skipLabel="Do this later"
      />
    </div>
  );
}
