-- Sprint 4: canonical BEPS filing record key

CREATE UNIQUE INDEX "filing_records_building_id_filing_type_filing_year_compliance_cycle_key"
ON "filing_records"("building_id", "filing_type", "filing_year", "compliance_cycle");
