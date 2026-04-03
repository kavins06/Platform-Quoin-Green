

Introduction to Exchanging Data Page 1
## Web Services
Introduction to Exchanging Data
## August 2020
## Overview
Portfolio Manager is the industry standard for benchmarking energy efficiency, with over
450,000 buildings benchmarked and new accounts added every day.
You can enter your
energy and operational data into Portfolio Manager via the website (manually), via Excel
spreadsheet, or via web services. The web services are specifically designed to facilitate large-
scale benchmarking.
The web services will allow your software system to interface directly with Portfolio Manager to
enter energy use and building operational data, and to retrieve key performance metrics, such
as the ENERGY STAR score. Web services offer the flexibility for utilities, energy service and
software providers, and others to link their information systems with Portfolio Manager in the
way that best meets their customers’ needs for accessing t he U.S. Environmental Protection
Agency’s (EPA) ENERGY STAR tools and metrics.
In the following sections, we will provide a more detailed description of the ENERGY STAR
Portfolio Manager ecosystem, including introductions to each of the following areas:
•ENERGY STAR Commercial Buildings Program
•Portfolio Manager
•ENERGY STAR Score
•Exchanging Data with Portfolio Manager
ENERGY STAR Commercial Buildings Program
Energy efficiency is the fastest, cheapest, and largest untapped solution for saving energy,
saving money, and preventing greenhouse gas emissions. In 1992, the U.S. Department of
Energy (DOE) and EPA created ENERGY STAR, an international standard for energy
efficiency. Today, commercial buildings can utilize the ENERGY STAR platform for guidance on
energy efficient design, function, and performance. Through ENERGY STAR, EPA has helped
thousands of businesses and organizations tap into these savings in the places where we work,
play, and learn.
For existing commercial buildings, EPA recommends a strategic approach to energy
management. We offer proven strategies that help organizations assess, understand, manage,
and improve their overall energy performance. You can learn more detail about this strategic
approach at
www.energystar.gov/buildings/facility-owners-and-managers/existing-buildings/get-
started/read-energy-star-guidelines-energy.
One of the most critical steps in strategic energy management is benchmarking. Benchmarking
is a method of comparison used by institutions and individuals to better understand performance
compared to an accepted standard.
Benchmarking utilizes raw data, performance metrics, and industry trends to make comparisons
to industry norms or best practices in order to provide a point of reference for an institution.

Introduction to Exchanging Data Page 2
## Web Services
Through benchmarking, many services and systems can be altered to perform with optimal
efficiency. Benchmarking a building’s energy performance is a key first step to understanding
and reducing energy consumption, lowering operational costs, and improving your carbon
footprint. The ENERGY STAR program provides Portfolio Manager as a free benchmarking tool,
to help all organizations begin measuring, assessing, and improving their performance.
## Portfolio Manager
Launched in 1999, Portfolio Manager i s EPA’s premier web-based solution for managing and
tracking the energy consumption and environmental footprint of buildings. It utilizes energy
consumption data as a basis for benchmarking and tracks energy inputs of all types. The web-
based tool informs building owners and managers about their facilities’ performance, which
helps them make informed management and investment decisions.
Portfolio Manager provides a big-picture view of how energy is being used by facilities and
campuses and allows for comparison to similar facilities. Organizations that intend to use web
services are encouraged to create a Portfolio Manager account and input sample facilities via
the website first in order to see how Portfolio Manager captures data and presents the ENERGY
STAR energy performance score to users.
Portfolio Manager is also the application through which organizations in the United States can
apply to earn the ENERGY STAR certification for a building or to earn recognition as an
ENERGY STAR Partner of the Year.  Applications for recognition remain solely a function of
Portfolio Manager. At this time, there are no web services for creating or submitting applications
for recognition. Therefore, you or your customer must log into Portfolio Manager to submit and
track applications for recognition.
ENERGY STAR Score
The ENERGY STAR score is a type of external benchmark that helps energy managers
evaluate how efficiently their buildings use energy relative to similar buildings nationwide. The
scoring system’s 1-100 scale allows everyone to quickly understand how a building is
performing. A score of 50 indicates average energy performance, while a score of 75 or better
indicates top performance.
EPA, in conjunction with stakeholders, developed the ENERGY STAR score as a screening
tool; it does not by itself explain why a building performs a certain way, or how to change the
building’s performance. It does, however, help organizations assess performance and identify
those buildings that offer the best opportunities for improvement and recognition.
A growing list of property types in the US and Canada are eligible to receive a score.  In July
2013, EPA and Natural Resources Canada (NRCan) released an ENERGY STAR score for
Canadian buildings, which applies the same methodology to assess measured performance
relative to the Canadian building stock.
To develop the ENERGY STAR performance scale, EPA conducts statistical analysis on
national building energy use survey data. Typically, we will use the Commercial Building Energy
Consumption Survey (CBECS), a survey conducted by the DOE’s Energy Information
Administration. The analysis of this data helps us identify the key drivers of energy use in each
property type, so that we can normalize appropriately in the ENERGY STAR score. To receive a
score in Portfolio Manager you are required to enter 12 months of energy use data along with



Introduction to Exchanging Data  Page 3
## Web Services
the operational parameters identified as significant in our analysis (typically 6-8 operational
details).
## 1
In order to obtain a valid ENERGY STAR score, it is necessary to include energy data
for the entire property, including all tenant and common areas.

Buildings with an ENERGY STAR score of 75 or higher can apply for ENERGY STAR
certification. By earning and displaying the ENERGY STAR, organizations convey superior
energy performance and a commitment to using resources responsibly to tenants, customers,
and employees. ENERGY STAR certification also sends a positive message to lenders,
appraisers, owners, investors, and potential tenants or customers. More than 20,000
commercial buildings and plants in America have taken action to save money and achieve
energy efficiency by becoming ENERGY STAR certified.
## 2


## Portfolio Manager Data Hierarchy
Data in Portfolio Manager is organized in a hierarchy based on six primary data points
(accounts, properties, property uses, property use details, meters, and meter consumption). You
can use web service calls to upload data into Portfolio Manager, as well as access and edit data
that is stored in the tool.

Each piece of data that is uploaded into Portfolio Manager must reference the endpoint that
appears directly above it in the hierarchy below. For example, to create a new meter, you must
reference a specific property that the meter will be associated with. To upload new meter
consumption data, you must reference a specific meter that the consumption entries will be
associated with.




## 1
Specific technical details about the ENERGY STAR score are available at:
www.energystar.gov/ENERGYSTARScore.
## 2
More information on certification is available at: http://www.energystar.gov/buildings/about-us/energy-star-
certification.



Introduction to Exchanging Data  Page 4
## Web Services
Within Portfolio Manager, you can benchmark single building properties, as well multi-building
properties (more commonly referred to as campuses). Benchmarking a campus allows you to
measure the performance of single building properties, while also tracking how these properties
contribute to campus-wide performance.

After you create the parent and child properties, you can add meters that track building-level
and campus-level energy and water performance as well as waste management. Meters that
serve the entire campus, or multiple single-building properties on the campus, must be added
at the parent property level. Keep the following points in mind when you add meter data:

- Meter data can be entered at the parent or child property level of the campus
- Add meter data at the child property level only if a building has its own meter
- Enter data at the parent property level when child properties share meters, or a
master campus meter is present
- A meter cannot be assigned to multiple child properties

For more information on campus property benchmarking in Portfolio Manager, you can review
the How to Benchmark a Campus
guide.

Exchanging Data with Portfolio Manager
EPA provides a suite of web services to help you exchange data with Portfolio Manager. These
services enable direct transfer between your energy management system database and
Portfolio Manager. You can use these services to manage building characteristics, operational
information, and energy data on behalf of your customers and retrieve key performance metrics,
such as the ENERGY STAR score.

The web services are designed for consistency with data entry via the front-end user interface.
Whether you access Portfolio Manager directly through our website or on the back-end via a
web service, you are accessing the same database and you will provide and receive the same
information.

You can use web services to create new Portfolio Manager accounts, properties, and meters. In
addition, if you have customers who already have Portfolio Manager accounts, they can form a
connection with you and share their properties and meters. This sharing process provides you
with authorization to access and update their data.

If you are interested in exchanging data with Portfolio Manager, you have flexibility in your work
with existing and new properties. Some service providers will exchange all data within a
property to provide full management; other software companies may focus mainly on extracting
metrics for use in their software tools; and other companies, like utilities, may elect to populate
meter data for buildings that are already in the Portfolio Manager and managed by the building
owner. You should review each service to determine what applications are most appropriate for
your business.

EPA has adopted a set of web services that leverage standard Representational State Transfer
(REST) protocol. Each service will use some or all of the following basic methods:

- GET  – Retrieves existing data


## Web Services
- POST – Add a new item
- PUT  – Edits or updates the value of an existing entry or attribute
- DELETE    – Removes an existing entry
The REST-based architecture relies on small units of work. Each REST call is designed to touch
only one piece of data. This means that a typical system integration will cycle through multiple
calls when updating data. For example, when using the meter consumption services, you will
send one call per meter. Because each call is small in size, each individual call will be
synchronous. Therefore, your system will receive an immediate response indicating if the call
was successful.

Web services for Portfolio Manager were first introduced in 2005, and the adoption of a REST-
based platform was deployed in July 2013. These REST services represented an evolution of
EPA’s software design, meant to align with market trends and to simplify the process of
integrating with our system.

EPA develops and maintains the application programming interface (API) and documentation
needed to successfully exchange data with Portfolio Manager via web services.    If you wish to
exchange data with Portfolio Manager, you will need to develop your own software system and
integration code.

EPA does not develop integration code for you, cannot offer individual review to debug your
software, and cannot recommend proprietary programming products or services to accomplish
these tasks. Online help is available at www.energystar.gov/BuildingsHelp to assist you with any
questions you have about ENERGY STAR Buildings, ENERGY STAR benchmarking,
certification, using Portfolio Manager, or the web service schemas and documentation.

## Getting Started
If you are new to exchanging data with Portfolio Manager, you should begin by using test web
services in our test environment. Please refer to Testing Web Services
## 3
for general information
about how to test the system. For the complete schema definitions, refer to our full Application
Programming Interface documentation.
## 4



## 3
http://portfoliomanager.energystar.gov/webservices/pdf/Testing_Web_Services_en_US.pdf
## 4
http://portfoliomanager.energystar.gov/webservices
