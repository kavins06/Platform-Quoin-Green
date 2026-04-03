


## Testing Web Services  Page 1

## Testing Web Services
## Web Services
## January 2025

## Introduction
This document is designed to help you test the exchange of data with EPA’s Portfolio Manager
via web services. Portfolio Manager is the industry standard for benchmarking energy
performance, with approximately 350,000 buildings benchmarked each year and new accounts
and property records added every day.

To learn more about Portfolio Manager and the associated web services, visit
http://portfoliomanager.energystar.gov/webservices. Use this document to learn how you can
begin testing our suite of web services to interact with Portfolio Manager.

There is a companion video tutorial that walks through the testing procedures outlined in this
document. The full video can be viewed here and there are timestamps to specific sections
noted in bold throughout this document. Click on the timestamps throughout this document to
refer to a specific section of the online video.
## 1


Testing Tools and Requirements (Video starts at 00:00:06)
Before you begin testing, you need to make sure you have the right tools. In particular:

- Basic System and Software Requirements – Portfolio Manager uses Representational
State Transfer (REST)-based web services. This allows you to choose any programming
language that supports the HTTP protocol to develop your implementation.

- Sending Data to Portfolio Manager – Web services are intended to facilitate software-to-
software communication. Therefore, when you are testing or using web services, you will
typically use your own custom software to send calls directly to (and receive responses
from) Portfolio Manager. Because the primary use case is automated transmission, EPA
does not have its own custom REST client or submission window. However, when you
are beginning testing, you may find it useful to submit individual XML files manually. If
you are interested in manual submission, you can use one of any number of free REST
clients available in the market (e.g., Postman).

- Preparing XML Schema – Although it is not required, we strongly suggest that you use
an XML editor to help author your XML requests. This will help you ensure that data is
correctly formatted so that your calls will succeed.


## 1
Not all sections of this guidance will have corresponding video timestamps. Additionally, if you view the
entire video (which was created in 2020), you may encounter certain sections that are no longer relevant
due to the December 2024 launch of the Test UI. Specifically, any video content related to the use of the
POST /account call in Section A, as well as the use of Test API calls to simulate Connection and Share
requests in Section C, should be considered outdated and superseded by the guidance in the January
2025 version of this “Testing Web Services” document.


## Testing Web Services  Page 2
## Web Services
## Testing Overview
The web services Test environment (base URL: https://portfoliomanager.energystar.gov/wstest/)
is designed to help you test the Portfolio Manager API prior to establishing the production
instance of your integration. EPA offers a test server, with which you can exchange data via the
full suite of web services. This will help you to build the correct calls and logs into your software.

As of December 2024, the Test environment is accompanied by a Test version of the Portfolio
Manager user interface (UI). This allows you to develop and test your API integration using the
same workflows that take place in the Live environment (for example, the initiation of
Connection and Sharing requests by a Portfolio Manager user, discussed further in Testing Part
C below).

The first step for any organization interested in exchanging data with Portfolio Manager will be
to create a test provider account. As of December 2024, when the Test user interface (“Test UI”)
was first made available, creation of test accounts must take place via the Portfolio Manager
Test UI, available at https://portfoliomanager.energystar.gov/pmtest (for further details see
Testing Part A, below). Once your account is created, your next step will depend on which web
services you need to test, based on your use case. There are two primary use cases:

- Set up new accounts, properties, and/or meters for your customers. This scenario will
typically apply to third-party utility bill management companies, providers of energy
information services, and other software providers (e.g., ESG or sustainability reporting
platforms). These organizations frequently collect both property and meter data and can
push this information into Portfolio Manager to help customers receive the ENERGY
STAR score and other metrics. If you are looking to perform this type of service, your
next step will be to test the creation of customer accounts, properties, and meters. This
is covered in Testing Part B, below.

- Limited data exchange with existing property records. This scenario will typically apply to
utilities, who will be authorized by a customer to send utility data to the customer’s
property record. This use case could also apply to organizations developing “GET-only”
integrations to extract data from existing Portfolio Manager records for the purpose of
reports, dashboards, and/or additional value-added data analysis. In such cases you will
need to use the Test environment to work through the process flow by which customers
initiate Connection requests, which are then accepted by the API user/web service
provider. After you accept the Connection, the test customer account will initiate
Property and Meter Share requests to your test provider account. These share requests
are the way in which your customer will authorize you to manage data for a property or
meter. In the Test environment, you will have the opportunity to accept or reject each
property or meter share request, just as you would in the Live environment. Refer to
Testing Part C, below, for more information on testing these share features.

When you are using the Test environment, you can create as many accounts and properties as
you need for testing. However, the purpose of testing is to help you build your software; it is not
intended for production-level volume testing. The rate limit for the Test environment is
intentionally set low to allow providers to more easily test/verify their error handling and retry
logic. For more information about rate limits, please see the Frequently Asked Question (FAQ):
Rate limits for web service requests.


## Testing Web Services  Page 3
## Web Services

Once you have completed your testing, you will be ready to move to the Live environment. To
begin exchanging data with Portfolio Manager in the Live environment, you will need approval
from EPA. Within your Account Settings in Portfolio Manager (see the “Software Development”
tab), there is an online form you will complete to request EPA approval to use the API in the
Live environment. Please note that none of the data you have entered into the Test environment
will be migrated into the Portfolio Manager Live environment.

Testing Part A: Create an Account

Prior to December 2024, creation of test accounts was performed via a Test-only API call. This
was due to the lack of a Test UI through which account creation could be performed. With the
launch of the Test UI in December 2024, creation of all new test accounts (e.g., a test “provider”
account; one or more test “customer” accounts) must take place via the Portfolio Manager Test
UI using the same “Create a New Account” workflow that is available in the Live/Production UI.
Any test accounts (whether “provider” or “customer”) that were created via the Test API
prior to the launch of the Test UI will still be available; however, you will need the login
credentials that you originally defined when you set up your Test account(s). If you don’t have
these, the best approach would be to create a new account in the Test environment.

As with the Live/Production environment, anyone can set up a new account in the Test
environment and begin using it to test their benchmarking processes. Test accounts that will be
used to represent sample customer accounts do not need to take further action before
properties can be created within these accounts. Test accounts that will be used to represent
the API user/web service provider account must take the further step of enabling account-level
API access. To do this:

- Log in to your Test “API user” account (via the Portfolio Manager Test UI login page) and
click on “Account Settings” at the top of the page.
- From the subsequent “Edit Account” page, select the “Software Development” tab.
- On the “Software Development” tab, select “Yes” for the question “Will this account be
used to test web services in the Test environment?” Additional text will appear below.
- At the bottom of the screen, click the button labeled “Start Using the Test Environment.”
- You will then be taken to another page, where you will be asked to make certain
selections about your Web Services settings. At this stage, it is recommended that you
indicate that you will be supporting data exchange for all energy meter types – but
please note that any selections you make here can be easily updated in the future via
your “Account Settings” in the Test UI.
- Click “Submit” and your Test account will be immediately registered and approved for
API access.
- Begin working with the Test API and use the Test UI to immediately validate the impact
of these calls on the corresponding record(s).
Once you have created a Test provider account and enabled API access, you can manage
certain account settings via the UI and/or the API as needed. As part of the Test API, there is a


## Testing Web Services  Page 4
## Web Services
service for managing account settings, including updating your terms and conditions and
specifying the fuel types that you support (Video starts at 00:10:42).

The following example shows how you would update your data exchange settings through web
services. Please note that for this, and for all other API calls discussed in this document,
the user will be responsible for configuring their REST client to pass Basic authorization
credentials (i.e., the username and password of the Test Portfolio Manager account for which
you have requested API access). The authorization header is omitted from all of the “Sample
XML” text boxes below.

Sample XML 1
PUT /dataExchangeSettings

<dataExchangeSettings>
<termsOfUse>
<text>Terms and Conditions:  You may use the ACME's services to
interface with EPA's Data Exchange Platform only if you are a
customer of ACME and agree to the detailed Terms and Conditions
set forth on our company's website.</text>
</termsOfUse>
<supportedMeterTypes>
<meterType>Electric</meterType>
<meterType>Municipally Supplied Potable Water - Indoor</meterType>
<meterType>Disposed - Trash</meterType>
</supportedMeterTypes>
</dataExchangeSettings>

You can also retrieve your data exchange settings to verify that your updates were
successful.

Sample XML 2
GET /dataExchangeSettings

Testing Part B: Creating Customer Accounts, Properties, and Meters

If you plan to set up accounts, properties, and/or meters for your customers, this is the next
step, as these test services will be identical to what you will ultimately use in the Live
environment.

If you are an organization that primarily updates meter consumption data within existing
property records, you will likely not need to use most of these services in the Live environment
(with the exception of the POST /consumptionData call described below). However, you may
opt to use these calls to facilitate the population of sample data in the Test environment. Such
organizations may also wish to review the two “Create Sample Properties” calls in the Property
Services category of the Test API.

We recommend that you test the following web services:

- Create Customer Accounts (Video starts at 00:14:37). There is a set of services that
will enable you to create Portfolio Manager accounts on behalf of your customers. These
services will include POST, GET, and PUT methods, which allow you to create the
customer, retrieve their information, and edit their information, respectively. There is no
ability to delete a Portfolio Manager account via API once it has been created.


## Testing Web Services  Page 5
## Web Services

To create a customer account, use this call:
Sample XML 3
POST /customer

## <account>
<username>ENTER_CUSTOMER_USERNAME</username>
<password>ENTER_CUSTOMER_PASSWORD</password>
<webserviceUser>true</webserviceUser>
## <searchable>false</searchable>
## <contact>
<firstName>Jack</firstName>
<lastName>Brown</lastName>
<address address1="123 South St" city="Edmonton"
state="AB" postalCode="T5G 2S7" country="CA"/>
## <email>jack_brown@acme.com</email>
<jobTitle>Building Administrator Data Exchange User</jobTitle>
## <phone>703-555-2121</phone>
## </contact>
<organization name="ACME Corporation">
<primaryBusiness>Other</primaryBusiness>
<otherBusinessDescription>other</otherBusinessDescription>
<energyStarPartner>true</energyStarPartner>
<energyStarPartnerType>Service and Product Providers</energyStarPartnerType>
## </organization>
<emailPreferenceCanadianAccount>true</emailPreferenceCanadianAccount>
## </account>

Note that when you place this call to create a new “test customer” account, you must
authenticate the call with the credentials of your API-enabled (Test provider) Portfolio
Manager account. Because of this pathway (customer account creation takes place
“through” your provider account), any new customer you create in this manner will
automatically be Connected to your “test provider” account (see further discussion in
Testing Part C, below).

The XML response to the POST /customer call will indicate whether or not the customer
account was created successfully (which you can also confirm in the Test UI). When the
response indicates that the account was created successfully, it will also return a unique
account ID. Make sure to save and store this ID, along with the corresponding username
and password you assigned, in order to reference the customer account in subsequent
web service calls.

- Create Properties within Customer Account(s) (Video starts at 00:18:21). When you
create a property, you will be required to enter basic information, such as a property
name and address. This information is submitted via a POST call, may be edited via a
PUT call, and may be deleted with a DELETE call. Finally, once property information has
been uploaded to Portfolio Manager, it may be accessed via a GET call. Once you run a
POST call, the response will indicate whether the action was successful, which can also
be validated in the test user interface for the customer account.

To create a property, use this call:

Sample XML 4
POST /account/(customer_accountId)/property

## <property>


## Testing Web Services  Page 6
## Web Services
<name>Broadway School</name>
<primaryFunction>K-12 School</primaryFunction>
<address address1="123 South St" city="Edmonton"
state="AB" postalCode="T5G 2S7" country="CA"/>
<yearBuilt>2000</yearBuilt>
<constructionStatus>Existing</constructionStatus>
<grossFloorArea temporary="false" units="Square Feet">
## <value>10000</value>
</grossFloorArea>
<occupancyPercentage>80</occupancyPercentage>
<isFederalProperty>false</isFederalProperty>
## </property>

The XML response will indicate whether or not the customer property was created
successfully. When the response indicates that the property was created successfully, it
will also return a unique property ID. Make sure to save and store this ID in order to
reference this property in subsequent web service calls.

- Add Property Use Data (Video starts at 00:24:08). In addition to property data, you may
also manage property use characteristics for your customers’ properties. You would use
these services to enter and update property usage information. You will use a POST call
to enter data, a PUT call to edit data, and a DELETE call to remove data. If you need to
access property use data, you can use a GET call. Once you run a POST call, the
response will indicate whether the action was successful, which can also be validated in
the test user interface for the customer account.

To add Property Use data, use this call:

Sample XML 5

POST /property/(propertyID)/propertyUse

<k12School>
<name>Broadway K-12 School</name>
<useDetails>
<totalGrossFloorArea units="Square Feet" currentAsOf="2010-08-13"
temporary="false">
## <value>333</value>
</totalGrossFloorArea>
<openOnWeekends currentAsOf="2010-08-13" temporary="false">
<value>Yes</value>
</openOnWeekends>
<percentCooled currentAsOf="2010-08-13" temporary="false">
## <value>0</value>
</percentCooled>
<percentHeated currentAsOf="2010-08-13" temporary="false">
## <value>0</value>
</percentHeated>
<numberOfComputers currentAsOf="2010-08-13" temporary="false">
## <value>3</value>
</numberOfComputers>
<cookingFacilities currentAsOf="2010-08-13" temporary="false">
<value>Yes</value>
</cookingFacilities>
<isHighSchool currentAsOf="2010-08-13" temporary="false">
<value>Yes</value>
</isHighSchool>
<monthsInUse currentAsOf="2010-08-13" temporary="false">
## <value>8</value>
</monthsInUse>


## Testing Web Services  Page 7
## Web Services
<schoolDistrict currentAsOf="2010-08-13" temporary="false">
<value>String</value>
</schoolDistrict>
</useDetails>
</k12School>

The XML response will indicate whether or not the property use was created
successfully. When the response indicates that the property use was created
successfully, it will also return a unique property use ID. Make sure to save and store
this ID in order to reference this property use in subsequent web service calls.

- Create Meters. Once you have created a property, you can create meters for that
property, including energy meters, water meters, waste meters, IT energy meters (used
for benchmarking data centers), and water/wastewater plant flow rate meters (used for
benchmarking water/wastewater treatment plants). Meter information is submitted via a
POST call, may be edited via a PUT call, and may be deleted with a DELETE call.
Finally, once meter information is exchanged into Portfolio Manager, it may be accessed
via a GET call. Once you run a POST call, the response will indicate whether the action
was successful, which can also be validated in the test user interface for the customer
account.

To create an energy meter (Video starts at 00:29:10), use this call:

Sample XML 6
POST /property/(propertyId)/meter

## <meter>
<type>Electric</type>
<name>Electric Main Meter</name>
<unitOfMeasure>kBtu (thousand Btu)</unitOfMeasure>
## <metered>true</metered>
<firstBillDate>2010-01-01</firstBillDate>
<inUse>true</inUse>
## </meter>

The XML response will indicate whether or not the energy meter was created
successfully. When the response indicates that the energy meter was created
successfully, it will also return a unique energy meter ID. Make sure to save and store
this ID in order to reference this meter in subsequent web service calls.

To create a water meter (Video starts at 00:31:40), use this call:

Sample XML 7
POST /property/(propertyId)/meter

## <meter>
<type>Municipally Supplied Potable Water - Indoor</type>
<name>Potable Indoor Meter</name>
## <metered>true</metered>
<unitOfMeasure>Gallons (US)</unitOfMeasure>
<firstBillDate>2014-01-01</firstBillDate>
<inUse>true</inUse>
## </meter>



## Testing Web Services  Page 8
## Web Services
The XML response will indicate whether or not the water meter was created
successfully. When the response indicates that the water meter was created
successfully, it will also return a unique water meter ID. Make sure to save and store this
ID in order to reference this meter in subsequent web service calls.

To create a waste meter (Video starts at 00:32:58), use this call:

Sample XML 8
POST /property/(propertyId)/meter

<wasteMeter>
<name>regularDisposedWasteEstimation</name>
<type>Disposed - Trash</type>
<unitOfMeasure>Cubic yards</unitOfMeasure>
<dataEntryMethod>regular container</dataEntryMethod>
<containerSize>2</containerSize>
<firstBillDate>2000-01-01</firstBillDate>
<inUse>true</inUse>
</wasteMeter>

The XML response will indicate whether or not the waste meter was created
successfully. When the response indicates that the waste meter was created
successfully, it will also return a unique waste meter ID. Make sure to save and store this
ID in order to reference this meter in subsequent web service calls.

- Associate Meters (Video starts at 00:34:30). Meters that are newly created via API are
not automatically included in the calculation of energy, water, or waste use metrics for a
property. In order for that to happen, a meter must be “associated” with a property.

You can associate a meter with a property using a POST call. Note that the POST
/association/property/(propertyId)/meter call is a “replace” function, not an “add” function,
which means that it replaces the existing meter configuration for a property with a
completely new meter configuration. If other meters have been previously associated to
a property, they must be included in the POST call when you add the additional
meter(s), or the previous associations will be lost. This POST call treats energy, water,
and waste meters as separate categories, so running this call for energy meters without
including water or waste meters will not affect any standing water or waste meter
associations.
If you are only seeking to associate a single, specific meter to a property, you would use
the POST /association/property/(propertyId)/meter/(meterId) call. The status of any other
meters currently associated with the property will be unaffected.

Sample XML 9 provides an example of a “full meter” association call. In other words, it
associates a specified list of meters to a given property and overwrites the list of meters
that were previously associated with this property. Again, this call affects only meters
within the specified categories, so this example call demonstrates associations for
energy, water and waste meters. Omission of a given meter type (energy/water/waste) is
allowable as part of this call; it simply means that the associations for that meter type will
not be updated/overwritten.



## Testing Web Services  Page 9
## Web Services
Sample XML 9

POST /association/property/(propertyId)/meter

<meterPropertyAssociationList>
<energyMeterAssociation>
## <meters>
<meterId>(energy_meterId)</meterId>
## </meters>
<propertyRepresentation>
<propertyRepresentationType>Whole Property</propertyRepresentationType>
</propertyRepresentation>
</energyMeterAssociation>

<waterMeterAssociation>
## <meters>
<meterId>(water_meterId)</meterId>
## </meters>
<propertyRepresentation>
<propertyRepresentationType>Whole Property</propertyRepresentationType>
</propertyRepresentation>
</waterMeterAssociation>

<wasteMeterAssociation>
## <meters>
<meterId>(waste_meterId)</meterId>
## </meters>
</wasteMeterAssociation>
</meterPropertyAssociationList>

Sample XML 10 shows an individual meter association call. In this case, we would be
associating just one meter to this property, without affecting other associated meters.

Sample XML 10

POST /association/property/100/meter/321

The XML response will indicate whether or not the meter association was performed
successfully. To see/confirm the complete list of meters associated with this property,
you would use the GET /association/property/(propertyId)/meter call.

- Add Meter Consumption Data. Once a meter is created, you can add individual
consumption/use records under the meter. Consumption data must include a start date,
an end date, and a consumption quantity (the unit of measure for this quantity is already
determined at the level of the meter object under which the consumption details are
being created). Costs associated with specific consumption records can be provided as
well, although this is optional. It is possible to submit a maximum of 120 periods of
consumption for a single meter within one XML call – where standard practice is for each
period to reflect a single billing interval (approximately monthly for electricity and gas;
typically longer for delivered fuels such as diesel or fuel oil, which are considered “bulk”
deliveries and would need to be designated as such at the meter object level).

- Meter consumption information is submitted via a POST call, may be edited via a PUT
call, and may be deleted with a DELETE call. If you need to retrieve meter consumption
data, you can use a GET call. Once you run a POST call, the response will indicate


## Testing Web Services  Page 10
## Web Services
whether the action was successful, which can also be validated in the test user interface
for the customer account.

To add energy meter consumption data (Video starts at 00:40:55), use this call:

Sample XML 11

POST /meter/(energy_meterId)/consumptionData

<meterData>
<meterConsumption estimatedValue="true">
## <cost>21</cost>
<startDate>2018-12-01</startDate>
<endDate>2018-12-31</endDate>
## <usage>130</usage>
</meterConsumption>
<meterConsumption estimatedValue="false">
## <cost>20</cost>
<startDate>2018-11-01</startDate>
<endDate>2018-11-30</endDate>
## <usage>120</usage>
</meterConsumption>
</meterData>

The XML response will indicate whether or not the meter consumption data were created
successfully. When the response indicates that the meter consumption data were
created successfully, it will also return a unique meter consumption data ID for each
individual consumption record (e.g., each monthly entry). Make sure to save and store
these IDs in order to reference these meter consumption records in subsequent web
service calls.

To add water meter consumption data (Video starts at 00:45:44), use this call:

Sample XML 12

POST /meter/(water_meterId)/consumptionData

<meterData>
<meterConsumption estimatedValue="true">
## <cost>21</cost>
<startDate>2018-12-01</startDate>
<endDate>2018-12-31</endDate>
## <usage>130</usage>
</meterConsumption>
<meterConsumption estimatedValue="false">
## <cost>20</cost>
<startDate>2018-11-01</startDate>
<endDate>2018-11-30</endDate>
## <usage>120</usage>
</meterConsumption>
</meterData>

The XML response will indicate whether or not the meter consumption data were created
successfully. When the response indicates that the meter consumption data were
created successfully, it will also return a unique meter consumption data ID for each
individual consumption record (e.g., each monthly entry). Make sure to save and store
these IDs in order to reference these meter consumption records in subsequent web
service calls.


## Testing Web Services  Page 11
## Web Services

To add waste meter consumption data (Video starts at 00:47:38), use this call:

Sample XML 13

POST /meter/(waste_meterId)/wasteData

<wasteDataList>
<wasteData>
<startDate>2018-01-01</startDate>
<endDate>2018-01-31</endDate>
<timesEmptied>4</timesEmptied>
<averagePercentFull>75</averagePercentFull>
## <cost>50</cost>
<disposalDestination>
<incinerationPercentage>25</incinerationPercentage>
<landfillPercentage>25</landfillPercentage>
<unknownDestPercentage>5</unknownDestPercentage>
<wasteToEnergyPercentage>45</wasteToEnergyPercentage>
</disposalDestination>
</wasteData>
<wasteData>
<startDate>2018-02-01</startDate>
<endDate>2018-02-28</endDate>
<timesEmptied>4</timesEmptied>
<averagePercentFull>100</averagePercentFull>
## <cost>50</cost>
<disposalDestination>
<incinerationPercentage>25</incinerationPercentage>
<landfillPercentage>25</landfillPercentage>
<unknownDestPercentage>5</unknownDestPercentage>
<wasteToEnergyPercentage>45</wasteToEnergyPercentage>
</disposalDestination>
</wasteData>
</wasteDataList>

The XML response will indicate whether or not the meter consumption data were created
successfully. When the response indicates that the meter consumption data were
created successfully, it will also return a unique meter consumption data ID for each
individual consumption record (e.g., each monthly entry). Make sure to save and store
these IDs in order to reference these meter consumption records in subsequent web
service calls.

- Retrieve Metrics (Video starts at 00:50:51). Once you have sufficient property, property
use, meter, and meter consumption data entered, you can start querying for calculated
metrics, such as the ENERGY STAR score. The “Get Property Metrics” service allows
you to request and receive specific metrics that are calculated by Portfolio Manager.
Through this call you will specify exactly which metrics you would like to receive, from a
full list of more than 1,750 metrics available here. In the example call below, the
calculated metrics being requested are the ENERGY STAR score, source energy use
intensity, and total water use intensity for the period ending December 31, 2023.

## Header
## Field
## Name
## Value
## Content
-Type
application/xml


## Testing Web Services  Page 12
## Web Services
## PM-
## Metrics
score, sourceIntensity, waterIntensityTotal

Sample XML 14

GET /property/(propertyId)/metrics?year=2023&month=12&measurementSystem=EPA

Please note that the services listed above are not the only services available. For example, the
Meter Services listed are the basic services for adding and editing individual meters. There is
also a GET Meter List service, which will return a full list of meters for a given property. Please
refer to our complete API documentation for a description of all available web services:
http://portfoliomanager.energystar.gov/webservices/home/api.

Testing Part C: Connection and Share Requests

If your customers already have properties in Portfolio Manager, then you will access their data
via the Connection and Sharing functions of Portfolio Manager and the corresponding web
services that are used to query for and accept/reject pending Connection and Share requests.
In this process, similar to social media platforms, your customers will request a connection to
you; after you have accepted that connection, they will be able to share their properties and
meters, which gives you authorization to manage their data.

In the Portfolio Manager Live/Production environment, these sharing actions must be initiated
by the customer within the Portfolio Manager UI. Prior to the launch of the Test UI in December
2024, it was necessary to simulate the generation of these connection and sharing requests via
a series of Test-only web service calls. Since December 2024, however, these simulated
Connection/Share calls are no longer available and these requests must be initiated from a
“sample customer” account in the Test UI. From that point, incoming Connection and Share
requests can be queried and accepted/rejected by the “test provider” account using the
corresponding Connection/Sharing web services, or else via the “Notifications” section of the
Test UI.

Step-by-step guidance regarding the navigation of the Connection/Sharing process by API
users can be found in the resource How to Use Web Services: Connection and Sharing
Guidance for Providers. This resource presents the Connection/Sharing process from the dual
perspective of the customer and the API user/web service provider. With the launch of the Test
UI, the API user can follow this guide to work through both sides of the process in real time.

You should follow these steps for testing the Connection/Sharing process:

- Create Sample Accounts and Properties. In order to begin to test the process of sharing,
you will need to create sample accounts, properties, and meters. These accounts will
represent your customers, who will send you connection and sharing requests. These
processes are discussed in Testing Part B, above. With the availability of the Test UI,
web service providers now have the choice to create sample customer accounts,
properties, and meters via API or via the Test UI.

- If required, terminate any existing connection/shares between your Test account and
your customer’s Test account/property/meter records (Video starts at 00:59:46). This


## Testing Web Services  Page 13
## Web Services
will be relevant if you have used the API to create customer accounts, properties, and/or
meters.
When creating test customer accounts, properties, and meters under Testing Part B,
above, account-level connections and property/meter-level shares are automatically
executed. In order to effectively test the Connection/Sharing process as a “call-and-
response” cadence between an existing customer’s Portfolio Manager records and API
user/web service provider, you will need to manually remove any existing connections
and shares. To do this, please use the “Disconnect from Customer” call shown below in
Sample XML 15, setting the “?keepShares” parameter to "false.” This step only needs to
be taken at the account/disconnect level, since any existing property and meter shares
between your account and the customer account will be removed.

The "accountId" specified in the URL must reference the account from which the
authenticated user wishes to disconnect. In example XML 15 below, we are
disconnecting from the customer’s account but are authenticating the call using the web
service provider’s Test account credentials.

Sample XML 15

POST /disconnect/account/(customer_accountId)?keepShares=false

<terminateSharingResponse>
<note>Disconnecting to test a connection request and property share request.</note>
</terminateSharingResponse>

NOTE: this step is only required within the Test environment, for the purposes of testing
the customer connection/share request process for records that were originally created
via API. This is not a “typical” business process that will need to be performed within the
Live environment. This action can also be performed directly within the Test UI, if
desired.

- Initiate the outgoing Connection request from a test customer account within the Test UI.
For details, see Section 1 (“User Adds You as a Contact”) in the guide How to Use Web
Services: Connection and Sharing Guidance for Providers.

- Retrieve the Connection Request (Video starts at 01:04:15). To retrieve the pending
connection request, you would run the following web service.

Sample XML 16
GET /connect/account/pending/list

The response for this GET call will look like sample XML 17 below.

Sample XML 17
<pendingList>
## <account>
<accountId>87267</accountId>
<username>JohnDoeTestAccount</username>
<customFieldList>
<customField name="Username">Yes</customField>
</customFieldList>


## Testing Web Services  Page 14
## Web Services
<accountInfo>
<address address1="45324 Labor Street" city="Fairfax" state="FL"
postalCode="33843" country="US"/>
## <email>john_doe@acme.com</email>
<firstName>John</firstName>
## <phone>123-456-7891</phone>
<lastName>Doe</lastName>
<jobTitle>Operations Manager</jobTitle>
<organization>ACME Corp</organization>
</accountInfo>
<connectionAudit>
<createdBy>Chris_Jones123</createdBy>
<createdByAccountId>75489</createdByAccountId>
<createdDate>2014-12-03T08:49:29.000-05:00</createdDate>
<lastUpdatedBy>Chris_Jones123</lastUpdatedBy>
<lastUpdatedByAccountId>75489</lastUpdatedByAccountId>
<lastUpdatedDate>2014-12-03T13:49:29.000-05:00</lastUpdatedDate>
</connectionAudit>
## </account>

## ...

## <links>
<link linkDescription="next page" link="/connect/account/pending/list?page=2" httpMethod="GET"/>
## </links>
</pendingList>

- Accept the connection request (Video starts at 01:06:04). To accept the pending
connection request, you would run the following web service.

Sample XML 18
POST /connect/account/(customer_accountId)

<sharingResponse>
<action>Accept</action>
<note>Your connection request has been verified and accepted.</note>
</sharingResponse>


- Verify the connection has been established. To verify the connection, you would run the
following web service.

Sample XML 19
GET /customer/list

You can also run the GET Pending Connections call again, to confirm that this customer
account is no longer showing up on the list. Finally, you can review your account or the
customer’s account in the Test UI to confirm that the Connection has been made.

- Initiate the outgoing Property Share request from a test customer account within the Test
UI. For details, see Section 3 (“User Shares a Property and/or Meters with You”) in the
guide How to Use Web Services: Connection and Sharing Guidance for Providers.

- Retrieve the Property Share Request (Video starts at 01:14:31). To retrieve the
pending property share request, you would run the following web service.




## Testing Web Services  Page 15
## Web Services

Sample XML 20
GET /share/property/pending/list


The response for this GET call will look like sample XML 21 below:

Sample XML 21
GET /share/property/pending/list

<pendingList>
## <property>
<propertyId>(propertyId)</propertyId>
<customFieldList>
<customField name="Lot Number">BH971</customField>
</customFieldList>
<accessLevel>Read Write</accessLevel>
<accountId>(accountId)</accountId>
<username>JohnDoeTestAccount</username>
<propertyInfo>
<name>Broadway School</name>
<address address1="12321 Main Street" city="Arlington" state="VA"
postalCode="22201" country="US"/>
<numberOfBuildings>3</numberOfBuildings>
<constructionStatus>Test</constructionStatus>
<primaryFunction>K-12 School</primaryFunction>
<yearBuilt>2000</yearBuilt>
<grossFloorArea units="Square Feet" temporary="false" default="N/A">
## <value>10000</value>
</grossFloorArea>
<occupancyPercentage>80</occupancyPercentage>
<isFederalProperty>false</isFederalProperty>
## <audit>
<createdBy>acme_dx_user</createdBy>
<createdByAccountId>400</createdByAccountId>
<createdDate>2014-04-01T13:51:15.000-04:00</createdDate>
<lastUpdatedBy>acme_dx_user</lastUpdatedBy>
<lastUpdatedByAccountId>400</lastUpdatedByAccountId>
<lastUpdatedDate>2014-09-03T23:29:50.000-04:00</lastUpdatedDate>
## </audit>
</propertyInfo>
<shareAudit>
<createdBy>my_cust_user</createdBy>
<createdByAccountId>100</createdByAccountId>
<createdDate>2015-02-10T13:01:37.000-05:00</createdDate>
<lastUpdatedBy>my_cust_user</lastUpdatedBy>
<lastUpdatedByAccountId>100</lastUpdatedByAccountId>
<lastUpdatedDate>2015-02-10T13:01:37.000-05:00</lastUpdatedDate>
</shareAudit>
## </property>
</pendingList>


The <createdBy> tag toward the bottom of the XML response (under the <shareAudit>
section) notes which account initiated the share request. For share requests made
directly to your account by the Property Data Administrator (PDA) account, the account
identified here will be the same as the account specified in the <accountId> tag toward
the top of the XML response. However, if the property was shared with you by an
account that is not the PDA, the <createdBy> tag will instead note a “middleman
account.” For more information, please see Appendix A of the guide How to Use Web
Services: Connection and Sharing Guidance for Providers.


## Testing Web Services  Page 16
## Web Services

- Accept the Property Share Request (Video starts at 01:16:31). To accept the pending
property share request, you would run the following web service.

Sample XML 22
POST /share/property/(propertyId)

<sharingResponse>
<action>Accept</action>
<note>Property share request has been verified and accepted.</note>
</sharingResponse>

- Verify the share has been established (Video starts at 01:18:55). To verify the property
share, you would run the following web service.

Sample XML 23
GET /property/(propertyId)

You can also run the GET Pending Property Shares call again, to confirm that this
property is no longer showing up on the list. Finally, you can review your account or the
customer’s account in the Test UI to confirm that the Property Share has been
completed.

- Initiate the outgoing Meter Share request from a test customer account within the Test
UI. For details, see Section 3 (“User Shares a Property and/or Meters with You”) in the
guide How to Use Web Services: Connection and Sharing Guidance for Providers.

- Retrieve the meter share request (Video starts at 01:19:40). To retrieve the pending
meter share request, you would run the following web service.

Sample XML 24
GET /share/meter/pending/list

Note that the response from this call will be similar to Sample XML 21, above, but with
meter-level information as opposed to property-level information.

- Accept the meter share request (Video starts at 01:19:47). To accept the pending
meter share request, you would run the following web service.

Sample XML 25
POST /share/meter/(meterId)

<sharingResponse>
<action>Accept</action>
<note>Your share request has been verified and accepted.</note>
</sharingResponse>

- Verify the share has been established (Video starts at 01:20:00). To verify the meter
share, you would run the following web service.

Sample XML 26
GET /meter/(meterId)



## ENERGY STAR
## ®
is a U.S. Environmental Protection
Agency program helping businesses and individuals fight
climate change through superior energy efficiency.
## Web Services

You could also run the GET Pending Meter Shares call again, to confirm that this meter
is no longer showing up on the list. Finally, you can review your account or the
customer’s account in the Test UI to confirm that the Meter Share has been completed.

- At this point, with the Connection, property share, and meter share accepted, you now
have the ability to interact with the customer property subject to the access rights
granted as part of the share requests (e.g., Read-Only, Read/Write). From here you can
proceed with calls such as POST /meterConsumption and GET /metrics, as discussed in
Testing Part B, above.

## Data Migration
When you move from the Test environment to the Live environment, no data is migrated from
your test account. You must request access to the Live environment API from within the
“Account Settings” of the Live/Production Portfolio Manager that you will be using to exchange
data via API. This Live account has no ability to interact to your Test account.

Speed/Performance
The Test environment’s infrastructure consists of its own separate database and application
servers from the Live environment. Since this is a Test environment, it is configured on a
smaller scale and does not intend to reflect the actual level of speed and performance that you
would experience in the Live environment.