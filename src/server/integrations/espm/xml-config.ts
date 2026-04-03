import { XMLParser, XMLBuilder } from "fast-xml-parser";

export const espmParser = new XMLParser({
  ignoreAttributes: false,
  parseAttributeValue: true,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (_name: string) => {
    return [
      "metric",
      "meterConsumption",
      "link",
      "monthlyMetric",
      "meter",
      "property",
      "propertyUse",
      "consumptionData",
      "error",
      "reason",
    ].includes(_name);
  },
});

export const espmBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
  suppressEmptyNode: true,
  attributeNamePrefix: "@_",
});
