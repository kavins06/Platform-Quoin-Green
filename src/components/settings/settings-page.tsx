"use client";

import React, { useState } from "react";
import { PageHeader } from "@/components/layout/page-header";
import {
  ErrorState,
  EmptyState,
  LoadingState,
  Panel,
  formatDate,
} from "@/components/internal/admin-primitives";
import {
  getGovernedVersionStatusDisplay,
  StatusBadge,
} from "@/components/internal/status-helpers";
import {
  buildFactorGovernanceFamilies,
  buildRuleGovernanceFamilies,
  partitionGovernanceFamilies,
  type GovernanceDisplayFamily,
  type GovernanceDisplayVersion,
} from "@/components/settings/governance-display";
import { EnterpriseGovernancePanel } from "@/components/settings/enterprise-governance-panel";
import { OrganizationManagementPanel } from "@/components/settings/organization-management-panel";
import { PortfolioManagerExistingAccountPanel } from "@/components/portfolio-manager/existing-account-panel";
import { trpc } from "@/lib/trpc";

interface GovernancePanelProps {
  emptyMessage: string;
  families: GovernanceDisplayFamily[];
  subtitle: string;
  title: string;
}

interface GovernanceSectionProps {
  description: string;
  emptyMessage: string;
  families: GovernanceDisplayFamily[];
  title: string;
}

export function SettingsPage() {
  const [showGovernance, setShowGovernance] = useState(false);
  const [showReferenceData, setShowReferenceData] = useState(false);
  const onboarding = trpc.building.onboardingStatus.useQuery();
  const rulePackages = trpc.provenance.rulePackages.useQuery({ activeOnly: true });
  const factorSets = trpc.provenance.factorSetVersions.useQuery({ activeOnly: true });

  if (onboarding.isLoading || rulePackages.isLoading || factorSets.isLoading) {
    return <LoadingState />;
  }

  if (onboarding.error || rulePackages.error || factorSets.error) {
    const error = onboarding.error ?? rulePackages.error ?? factorSets.error;
    return (
      <ErrorState
        message="Settings and governance state are unavailable right now."
        detail={error?.message}
      />
    );
  }

  const ruleFamilies = buildRuleGovernanceFamilies(rulePackages.data ?? []);
  const factorFamilies = buildFactorGovernanceFamilies(factorSets.data ?? []);

  return (
    <div className="space-y-8">
      <PageHeader
        title="Settings"
        subtitle="Keep the basics in order."
        kicker="Workspace"
        variant="portfolio"
        density="compact"
      />

      <div className="grid gap-8">
        <OrganizationManagementPanel />

        <PortfolioManagerExistingAccountPanel
          canManage={onboarding.data?.operatorAccess.canManage ?? false}
          subtitle="Connect Portfolio Manager and keep properties in sync."
        />
      </div>

      <div className="space-y-3 border-t border-zinc-200/80 pt-6">
        <div className="text-sm font-medium text-zinc-500">More settings</div>

        <section className="rounded-[28px] border border-zinc-200/80 bg-white/70">
          <button
            type="button"
            onClick={() => setShowGovernance((value) => !value)}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-zinc-900">Governance tools</div>
              <div className="mt-1 text-sm text-zinc-500">Approvals, runtime, and audit trail.</div>
            </div>
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              {showGovernance ? "Hide" : "Show"}
            </span>
          </button>
          {showGovernance ? (
            <div className="border-t border-zinc-200/80 px-5 py-5">
              <EnterpriseGovernancePanel />
            </div>
          ) : null}
        </section>

        <section className="rounded-[28px] border border-zinc-200/80 bg-white/70">
          <button
            type="button"
            onClick={() => setShowReferenceData((value) => !value)}
            className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left"
          >
            <div>
              <div className="text-sm font-semibold text-zinc-900">Reference data</div>
              <div className="mt-1 text-sm text-zinc-500">Rules and factors used in benchmarking.</div>
            </div>
            <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
              {showReferenceData ? "Hide" : "Show"}
            </span>
          </button>
          {showReferenceData ? (
            <div className="border-t border-zinc-200/80 px-5 py-5">
              <div className="grid gap-6 xl:grid-cols-2">
                <GovernancePanel
                  title="Benchmarking Rules"
                  subtitle="Active rule families."
                  families={ruleFamilies}
                  emptyMessage="No active benchmarking rule families are available."
                />
                <GovernancePanel
                  title="Benchmark Factors & Standards"
                  subtitle="Active factors and standards."
                  families={factorFamilies}
                  emptyMessage="No active benchmarking factor families are available."
                />
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function GovernancePanel({
  emptyMessage,
  families,
  subtitle,
  title,
}: GovernancePanelProps) {
  const groupedFamilies = partitionGovernanceFamilies(families);

  return (
    <Panel title={title} subtitle={subtitle}>
      <div className="space-y-4">
        <GovernanceFamilyList
          families={groupedFamilies.main}
          emptyMessage={emptyMessage}
        />
        <GovernanceSection
          title="Internal records"
          description="Internal trace records."
          families={groupedFamilies.internal}
          emptyMessage="No internal governance records are active."
        />
      </div>
    </Panel>
  );
}

function GovernanceSection({
  description,
  emptyMessage,
  families,
  title,
}: GovernanceSectionProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (families.length === 0) {
    return null;
  }

  return (
    <section className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70">
      <button
        type="button"
        onClick={() => setIsOpen((value) => !value)}
        className="flex w-full items-start justify-between gap-4 px-4 py-4 text-left"
      >
        <div>
          <div className="text-sm font-semibold text-zinc-900">{title}</div>
          <div className="mt-1 text-sm leading-6 text-zinc-600">{description}</div>
        </div>
        <span className="shrink-0 text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
          {isOpen ? "Hide" : "Show"} {families.length}
        </span>
      </button>
      {isOpen ? (
        <div className="border-t border-zinc-200/80 px-4 py-4">
          <GovernanceFamilyList families={families} emptyMessage={emptyMessage} />
        </div>
      ) : null}
    </section>
  );
}

function GovernanceFamilyList({
  emptyMessage,
  families,
}: {
  emptyMessage: string;
  families: GovernanceDisplayFamily[];
}) {
  if (families.length === 0) {
    return <EmptyState message={emptyMessage} />;
  }

  return (
    <div className="space-y-4">
      {families.map((family) => (
        <GovernanceFamilyCard key={family.familyId} family={family} />
      ))}
    </div>
  );
}

function GovernanceFamilyCard({ family }: { family: GovernanceDisplayFamily }) {
  const [showOtherVersions, setShowOtherVersions] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);

  return (
    <article className="rounded-2xl border border-zinc-200/80 bg-white/80 px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-base font-semibold tracking-tight text-zinc-900">
              {family.title}
            </h4>
            {family.badgeLabel ? (
              <span className="rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-600">
                {family.badgeLabel}
              </span>
            ) : null}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600">
            {family.description}
          </p>
        </div>
        <div className="text-sm text-zinc-500">{family.summary}</div>
      </div>

      <div className="mt-4 space-y-3">
        <GovernanceVersionRow version={family.primaryVersion} />
        {family.otherVersions.length > 0 ? (
          <div className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70">
            <button
              type="button"
              onClick={() => setShowOtherVersions((value) => !value)}
              className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left"
            >
              <span className="text-sm font-medium text-zinc-900">
                Other active versions
              </span>
              <span className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
                {showOtherVersions ? "Hide" : "Show"} {family.otherVersions.length}
              </span>
            </button>
            {showOtherVersions ? (
              <div className="space-y-3 border-t border-zinc-200/80 px-4 py-3">
                {family.otherVersions.map((version) => (
                  <GovernanceVersionRow key={version.id} version={version} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mt-4 border-t border-zinc-200/80 pt-4">
        <button
          type="button"
          onClick={() => setShowTechnicalDetails((value) => !value)}
          className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500 transition-colors hover:text-zinc-900"
        >
          {showTechnicalDetails ? "Hide" : "Show"} technical details
        </button>
        {showTechnicalDetails ? <GovernanceTechnicalDetails family={family} /> : null}
      </div>
    </article>
  );
}

function GovernanceVersionRow({ version }: { version: GovernanceDisplayVersion }) {
  const statusDisplay = getGovernedVersionStatusDisplay(version.status);

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-white px-4 py-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-sm font-semibold text-zinc-900">{version.title}</div>
          <div className="mt-1 text-sm text-zinc-600">{version.displayVersionLabel}</div>
        </div>
        <StatusBadge label={statusDisplay.label} tone={statusDisplay.tone} />
      </div>
      <dl className="mt-4 grid gap-3 sm:grid-cols-3">
        <InfoField label="Effective date" value={version.effectiveFrom} />
        <InfoField label="Source" value={version.sourceLabel} />
        <InfoField
          label="Created"
          value={version.createdAt ? formatDate(version.createdAt) : "Not available"}
        />
      </dl>
    </div>
  );
}

function GovernanceTechnicalDetails({ family }: { family: GovernanceDisplayFamily }) {
  return (
    <div className="mt-4 space-y-4">
      {family.versions.map((version) => (
        <div key={version.id} className="rounded-2xl border border-zinc-200/80 bg-zinc-50/70 px-4 py-4">
          <div className="text-xs font-medium uppercase tracking-[0.08em] text-zinc-500">
            {version.title}
          </div>
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            <InfoField label="Rule or factor keys" value={family.rawKeys.join(", ")} />
            <InfoField label="Raw version" value={version.rawVersion} />
            <InfoField label="Raw source" value={version.rawSourceName ?? "Not available"} />
            <InfoField
              label="Source artifact type"
              value={version.sourceArtifactType ?? "Not available"}
            />
          </dl>
          {version.sourceExternalUrl ? (
            <a
              href={version.sourceExternalUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex text-sm font-medium text-zinc-700 underline decoration-zinc-300 underline-offset-4 hover:text-zinc-900"
            >
              Open source record
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-zinc-700">{value}</dd>
    </div>
  );
}
