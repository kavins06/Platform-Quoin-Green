






















ENERGY STAR for Commercial Buildings
How to Use Web Services: Connection and Sharing Guidance for Providers
How to Use Web Services: Connection and Sharing Guidance for Providers


## |  1
“How To” Series


EPA’s ENERGY STAR Portfolio Manager tool helps
users measure and track the energy use, water use,
and greenhouse gas emissions of their buildings, all
in a secure online environment. The tool can be
used to identify under-performing buildings, set
investment priorities, verify efficiency
improvements, and receive EPA recognition for
superior energy performance.
To exchange data in Portfolio Manager, users must
set up a connection with a web services provider
account and then share their properties and/or
meters with this account. This document outlines
how to set up this connection and share access to properties and meters.
In the first step, the user will add you, the web services provider, as a “contact” in his or
her account, and send you a connection request. After you accept the connection, the
user shares properties and/or meters with you, and you will then be able to accept those
properties and/or meters. The connection and sharing steps, from the user’s perspective
and your own, are outlined in Parts 1 and 2 below.
User Adds You as a Contact
The user initiates the sharing process by adding you as
a contact using the following steps:
- The user logs in to Portfolio Manager and
clicks on the Contacts link in the upper right-
hand corner.
- On the My Contacts page, the user selects Add
## Contact.
Figure 1: Adding property contacts
## ❶
Table of Contents
- Part 1: User Adds You as a Contact
- Part 2: You Accept the Connection
- Part 3: User Shares a Property
and/or Meters with You
- Part 4: You Accept the Property and
## Meter Shares
- Appendix A: Managing “Share
## Forward” Functionality
## • Appendix B: Ongoing Share
## Management
- Appendix C: Transfer of Ownership





How to Use Web Services: Connection and Sharing Guidance for Providers


## |  2
- On the Add Contact page, the user can
search for your organization by name,
username, or email address. The user
will have the easiest time finding your
account when given the exact username
to enter on this page.
NOTE: You must specifically allow your
account to be searchable in Portfolio
Manager. Enable this function on the
Your Preferences tab under Account
## Settings.
- The user selects your organization from the search results and clicks on the Connect button.
- After selecting Connect, the user will be
prompted to accept any terms of use
you have specified. They will also be
asked to submit any account-  level
information in the custom fields that you
have configured previously via web
services (if applicable). The user then
selects Send Connection Request.
You Accept the Connection
- You can obtain a list of pending connection requests by running GET
## /connect/account/pending/list.
- Accept those requests by running POST /connect/account/(accountId) or by accepting any
pending connections in your Portfolio Manager account’s notifications section on the MyPortfolio
tab of the user interface.
- The user is notified that you have accepted their connection request via a message in the
“Notifications” section on the main screen of Portfolio Manager.
User Shares a Property and/or Meters with You Use Styles to Format
The user will log in to Portfolio Manager, click on the Sharing tab and select Set Up Web Services/Data
Exchange. Then they will share properties and meters with you using the steps below:
## Figure 2: Adding Contacts
Figure 3: Sending a connection request
## ❷
## ❸



How to Use Web Services: Connection and Sharing Guidance for Providers


## |  3
- On the Share Properties for
Exchanging Data screen, the
user selects your account from
the Select Web Services
Provider dropdown list of their
connected web services
accounts,
- Select the property(ies) that
they wish to share.
- When sharing properties with
you, the user can either choose
to set permission levels in bulk
for all properties and meters
(Path 1) or provide different
levels of access for each
property/meter (Path 2).
- Path 1: “Bulk Sharing (Simple
Option) – I want to give all my
properties and meters the same
permissions” If the user
chooses to set permission levels in bulk,
they can share everything at the same permission level using the applicable radio buttons or they
can use the Exchange Data Custom Access option to grant differing levels of access by meter
type, as long as those access levels are consistent across all properties for each meter type (for
example: full access to all electric meters but read-only access to all gas meters).
Users setting permissions in bulk will set their desired permissions on this page and then click
“Authorize Exchange.”
NOTE: If you require the entry of custom fields when users share properties or meters with your
account, Portfolio Manager will allow the user to download an Excel spreadsheet that they can
use to populate custom field values for each property/meter they are sharing. This spreadsheet
can then be submitted to the Portfolio Manager technical team, which will help to complete the
sharing process. The process of creating those shares will take about a week.
Figure 4: Setting permissions level for data exchange



How to Use Web Services: Connection and Sharing Guidance for Providers


## |  4
Path 2: “Personalized Sharing (Custom
Orders”) - I want to give different
permissions for each property and/or
meter.” If the user needs to set different
levels of access for each property, they’ll
select the appropriate radio button and then
click the “Set Permissions” button. They will
be directed to the Share Your Property(ies)
page. On the next page (see screenshot to
the right), the selected properties will
appear on a permissions selection screen.
The user will click the radio button for
Exchange Data for each property.
A dialog box will appear that allows the user to select a level of access for exchanging data for a property
and its meters. Options include None, Read Only Access, and Full Access.
If the user is not able to send meter share requests, it is likely that your system has not been set up to
support that specific meter type. If this is the case, the user will receive an alert beneath the dialogue box.
The user can also enter values for property-level and meter-level custom ID fields on this screen.
Examples of such custom ID fields could include “utility account ID,” “meter number,” or any other custom
identifier information that you wish to collect from your customer.




Figure 6: Identifying data that will be shared
Figure 5 Setting permissions level for data exchange



How to Use Web Services: Connection and Sharing Guidance for Providers


## |  5
You Accept the Property and Meter Shares
After the Portfolio Manager user has generated a property-level and/or meter-level sharing
request, you must retrieve the request and accept or reject it. Use the steps below to search for
and accept property and meter share requests:
- Search for pending property share requests using GET /share/property/pending/list.
- Accept/reject pending property share requests by running POST /share/property/(propertyId).
- Search for pending meter share requests using GET /share/meter/pending/list.
- Accept/reject pending meter share requests by running POST /share/meter/(meterId).

A user may choose to share a property, but not its corresponding meters. Alternatively, a user may
choose to share meters, but not their corresponding property. If a meter has been shared, but the
user does not share the property, the permissions screen will automatically mark the property as
“read-only.” If you accept a meter share, any pending property share associated with that meter
will be automatically accepted. Acceptance of a property-level share does not cause
corresponding meter share requests to be accepted. Meter-level sharing requests must be
accepted separately.
You can disconnect from a user at any time using the POST /disconnect/account/(accountId) service.
To remove all associated property-  and meter-level shares when you disconnect from a user’s
account, you must set an optional flag in the account disconnect service that will also remove all
property and meter shares. You can also remove individual property or meter shares at any time using
POST /unshare/property/(propertyId) and POST /unshare/meter/(meterId).














## Learn More!
•About Portfolio Manager: energystar.gov/benchmark
•ENERGY STAR Guide for Licensed Professionals
energystar.gov/LPGuide
•ENERGY STAR for Buildings: energystar.gov/buildings



## ❹



How to Use Web Services: Connection and Sharing Guidance for Providers


## |  6
Appendix A: Managing “Share Forward” Functionality
Portfolio Manager allows users to “Share Forward,” or share a property that was shared
with them. For example, a property owner may share a property with a consultant (or
another “middleman”), which in turn may execute a web services share with a utility or
energy information services provider. In Portfolio Manager, the account in which the
property record was originally created is called the “Property Data Administrator” (PDA).
All web service shares, whether originated by the PDA or by a “middleman,” will be
accessed subsequently by the web service provider by calling the PDA’s account ID.

To enable this, Share Audit information is included with each pending share request, and will
always list the PDA’s account ID in the <accountID> field. The <notificationCreatedBy> and
<notificationCreatedByAccountId> fields will identify the account that generated the share,
allowing you to determine whether a share request was initiated by the PDA or by a
“middleman” account. Middleman accounts can also be identified after the share has been
accepted by using the GET /Metrics web service to access the <propertySharedBy>
metric.

The way that you receive and process these shares will depend on whether or not you are
connected to the PDA’s account. Furthermore, the order in which you process pending
account-level connections and property or meter shares may be important to your
authorization process.
A. If you are already connected to the requestor:
Accept or reject the property and meter share requests as outlined in Part 2 above.
B. If you are not already connected to the requestor:
You will receive an account connection request from the PDA (1), in addition to the
individual property and meter share requests (2). You may take the following actions:
- If you Accept 1 first; you can either Accept or Reject 2
- If you Reject 1; you automatically Reject 2
- If you Accept 2 first; you automatically Accept 1
- If you Reject 2; you can either Accept or Reject 1

In scenario B, we recommend processing the account-level connection request first if your
system requires a valid account-level connection before transmitting meter data.

Please note that pending property and meter share requests, as shown in a GET
/share/meter/pending/list or GET /share/property/pending/list response, contain the account
ID of their PDA account. It is recommended that you parse these share requests to obtain
the PDA’s account ID, and to store this information in your database. You will not see the
connection request from the PDA if you accept one of their property or meter shares first.




How to Use Web Services: Connection and Sharing Guidance for Providers


## |  7
If you are not able to do this during the share, you can access the PDA’s account
information after accepting the share by running a GET /metrics call and including the
metrics propertyDataAdministrator and propertyDataAdministratorAccountId.

## Appendix B: Ongoing Share Management
Edits to Your Access Levels by the PDA and Other Users
Once established, sharing permissions can be revised at any time by the PDA or any other
user with full access to the property and/or meter. When a user makes edits to your access,
such as editing your permissions to individual meters, or editing your permissions to a
property, you will receive a notification for each edit made. These notifications can be
obtained by running GET /notification/list; an example notification is provided below:

<notificationList>
## <notification>
<notificationTypeCode>SHAREUPDATE</notificationTypeCode>
<notificationId>129681</notificationId>
<description>Electric Grid Meter - Access level revised to Read Only by
## Customer John.</description>
<accountId>8833843022</accountId>
## <username>cwtraining</username>
<propertyId>5234642</propertyId>
<meterId>541018</meterId>
<notificationCreatedDate>2020-08-
## 10T11:19:25-
04:00</notificationCreatedDate>
<notificationCreatedBy>cwtraining</notificationCreatedBy>
<notificationCreatedByAccountId>88338</notificationCreatedByAccountId>
## </notification>
</notificationList>

By default, once a notification is pulled down via the GET Notifications call, it is marked as
“read” and will not be available in subsequent calls. However, you have the option to mark
notifications  as  unread  – and  therefore  retain  them  for  later  access  – by  specifying
“?clear=false” as part of the call URL.

Please note that if your account is not connected with the account that edited your access,
you will need to establish an account level connection with them in order to pull additional
information regarding their account.

Permissions edits automatically take effect; you do not need to accept them. The same
process occurs when a user deletes a meter from a property they’ve shared with you.




How to Use Web Services: Connection and Sharing Guidance for Providers


## |  8
Shares that are not edited by a user will remain unchanged. When a user shares a new
meter with you on a property with additional meters that have already been shared with
you, those already established property and meter shares will not be affected; you will only
need to accept the new meter share.

As a best practice, EPA recommends that all providers exchanging data with users check
their pending connection requests, property and meter share requests, as well as share edit
notifications at the beginning of each session when using Portfolio Manager’s web services.

Appendix C: Transfer of Ownership
Portfolio Manager also allows the transfer of a property record from one account to
another account (i.e., making someone else the PDA). Typically, an ownership transfer
happens in one of two cases:
- An actual change in ownership (deed/title). In this case, the physical property is
bought/sold and the old owner gives the Portfolio Manager record to the new owner.
- Staffing change within a company. In this case, Company XYZ may own the property and
it is managed in Jane Doe’s account. When Jane leaves Company XYZ, she transfers
ownership of the Portfolio Manager record to Mike Smith, who will take over as PDA.

When a user attempts to transfer a property from one account to another, the receiving
account has the option to either accept or reject the transfer. If a transferred property was
previously shared with a web services provider with whom the receiving account is not yet
connected, the receiving account is prompted by Portfolio Manager with three options:

- Accept the transfer and issue a connection request to the web services provider account
in order to maintain provider access to the property. In this case, the recipient must
accept the provider’s terms and conditions and provide data for any custom fields
required by the provider.
- Postpone the transfer. In this case, the transfer will remain “pending” (unaccepted) until
the connection request is submitted and accepted. The original share between the
account attempting to transfer and the provider remains unaffected.
- Accept the transfer, but remove the provider’s access to the property. This removes the
web service provider’s access to the property.














How to Use Web Services: Connection and Sharing Guidance for Providers


## |  9
When a property transfer takes place, and the recipient issues a connection request to your
account to maintain your access, you receive both a connection request from the recipient
through
GET connect/account/pending/list and a web services notification through GET
/notification/list telling you that the property has been transferred. The notification includes the ID
of the property that was transferred and the account ID and username of the new PDA. You will
be able to continue servicing the existing property and meter even before processing the new
account connection request, but you will not be able to access the account information of the
new PDA until you accept the new account connection.

If the recipient account chooses to accept the transfer but remove your access, you will
receive a transfer notification and un-share notifications for the property and its meters
through GET /notification/list.

If you do not know the new PDA or why the property was transferred, it is up to you to
decide whether you want to accept the PDA’s connection request and continue to
exchange data.
