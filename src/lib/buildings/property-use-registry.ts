import type { PropertyType } from "@/generated/prisma/client";
import { BEPS_TARGET_SCORES } from "@/lib/buildings/beps-targets";

export const BUILDING_PROPERTY_USE_KEYS = [
  "BANK_BRANCH",
  "FINANCIAL_OFFICE",
  "OFFICE",
  "MULTIFAMILY_HOUSING",
  "RESIDENCE_HALL_DORMITORY",
  "RESIDENTIAL_CARE_FACILITY",
  "SENIOR_LIVING_COMMUNITY",
  "COLLEGE_UNIVERSITY",
  "K12_SCHOOL",
  "PRESCHOOL_DAYCARE",
  "COMMUNITY_CENTER_AND_SOCIAL_MEETING_HALL",
  "CONVENTION_CENTER",
  "MOVIE_THEATER",
  "MUSEUM",
  "PERFORMING_ARTS",
  "BAR_NIGHTCLUB",
  "FAST_FOOD_RESTAURANT",
  "SUPERMARKET_GROCERY_STORE",
  "WHOLESALE_CLUB_SUPERCENTER",
] as const;

export type BuildingPropertyUseKey = (typeof BUILDING_PROPERTY_USE_KEYS)[number];

export type BuildingCommonFieldKey =
  | "occupancyRate"
  | "irrigatedAreaSquareFeet"
  | "numberOfBuildings"
  | "plannedConstructionCompletionYear";

export type PropertyUseFieldKind =
  | "integer"
  | "decimal"
  | "boolean"
  | "text"
  | "enum";

export type PropertyUsePmValueKind =
  | "integer"
  | "decimal"
  | "area"
  | "lengthFeet"
  | "yesNo"
  | "enum"
  | "percentTens"
  | "text";

export type PropertyUseFieldOption = {
  label: string;
  value: string;
};

export type PropertyUseFieldDefinition = {
  key: string;
  label: string;
  description?: string;
  kind: PropertyUseFieldKind;
  pmElement: string;
  pmValueKind: PropertyUsePmValueKind;
  required: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: readonly PropertyUseFieldOption[];
};

export type PropertyUseDefinition = {
  key: BuildingPropertyUseKey;
  label: string;
  coarsePropertyType: Exclude<PropertyType, "MIXED_USE">;
  pmPrimaryFunction: string;
  pmRootTag: string;
  sortOrder: number;
  requiredFields: readonly PropertyUseFieldDefinition[];
  optionalFields: readonly PropertyUseFieldDefinition[];
};

export type BuildingCommonFieldDefinition = {
  key: BuildingCommonFieldKey;
  label: string;
  kind: Extract<PropertyUseFieldKind, "integer" | "decimal">;
  min?: number;
  max?: number;
  step?: number;
  required: false;
};

const YES_NO_OPTIONS = [
  { label: "Yes", value: "Yes" },
  { label: "No", value: "No" },
] as const satisfies readonly PropertyUseFieldOption[];

const PERCENT_TENS_OPTIONS = [
  { label: "0%", value: "0" },
  { label: "10%", value: "10" },
  { label: "20%", value: "20" },
  { label: "30%", value: "30" },
  { label: "40%", value: "40" },
  { label: "50%", value: "50" },
  { label: "60%", value: "60" },
  { label: "70%", value: "70" },
  { label: "80%", value: "80" },
  { label: "90%", value: "90" },
  { label: "100%", value: "100" },
] as const satisfies readonly PropertyUseFieldOption[];

const OFFICE_COOLED_OPTIONS = [
  { label: "50% or more", value: "50% or more" },
  { label: "Less than 50%", value: "Less than 50%" },
  { label: "Not air conditioned", value: "Not Air Conditioned" },
] as const satisfies readonly PropertyUseFieldOption[];

const OFFICE_HEATED_OPTIONS = [
  { label: "50% or more", value: "50% or more" },
  { label: "Less than 50%", value: "Less than 50%" },
  { label: "Not heated", value: "Not Heated" },
] as const satisfies readonly PropertyUseFieldOption[];

const RESIDENT_POPULATION_OPTIONS = [
  { label: "No specific resident population", value: "No specific resident population" },
  { label: "Dedicated student", value: "Dedicated Student" },
  { label: "Dedicated military", value: "Dedicated Military" },
  {
    label: "Dedicated senior/independent living",
    value: "Dedicated Senior/Independent Living",
  },
  {
    label: "Dedicated special accessibility needs",
    value: "Dedicated Special Accessibility Needs",
  },
  { label: "Other dedicated housing", value: "Other dedicated housing" },
] as const satisfies readonly PropertyUseFieldOption[];

const ANNUAL_RESEARCH_EXPENDITURE_OPTIONS = [
  { label: "Less than 2.5 million", value: "Less than 2.5 million" },
  { label: "2.5 million to 5 million", value: "2.5 million to 5 million" },
  { label: "5 million to 50 million", value: "5 million to 50 million" },
  { label: "Greater than 50 million", value: "Greater than 50 million" },
] as const satisfies readonly PropertyUseFieldOption[];

const HIGHEST_AWARD_LEVEL_OPTIONS = [
  { label: "Doctoral Degree", value: "Doctoral Degree" },
  { label: "Master's Degree", value: "Master's Degree" },
  { label: "Bachelor's Degree", value: "Bachelor's Degree" },
  {
    label: "Associate's degree or other 2-3 year program",
    value: "Associate's degree or other 2-3 year program",
  },
  {
    label: "Other program less than 2 years",
    value: "Other program less than 2 years",
  },
] as const satisfies readonly PropertyUseFieldOption[];

const COMMON_BUILDING_FIELD_DEFINITIONS = [
  {
    key: "occupancyRate",
    label: "Occupancy rate (%)",
    kind: "decimal",
    min: 0,
    max: 100,
    step: 0.1,
    required: false,
  },
  {
    key: "irrigatedAreaSquareFeet",
    label: "Irrigated area (sq ft)",
    kind: "integer",
    min: 0,
    step: 1,
    required: false,
  },
  {
    key: "numberOfBuildings",
    label: "Number of buildings",
    kind: "integer",
    min: 1,
    step: 1,
    required: false,
  },
  {
    key: "plannedConstructionCompletionYear",
    label: "Planned construction completion year",
    kind: "integer",
    min: 1800,
    max: 2100,
    step: 1,
    required: false,
  },
] as const satisfies readonly BuildingCommonFieldDefinition[];

function integerField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  options?: Pick<PropertyUseFieldDefinition, "description" | "min" | "max">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "integer",
    pmElement,
    pmValueKind: "integer",
    required,
    step: 1,
    ...options,
  };
}

function decimalField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  options?: Pick<PropertyUseFieldDefinition, "description" | "min" | "max" | "step">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "decimal",
    pmElement,
    pmValueKind: "decimal",
    required,
    step: 0.1,
    ...options,
  };
}

function areaField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  options?: Pick<PropertyUseFieldDefinition, "description" | "min" | "max">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "integer",
    pmElement,
    pmValueKind: "area",
    required,
    min: 0,
    step: 1,
    ...options,
  };
}

function lengthFeetField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  options?: Pick<PropertyUseFieldDefinition, "description" | "min" | "max" | "step">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "decimal",
    pmElement,
    pmValueKind: "lengthFeet",
    required,
    min: 0,
    step: 0.1,
    ...options,
  };
}

function textField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  options?: Pick<PropertyUseFieldDefinition, "description">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "text",
    pmElement,
    pmValueKind: "text",
    required,
    ...options,
  };
}

function booleanField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  options?: Pick<PropertyUseFieldDefinition, "description">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "boolean",
    pmElement,
    pmValueKind: "yesNo",
    required,
    options: YES_NO_OPTIONS,
    ...options,
  };
}

function enumField(
  key: string,
  label: string,
  pmElement: string,
  required: boolean,
  fieldOptions: readonly PropertyUseFieldOption[],
  pmValueKind: Extract<PropertyUsePmValueKind, "enum" | "percentTens"> = "enum",
  options?: Pick<PropertyUseFieldDefinition, "description">,
): PropertyUseFieldDefinition {
  return {
    key,
    label,
    kind: "enum",
    pmElement,
    pmValueKind,
    required,
    options: fieldOptions,
    ...options,
  };
}

const OFFICE_CORE_FIELDS = [
  decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", true, {
    min: 0,
    max: 168,
  }),
  integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", true, {
    min: 0,
  }),
  integerField("numberOfComputers", "Number of computers", "numberOfComputers", true, {
    min: 0,
  }),
  enumField(
    "percentThatCanBeCooled",
    "Percent that can be cooled",
    "percentOfficeCooled",
    true,
    OFFICE_COOLED_OPTIONS,
  ),
] as const satisfies readonly PropertyUseFieldDefinition[];

const OFFICE_OPTIONAL_FIELDS = [
  enumField(
    "percentThatCanBeHeated",
    "Percent that can be heated",
    "percentOfficeHeated",
    false,
    OFFICE_HEATED_OPTIONS,
  ),
] as const satisfies readonly PropertyUseFieldDefinition[];

function toOtherTypeRootTag(useKey: BuildingPropertyUseKey) {
  switch (useKey) {
    case "CONVENTION_CENTER":
      return "conventionCenter";
    case "MOVIE_THEATER":
      return "movieTheater";
    case "PERFORMING_ARTS":
      return "performingArts";
    case "BAR_NIGHTCLUB":
      return "barNightclub";
    default:
      return "other";
  }
}

function createOtherTypeDefinition(
  key: BuildingPropertyUseKey,
  label: string,
  coarsePropertyType: Exclude<PropertyType, "MIXED_USE">,
  sortOrder: number,
): PropertyUseDefinition {
  return {
    key,
    label,
    coarsePropertyType,
    pmPrimaryFunction: label,
    pmRootTag: toOtherTypeRootTag(key),
    sortOrder,
    requiredFields: [],
    optionalFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", false, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
    ],
  };
}

export const PROPERTY_USE_REGISTRY = {
  BANK_BRANCH: {
    key: "BANK_BRANCH",
    label: "Bank Branch",
    coarsePropertyType: "OFFICE",
    pmPrimaryFunction: "Bank Branch",
    pmRootTag: "bankBranch",
    sortOrder: 10,
    requiredFields: OFFICE_CORE_FIELDS,
    optionalFields: OFFICE_OPTIONAL_FIELDS,
  },
  FINANCIAL_OFFICE: {
    key: "FINANCIAL_OFFICE",
    label: "Financial Office",
    coarsePropertyType: "OFFICE",
    pmPrimaryFunction: "Financial Office",
    pmRootTag: "financialOffice",
    sortOrder: 20,
    requiredFields: OFFICE_CORE_FIELDS,
    optionalFields: OFFICE_OPTIONAL_FIELDS,
  },
  OFFICE: {
    key: "OFFICE",
    label: "Office",
    coarsePropertyType: "OFFICE",
    pmPrimaryFunction: "Office",
    pmRootTag: "office",
    sortOrder: 30,
    requiredFields: OFFICE_CORE_FIELDS,
    optionalFields: OFFICE_OPTIONAL_FIELDS,
  },
  MULTIFAMILY_HOUSING: {
    key: "MULTIFAMILY_HOUSING",
    label: "Multifamily Housing",
    coarsePropertyType: "MULTIFAMILY",
    pmPrimaryFunction: "Multifamily Housing",
    pmRootTag: "multifamilyHousing",
    sortOrder: 40,
    requiredFields: [
      integerField(
        "totalResidentialUnits",
        "Total living units",
        "numberOfResidentialLivingUnits",
        true,
      ),
      integerField(
        "lowRiseUnits",
        "Low-rise units (1-4 stories)",
        "numberOfResidentialLivingUnitsLowRiseSetting",
        true,
      ),
      integerField(
        "midRiseUnits",
        "Mid-rise units (5-9 stories)",
        "numberOfResidentialLivingUnitsMidRiseSetting",
        true,
      ),
      integerField(
        "highRiseUnits",
        "High-rise units (10+ stories)",
        "numberOfResidentialLivingUnitsHighRiseSetting",
        true,
      ),
      integerField("numberOfBedrooms", "Number of bedrooms", "numberOfBedrooms", true),
    ],
    optionalFields: [
      booleanField("commonEntrance", "Common entrance", "commonEntrance", false),
      enumField(
        "residentPopulation",
        "Resident population type",
        "residentPopulation",
        false,
        RESIDENT_POPULATION_OPTIONS,
      ),
      booleanField(
        "governmentSubsidizedHousing",
        "Government subsidized housing",
        "governmentSubsidizedHousing",
        false,
      ),
      integerField(
        "laundryHookupsInAllUnits",
        "Laundry hookups in all units",
        "numberOfLaundryHookupsInAllUnits",
        false,
      ),
      integerField(
        "laundryHookupsInCommonAreas",
        "Laundry hookups in common areas",
        "numberOfLaundryHookupsInCommonArea",
        false,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
  },
  RESIDENCE_HALL_DORMITORY: {
    key: "RESIDENCE_HALL_DORMITORY",
    label: "Residence Hall / Dormitory",
    coarsePropertyType: "MULTIFAMILY",
    pmPrimaryFunction: "Residence Hall/Dormitory",
    pmRootTag: "residenceHallDormitory",
    sortOrder: 50,
    requiredFields: [
      integerField("numberOfRooms", "Number of rooms", "numberOfRooms", true),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
    optionalFields: [
      booleanField("hasComputerLab", "Computer lab", "hasComputerLab", false),
      booleanField("hasDiningHall", "Dining hall", "hasDiningHall", false),
    ],
  },
  RESIDENTIAL_CARE_FACILITY: {
    key: "RESIDENTIAL_CARE_FACILITY",
    label: "Residential Care Facility",
    coarsePropertyType: "MULTIFAMILY",
    pmPrimaryFunction: "Residential Care Facility",
    pmRootTag: "residentialCareFacility",
    sortOrder: 60,
    requiredFields: [],
    optionalFields: [
      decimalField(
        "maximumResidentCapacity",
        "Maximum resident capacity",
        "maximumResidentCapacity",
        false,
      ),
      decimalField(
        "averageNumberOfResidents",
        "Average number of residents",
        "averageNumberOfResidents",
        false,
      ),
      integerField(
        "totalResidentialUnits",
        "Total residential living units",
        "numberOfResidentialLivingUnits",
        false,
      ),
      decimalField("licensedBedCapacity", "Licensed bed capacity", "licensedBedCapacity", false),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      integerField(
        "residentialWashingMachines",
        "Residential washing machines",
        "numberOfResidentialWashingMachines",
        false,
      ),
      integerField(
        "commercialWashingMachines",
        "Commercial washing machines",
        "numberOfCommercialWashingMachines",
        false,
      ),
      integerField(
        "residentialElectronicLiftSystems",
        "Residential electronic lift systems",
        "numberOfResidentialLiftSystems",
        false,
      ),
      integerField(
        "commercialRefrigerationFreezerUnits",
        "Commercial refrigeration/freezer units",
        "numberOfCommercialRefrigerationUnits",
        false,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
  },
  SENIOR_LIVING_COMMUNITY: {
    key: "SENIOR_LIVING_COMMUNITY",
    label: "Senior Living Community",
    coarsePropertyType: "MULTIFAMILY",
    pmPrimaryFunction: "Senior Living Community",
    pmRootTag: "seniorLivingCommunity",
    sortOrder: 70,
    requiredFields: [
      decimalField(
        "maximumResidentCapacity",
        "Maximum resident capacity",
        "maximumResidentCapacity",
        true,
      ),
      decimalField(
        "averageNumberOfResidents",
        "Average number of residents",
        "averageNumberOfResidents",
        true,
      ),
      integerField(
        "totalResidentialUnits",
        "Total residential living units",
        "numberOfResidentialLivingUnits",
        true,
      ),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", true),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", true),
      integerField(
        "residentialWashingMachines",
        "Residential washing machines",
        "numberOfResidentialWashingMachines",
        true,
      ),
      integerField(
        "commercialWashingMachines",
        "Commercial washing machines",
        "numberOfCommercialWashingMachines",
        true,
      ),
      integerField(
        "residentialElectronicLiftSystems",
        "Residential electronic lift systems",
        "numberOfResidentialLiftSystems",
        true,
      ),
      integerField(
        "commercialRefrigerationFreezerUnits",
        "Commercial refrigeration/freezer units",
        "numberOfCommercialRefrigerationUnits",
        true,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
    optionalFields: [
      decimalField("licensedBedCapacity", "Licensed bed capacity", "licensedBedCapacity", false),
    ],
  },
  COLLEGE_UNIVERSITY: {
    key: "COLLEGE_UNIVERSITY",
    label: "College / University",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "College/University",
    pmRootTag: "collegeUniversity",
    sortOrder: 80,
    requiredFields: [],
    optionalFields: [
      integerField(
        "fullTimeStudentsSepToDec",
        "Full-time students enrolled (September-December)",
        "numberOfFullTimeStudentsEnrolledSeptemberToDecember",
        false,
      ),
      integerField(
        "fullTimeStudentsJanToApr",
        "Full-time students enrolled (January-April)",
        "numberOfFullTimeStudentsEnrolledJanuaryToApril",
        false,
      ),
      integerField(
        "fullTimeStudentsMayToAug",
        "Full-time students enrolled (May-August)",
        "numberOfFullTimeStudentsEnrolledMayToAugust",
        false,
      ),
      enumField(
        "annualResearchExpenditure",
        "Annual research expenditure",
        "annualResearchExpenditure",
        false,
        ANNUAL_RESEARCH_EXPENDITURE_OPTIONS,
      ),
      integerField(
        "percentFloorAreaLaboratory",
        "Percent floor area that is laboratory",
        "percentOfLabFloorArea",
        false,
        { min: 0, max: 100 },
      ),
      enumField(
        "highestAwardLevel",
        "Highest level of award",
        "highestAwardLevel",
        false,
        HIGHEST_AWARD_LEVEL_OPTIONS,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", false, {
        min: 0,
        max: 168,
      }),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      decimalField("enrollment", "Enrollment", "enrollment", false),
      decimalField("numberOfFteWorkers", "Number of FTE workers", "numberOfFTEWorkers", false),
      decimalField("grantDollars", "Grant dollars", "grantDollars", false),
    ],
  },
  K12_SCHOOL: {
    key: "K12_SCHOOL",
    label: "K-12 School",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "K-12 School",
    pmRootTag: "k12School",
    sortOrder: 90,
    requiredFields: [
      booleanField("isHighSchool", "Is this a high school?", "isHighSchool", true),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", true),
      booleanField("openOnWeekends", "Open on weekends?", "openOnWeekends", true),
      booleanField("cookingFacilities", "Cooking on-site?", "cookingFacilities", true),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
    optionalFields: [
      integerField(
        "studentSeatingCapacity",
        "Student seating capacity",
        "studentSeatingCapacity",
        false,
      ),
      integerField("monthsInUse", "Months in use", "monthsInUse", false, {
        min: 1,
        max: 12,
      }),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      areaField(
        "grossFloorAreaUsedForFoodPreparation",
        "Gross floor area used for food preparation",
        "grossFloorAreaUsedForFoodPreparation",
        false,
      ),
      integerField(
        "numberOfWalkInRefrigerationUnits",
        "Walk-in refrigeration/freezer units",
        "numberOfWalkInRefrigerationUnits",
        false,
      ),
      areaField("gymnasiumFloorArea", "Gymnasium floor area", "gymnasiumFloorArea", false),
      textField("schoolDistrict", "School district", "schoolDistrict", false),
    ],
  },
  PRESCHOOL_DAYCARE: {
    key: "PRESCHOOL_DAYCARE",
    label: "Pre-school / Daycare",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "Pre-school/Daycare",
    pmRootTag: "preschoolDaycare",
    sortOrder: 100,
    requiredFields: [],
    optionalFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", false, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      areaField(
        "grossFloorAreaUsedForFoodPreparation",
        "Gross floor area used for food preparation",
        "grossFloorAreaUsedForFoodPreparation",
        false,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
  },
  COMMUNITY_CENTER_AND_SOCIAL_MEETING_HALL: {
    key: "COMMUNITY_CENTER_AND_SOCIAL_MEETING_HALL",
    label: "Community Center and Social Meeting Hall",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "Community Center and Social Meeting Hall",
    pmRootTag: "communityCenterAndSocialMeetingHall",
    sortOrder: 110,
    requiredFields: [],
    optionalFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", false, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
  },
  CONVENTION_CENTER: createOtherTypeDefinition(
    "CONVENTION_CENTER",
    "Convention Center",
    "OTHER",
    120,
  ),
  MOVIE_THEATER: createOtherTypeDefinition("MOVIE_THEATER", "Movie Theater", "OTHER", 130),
  MUSEUM: {
    key: "MUSEUM",
    label: "Museum",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "Museum",
    pmRootTag: "museum",
    sortOrder: 140,
    requiredFields: [],
    optionalFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", false, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      booleanField(
        "precisionTemperatureHumidityControls",
        "Precision controls for temperature and humidity",
        "precisionControlsForTemperatureAndHumidity",
        false,
      ),
      areaField(
        "grossFloorAreaExhibitSpace",
        "Gross floor area that is exhibit space",
        "grossFloorAreaThatIsExhibitSpace",
        false,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
  },
  PERFORMING_ARTS: createOtherTypeDefinition("PERFORMING_ARTS", "Performing Arts", "OTHER", 150),
  BAR_NIGHTCLUB: createOtherTypeDefinition("BAR_NIGHTCLUB", "Bar / Nightclub", "OTHER", 160),
  FAST_FOOD_RESTAURANT: {
    key: "FAST_FOOD_RESTAURANT",
    label: "Fast Food Restaurant",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "Fast Food Restaurant",
    pmRootTag: "fastFoodRestaurant",
    sortOrder: 170,
    requiredFields: [],
    optionalFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", false, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      lengthFeetField(
        "lengthOfCommercialKitchenHoods",
        "Length of all commercial kitchen hoods (ft)",
        "lengthOfAllCommercialKitchenHoods",
        false,
      ),
      booleanField(
        "exteriorEntranceToPublic",
        "Public entrance from outside?",
        "exteriorEntranceToThePublic",
        false,
      ),
      booleanField("cookingLocatedOnsite", "Cooking on-site?", "cookingLocatedOnsite", false),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        false,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
  },
  SUPERMARKET_GROCERY_STORE: {
    key: "SUPERMARKET_GROCERY_STORE",
    label: "Supermarket / Grocery Store",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "Supermarket/Grocery Store",
    pmRootTag: "supermarket",
    sortOrder: 180,
    requiredFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", true, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", true),
      integerField(
        "openClosedRefrigerationUnits",
        "Open or closed refrigeration/freezer units",
        "numberOfOpenClosedRefrigerationUnits",
        true,
      ),
      integerField(
        "walkInRefrigerationUnits",
        "Walk-in refrigeration/freezer units",
        "numberOfWalkInRefrigerationUnits",
        true,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
    optionalFields: [
      integerField("cashRegisters", "Number of cash registers", "numberOfCashRegisters", false),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      lengthFeetField(
        "lengthOfOpenClosedRefrigerationUnits",
        "Length of open or closed refrigeration/freezer units (ft)",
        "lengthOfAllOpenClosedRefrigerationUnits",
        false,
      ),
      areaField(
        "areaOfWalkInRefrigerationUnits",
        "Area of walk-in refrigeration/freezer units (sq ft)",
        "areaOfAllWalkInRefrigerationUnits",
        false,
      ),
      booleanField("cookingFacilities", "Cooking facilities", "cookingFacilities", false),
    ],
  },
  WHOLESALE_CLUB_SUPERCENTER: {
    key: "WHOLESALE_CLUB_SUPERCENTER",
    label: "Wholesale Club / Supercenter",
    coarsePropertyType: "OTHER",
    pmPrimaryFunction: "Wholesale Club/Supercenter",
    pmRootTag: "wholesaleClubSupercenter",
    sortOrder: 190,
    requiredFields: [
      decimalField("weeklyOperatingHours", "Weekly operating hours", "weeklyOperatingHours", true, {
        min: 0,
        max: 168,
      }),
      integerField("workersOnMainShift", "Workers on main shift", "numberOfWorkers", true),
      integerField(
        "openClosedRefrigerationUnits",
        "Open or closed refrigeration/freezer units",
        "numberOfOpenClosedRefrigerationUnits",
        true,
      ),
      integerField(
        "walkInRefrigerationUnits",
        "Walk-in refrigeration/freezer units",
        "numberOfWalkInRefrigerationUnits",
        true,
      ),
      booleanField("singleStore", "Single store?", "singleStore", true),
      booleanField(
        "exteriorEntranceToPublic",
        "Public entrance from outside?",
        "exteriorEntranceToThePublic",
        true,
      ),
      enumField(
        "percentThatCanBeHeated",
        "Percent that can be heated",
        "percentHeated",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
      enumField(
        "percentThatCanBeCooled",
        "Percent that can be cooled",
        "percentCooled",
        true,
        PERCENT_TENS_OPTIONS,
        "percentTens",
      ),
    ],
    optionalFields: [
      lengthFeetField(
        "lengthOfOpenClosedRefrigerationUnits",
        "Length of open or closed refrigeration/freezer units (ft)",
        "lengthOfAllOpenClosedRefrigerationUnits",
        false,
      ),
      areaField(
        "areaOfWalkInRefrigerationUnits",
        "Area of walk-in refrigeration/freezer units (sq ft)",
        "areaOfAllWalkInRefrigerationUnits",
        false,
      ),
      integerField("numberOfComputers", "Number of computers", "numberOfComputers", false),
      integerField("cashRegisters", "Number of cash registers", "numberOfCashRegisters", false),
      booleanField("cookingFacilities", "Cooking facilities", "cookingFacilities", false),
    ],
  },
} as const satisfies Record<BuildingPropertyUseKey, PropertyUseDefinition>;

export const BUILDING_COMMON_FIELD_DEFINITIONS = COMMON_BUILDING_FIELD_DEFINITIONS;

export function listPropertyUseDefinitions() {
  return BUILDING_PROPERTY_USE_KEYS.map((key) => PROPERTY_USE_REGISTRY[key]).sort(
    (left, right) => left.sortOrder - right.sortOrder,
  );
}

export function getPropertyUseDefinition(useKey: BuildingPropertyUseKey) {
  return PROPERTY_USE_REGISTRY[useKey];
}

export function getAllPropertyUseFields(useKey: BuildingPropertyUseKey) {
  const definition = getPropertyUseDefinition(useKey);
  return [...definition.requiredFields, ...definition.optionalFields];
}

export function getPropertyUseFieldDefinition(
  useKey: BuildingPropertyUseKey,
  fieldKey: string,
) {
  return getAllPropertyUseFields(useKey).find((field) => field.key === fieldKey) ?? null;
}

export function deriveBuildingPropertyTypeFromUses(useKeys: readonly BuildingPropertyUseKey[]) {
  if (useKeys.length === 0) {
    return "OTHER" as const;
  }

  if (useKeys.length > 1) {
    return "MIXED_USE" as const;
  }

  return getPropertyUseDefinition(useKeys[0]).coarsePropertyType;
}

export function derivePrimaryFunctionFromUses(useKeys: readonly BuildingPropertyUseKey[]) {
  if (useKeys.length === 0) {
    return null;
  }

  if (useKeys.length > 1) {
    return "Mixed Use Property";
  }

  return getPropertyUseDefinition(useKeys[0]).pmPrimaryFunction;
}

function normalizePmPrimaryFunction(value: string | null | undefined) {
  return value?.trim().toLowerCase().replaceAll(/\s+/g, " ") ?? "";
}

export function findPropertyUseKeyByPrimaryFunction(primaryFunction: string | null | undefined) {
  const normalized = normalizePmPrimaryFunction(primaryFunction);
  if (!normalized) {
    return null;
  }

  for (const useKey of BUILDING_PROPERTY_USE_KEYS) {
    const definition = getPropertyUseDefinition(useKey);
    if (normalizePmPrimaryFunction(definition.pmPrimaryFunction) === normalized) {
      return useKey;
    }
  }

  return null;
}

export function deriveBenchmarkTargetScoreFromUses(
  useKeys: readonly BuildingPropertyUseKey[],
) {
  const propertyType = deriveBuildingPropertyTypeFromUses(useKeys);
  return BEPS_TARGET_SCORES[propertyType] ?? 50;
}

export function buildDefaultPropertyUseDisplayName(
  buildingName: string,
  useKey: BuildingPropertyUseKey,
) {
  const label = getPropertyUseDefinition(useKey).label;
  return `${buildingName} ${label}`;
}
