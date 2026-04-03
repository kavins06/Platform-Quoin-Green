"use client";

import { useState } from "react";
import { WizardShell } from "@/components/onboarding/wizard-shell";
import { StepOrg } from "@/components/onboarding/step-org";
import { StepConnect } from "@/components/onboarding/step-connect";
import { StepDone } from "@/components/onboarding/step-done";

export default function OnboardingPage() {
 const [step, setStep] = useState(1);

 function next() {
 setStep((s) => Math.min(s + 1, 3));
 }

 return (
 <WizardShell currentStep={step}>
 {step === 1 && <StepOrg onNext={next} />}
 {step === 2 && <StepConnect onNext={next} onSkip={next} />}
 {step === 3 && <StepDone />}
 </WizardShell>
 );
}
